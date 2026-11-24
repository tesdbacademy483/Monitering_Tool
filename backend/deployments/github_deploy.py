"""
Runs deployments through GitHub Actions.

Clicking "Deploy" starts the repository's deploy workflow (deploy.yml by default)
and passes the environment (development / staging / production) as an input.

Re-uses the GitHub helpers from pipelines/github_actions.py. Those helpers only
need an object with .repository, .branch, .workflow_file and .owner, which a
Deployment also has.
"""

from django.utils import timezone
from django.utils.dateparse import parse_datetime

from pipelines.github_actions import (
    API,
    GitHubActionsError,
    _find_dispatched_run,
    _job_log,
    _map_status,
    _request,
)

MAX_LOG_CHARS = 200_000

# PipelineRun status -> Deployment status
STATUS_MAP = {
    "queued": "deploying",
    "running": "deploying",
    "success": "success",
    "failed": "failed",
    "cancelled": "cancelled",
}


def dispatch_deployment(deployment):
    """Start the deploy workflow on GitHub and remember its run id."""
    dispatched_at = timezone.now()

    response = _request(
        "POST",
        f"{API}/repos/{deployment.repository}/actions/workflows/"
        f"{deployment.workflow_file}/dispatches",
        deployment.owner,
        json={
            "ref": deployment.branch,
            "inputs": {"environment": deployment.environment},
            "return_run_details": True,
        },
    )

    run_id, html_url = None, ""
    if response.status_code == 200 and response.content:
        data = response.json()
        run_id = data.get("workflow_run_id") or data.get("run_id") or data.get("id")
        html_url = data.get("html_url", "")

    if not run_id:
        run_id, html_url = _find_dispatched_run(deployment, dispatched_at)

    deployment.github_run_id = run_id
    deployment.html_url = html_url or ""
    deployment.logs += f"Dispatched workflow '{deployment.workflow_file}' on GitHub Actions.\n"
    if html_url:
        deployment.logs += f"View on GitHub: {html_url}\n"
    deployment.save(update_fields=["github_run_id", "html_url", "logs", "updated_at"])


def sync_deployment(deployment):
    """Refresh a running deployment from GitHub. Safe to call repeatedly."""
    if deployment.status != "deploying":
        return deployment

    if not deployment.github_run_id:
        since = deployment.started_at or deployment.updated_at
        run_id, html_url = _find_dispatched_run(deployment, since, attempts=1)
        if not run_id:
            return deployment
        deployment.github_run_id, deployment.html_url = run_id, html_url

    base = f"{API}/repos/{deployment.repository}/actions/runs/{deployment.github_run_id}"
    gh_run = _request("GET", base, deployment.owner).json()

    deployment.status = STATUS_MAP[_map_status(gh_run.get("status"), gh_run.get("conclusion"))]
    deployment.commit_hash = (gh_run.get("head_sha") or "")[:40]
    deployment.html_url = gh_run.get("html_url", deployment.html_url)

    jobs = _request("GET", f"{base}/jobs", deployment.owner).json().get("jobs", [])
    finished = deployment.status != "deploying"
    deployment.logs = _build_logs(deployment, gh_run, jobs, include_raw=finished)

    if finished:
        deployment.finished_at = parse_datetime(gh_run.get("updated_at") or "") or timezone.now()

    deployment.save()
    return deployment


def cancel_deployment(deployment):
    if not deployment.github_run_id:
        return
    try:
        _request(
            "POST",
            f"{API}/repos/{deployment.repository}/actions/runs/{deployment.github_run_id}/cancel",
            deployment.owner,
        )
    except GitHubActionsError as exc:
        deployment.logs += f"\nGitHub cancel note: {exc}\n"


def _build_logs(deployment, gh_run, jobs, include_raw):
    lines = [
        f"Deployment:  {deployment.name}",
        f"Environment: {deployment.environment}",
        f"Repository:  {deployment.repository}",
        f"Branch:      {deployment.branch}",
        f"Workflow:    {deployment.workflow_file}",
        f"Commit:      {(gh_run.get('head_sha') or '')[:7]}",
        f"GitHub run:  {gh_run.get('html_url', '')}",
        f"Status:      {gh_run.get('status')} {gh_run.get('conclusion') or ''}".rstrip(),
    ]
    if deployment.trigger_source == "auto" and deployment.triggered_by_run_id:
        lines.append(f"Trigger:     automatic, CI run #{deployment.triggered_by_run_id} passed")
    else:
        lines.append("Trigger:     manual (Deploy button)")
    lines.append("")

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
            raw = _job_log(deployment, job["id"])
            if raw:
                text += f"\n===== Full log: {job['name']} =====\n{raw}\n"

    if len(text) > MAX_LOG_CHARS:
        text = "...(older output truncated)...\n" + text[-MAX_LOG_CHARS:]
    return text