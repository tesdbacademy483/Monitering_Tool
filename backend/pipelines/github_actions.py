"""
GitHub Actions integration for DevOpsPilot pipelines.

Flow:
  1. dispatch_workflow()  -> starts the workflow in the user's repo
  2. sync_run()           -> pulls status, step progress and logs back
  3. cancel_run()         -> stops a run on GitHub
"""
import re
import time
from datetime import timedelta

import requests
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from git_integration.models import GitHubConnection

API = "https://api.github.com"
MAX_LOG_CHARS = 200_000  # keep the DB row a sane size


class GitHubActionsError(Exception):
    """Raised with a user-friendly message when GitHub rejects a request."""


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _headers(user):
    try:
        token = user.github_connection.access_token
    except GitHubConnection.DoesNotExist:
        raise GitHubActionsError("Connect your GitHub account on the Profile page first.")

    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _request(method, url, user, **kwargs):
    kwargs.setdefault("timeout", 20)
    try:
        response = requests.request(method, url, headers=_headers(user), **kwargs)
    except requests.RequestException:
        raise GitHubActionsError("Could not reach GitHub. Check your internet connection.")

    if response.status_code == 401:
        raise GitHubActionsError("GitHub token expired. Reconnect GitHub on the Profile page.")
    if response.status_code == 404:
        raise GitHubActionsError(
            "Not found on GitHub. Check the repository name and that the workflow file exists "
            "on that branch."
        )
    if response.status_code == 422:
        message = response.json().get("message", "")
        raise GitHubActionsError(
            f"GitHub rejected the run: {message}. Make sure the workflow has "
            "'on: workflow_dispatch' and the branch exists."
        )
    if response.status_code >= 400:
        raise GitHubActionsError(f"GitHub error {response.status_code}: {response.text[:200]}")

    return response


def _map_status(gh_status, gh_conclusion):
    """GitHub status/conclusion -> DevOpsPilot PipelineRun status."""
    if gh_status in ("queued", "waiting", "requested", "pending"):
        return "queued"
    if gh_status == "in_progress":
        return "running"
    if gh_status == "completed":
        if gh_conclusion == "success":
            return "success"
        if gh_conclusion == "cancelled":
            return "cancelled"
        return "failed"  # failure, timed_out, action_required, startup_failure...
    return "running"


KNOWN_EVENTS = {"push", "pull_request", "workflow_dispatch", "schedule"}


def fill_run_details(run, gh_run):
    """Copy commit / author / event info from a GitHub workflow run onto `run`."""
    run.head_sha = gh_run.get("head_sha", "") or run.head_sha
    run.html_url = gh_run.get("html_url", "") or run.html_url

    actor = gh_run.get("triggering_actor") or gh_run.get("actor") or {}
    run.actor = (actor.get("login") or run.actor or "")[:150]

    head_commit = gh_run.get("head_commit") or {}
    message = head_commit.get("message") or ""
    if message:
        run.commit_message = message[:2000]

    # Runs started from the DevOpsPilot "Run" button stay "manual"
    if run.event != "manual":
        event = gh_run.get("event", "")
        run.event = event if event in KNOWN_EVENTS else "other"


# ------------------------------------------------------------------
# Dispatch
# ------------------------------------------------------------------

def dispatch_workflow(pipeline, run):
    """Start the pipeline's workflow on GitHub and store the run id on `run`."""
    repo = pipeline.repository
    workflow = pipeline.workflow_file
    dispatched_at = timezone.now()

    response = _request(
        "POST",
        f"{API}/repos/{repo}/actions/workflows/{workflow}/dispatches",
        pipeline.owner,
        json={"ref": pipeline.branch, "return_run_details": True},
    )

    run_id = None
    html_url = ""

    # Newer GitHub API returns the run details directly (200 OK)
    if response.status_code == 200 and response.content:
        data = response.json()
        run_id = data.get("workflow_run_id") or data.get("run_id") or data.get("id")
        html_url = data.get("html_url", "")

    # Fallback (204 No Content): find the run we just created
    if not run_id:
        run_id, html_url = _find_dispatched_run(pipeline, dispatched_at)

    run.github_run_id = run_id
    run.html_url = html_url or ""
    run.logs += f"Dispatched workflow '{workflow}' on GitHub Actions.\n"
    if html_url:
        run.logs += f"View on GitHub: {html_url}\n"
    run.save(update_fields=["github_run_id", "html_url", "logs"])


def _find_dispatched_run(pipeline, dispatched_at, attempts=5):
    since = (dispatched_at - timedelta(seconds=10)).strftime("%Y-%m-%dT%H:%M:%SZ")

    for _ in range(attempts):
        time.sleep(2)
        response = _request(
            "GET",
            f"{API}/repos/{pipeline.repository}/actions/workflows/{pipeline.workflow_file}/runs",
            pipeline.owner,
            params={
                "event": "workflow_dispatch",
                "branch": pipeline.branch,
                "created": f">={since}",
                "per_page": 1,
            },
        )
        runs = response.json().get("workflow_runs", [])
        if runs:
            return runs[0]["id"], runs[0].get("html_url", "")

    # Not visible yet; sync_run() will keep looking
    return None, ""


# ------------------------------------------------------------------
# Sync
# ------------------------------------------------------------------

def sync_run(run):
    """Refresh a PipelineRun from GitHub. Safe to call repeatedly."""
    if run.status not in ("queued", "running"):
        return run

    pipeline = run.pipeline

    if not run.github_run_id:
        run_id, html_url = _find_dispatched_run(pipeline, run.created_at, attempts=1)
        if not run_id:
            return run
        run.github_run_id, run.html_url = run_id, html_url

    base = f"{API}/repos/{pipeline.repository}/actions/runs/{run.github_run_id}"
    gh_run = _request("GET", base, pipeline.owner).json()

    run.status = _map_status(gh_run.get("status"), gh_run.get("conclusion"))
    fill_run_details(run, gh_run)

    if gh_run.get("run_started_at") and run.status != "queued":
        run.started_at = parse_datetime(gh_run["run_started_at"])

    jobs = _request("GET", f"{base}/jobs", pipeline.owner).json().get("jobs", [])
    finished = run.status in ("success", "failed", "cancelled")

    run.logs = _build_logs(run, gh_run, jobs, include_raw=finished)

    if finished:
        run.finished_at = parse_datetime(gh_run.get("updated_at")) or timezone.now()
        pipeline.status = "success" if run.status == "success" else (
            "failed" if run.status == "failed" else "idle"
        )
    else:
        pipeline.status = "running"

    run.save()
    pipeline.save(update_fields=["status", "updated_at"])
    return run


def _build_logs(run, gh_run, jobs, include_raw):
    pipeline = run.pipeline
    lines = [
        f"Pipeline:   {pipeline.name}",
        f"Repository: {pipeline.repository}",
        f"Branch:     {pipeline.branch}",
        f"Workflow:   {pipeline.workflow_file}",
        f"Trigger:    {run.get_event_display()}" + (f" by {run.actor}" if run.actor else ""),
        f"Commit:     {(gh_run.get('head_sha') or '')[:7]}"
        + (f"  {run.commit_message.splitlines()[0][:100]}" if run.commit_message else ""),
        f"GitHub run: {gh_run.get('html_url', '')}",
        f"Status:     {gh_run.get('status')} {gh_run.get('conclusion') or ''}".rstrip(),
        "",
    ]

    icons = {"success": "✔", "failure": "✘", "cancelled": "⊘", "skipped": "↷"}

    for job in jobs:
        lines.append(f"▶ Job: {job['name']}  [{job.get('conclusion') or job.get('status')}]")
        for step in job.get("steps", []):
            mark = icons.get(step.get("conclusion"), "…" if step.get("status") == "in_progress" else "·")
            lines.append(f"   {mark} {step['name']}")
        lines.append("")

    text = "\n".join(lines)

    if include_raw:
        for job in jobs:
            raw = _job_log(pipeline, job["id"])
            if raw:
                text += f"\n===== Full log: {job['name']} =====\n{raw}\n"

    if len(text) > MAX_LOG_CHARS:
        text = "...(older output truncated)...\n" + text[-MAX_LOG_CHARS:]
    return text


def _job_log(pipeline, job_id):
    try:
        # GitHub answers with a redirect to a temporary download URL
        response = _request(
            "GET",
            f"{API}/repos/{pipeline.repository}/actions/jobs/{job_id}/logs",
            pipeline.owner,
            timeout=30,
        )
        # utf-8-sig drops the hidden BOM that showed up as "ï»¿"
        text = response.content.decode("utf-8-sig", errors="replace")
        # remove terminal colour codes like "[36;1m" and "[0m"
        return re.sub(r"\x1b\[[0-9;]*m", "", text)
    except GitHubActionsError:
        return ""



# ------------------------------------------------------------------
# Cancel
# ------------------------------------------------------------------

def cancel_run(run):
    if not run.github_run_id:
        return
    try:
        _request(
            "POST",
            f"{API}/repos/{run.pipeline.repository}/actions/runs/{run.github_run_id}/cancel",
            run.pipeline.owner,
        )
    except GitHubActionsError as exc:
        # 409 = already finished; anything else we still mark it cancelled locally
        run.logs += f"\nGitHub cancel note: {exc}\n"