"""
The automation engine: git push -> CI -> deploy -> health check, with no clicks.

    git push
      |
      v
    GitHub Actions runs the CI workflow (on: push)
      |
      |  DevOpsPilot finds out through a webhook (instant) or the
      |  background worker, which polls GitHub every 30 seconds
      v
    record_github_run()    -> the run shows up on the Pipelines page
    sync_run()             -> live status, steps and logs
      |
      v  run finished
    finalize_run()         -> incidents + email alerts
                           -> trigger_auto_deploys() if CI passed
      |
      v
    start_deployment()     -> starts deploy.yml with the environment as input
    sync_deployment()      -> live status and logs
      |
      v  deployment finished
    finalize_deployment()  -> incidents + email alerts
                           -> post-deploy health check on the linked monitor

finalize_run() / finalize_deployment() can be called from the webhook, the
worker and the browser's polling at the same time. A database "claim" on
finish_handled makes sure each run is only handled once.
"""

import logging
import threading
import time
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, close_old_connections, transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from deployments.github_deploy import dispatch_deployment, sync_deployment
from deployments.models import Deployment
from git_integration.models import GitHubConnection
from incidents.services import handle_deployment_finished, handle_pipeline_run_finished
from pipelines.github_actions import (
    API,
    GitHubActionsError,
    _map_status,
    _request,
    fill_run_details,
    sync_run,
)
from pipelines.models import Pipeline, PipelineRun

logger = logging.getLogger(__name__)

ACTIVE_RUN = ["queued", "running"]

# Post-deploy health check: try the monitor a few times, the app may need
# a moment to restart after the deploy finishes
HEALTH_CHECK_ATTEMPTS = 6
HEALTH_CHECK_GAP_SECONDS = 15


def run_in_background(fn, *args):
    """Run fn in a thread with its own DB connection. Tests replace this."""

    def target():
        close_old_connections()
        try:
            fn(*args)
        except Exception:
            logger.exception("Background automation task failed")
        finally:
            close_old_connections()

    threading.Thread(target=target, daemon=True).start()


# ------------------------------------------------------------------
# Pipelines
# ------------------------------------------------------------------

def record_github_run(pipeline, gh_run, *, historical=False):
    """
    Make sure a GitHub workflow run exists as a PipelineRun.
    Returns (run, created). `historical=True` means "just show it, don't act on it".
    """
    github_id = gh_run["id"]

    existing = pipeline.runs.filter(github_run_id=github_id).first()
    if existing:
        return existing, False

    # A run started with the DevOpsPilot "Run" button that we haven't matched yet
    if gh_run.get("event") == "workflow_dispatch":
        created_at = parse_datetime(gh_run.get("created_at") or "") or timezone.now()
        pending = (
            pipeline.runs.filter(
                github_run_id__isnull=True,
                status__in=ACTIVE_RUN,
                created_at__gte=created_at - timedelta(minutes=3),
            )
            .order_by("created_at")
            .first()
        )
        if pending:
            pending.github_run_id = github_id
            fill_run_details(pending, gh_run)
            pending.save()
            return pending, False

    run = PipelineRun(
        pipeline=pipeline,
        triggered_by=None,
        github_run_id=github_id,
        event="other",  # replaced by fill_run_details
        # "queued" so that sync_run() pulls the real status and the logs
        status="queued",
    )
    fill_run_details(run, gh_run)
    who = f" by {run.actor}" if run.actor else ""
    run.logs = f"Started on GitHub ({run.get_event_display()}{who}).\n"

    if historical:
        run.status = _map_status(gh_run.get("status"), gh_run.get("conclusion"))
        run.finish_handled = run.status not in ACTIVE_RUN

    try:
        with transaction.atomic():
            run.save()
    except IntegrityError:
        # The webhook and the worker saw the same run at the same moment
        return pipeline.runs.get(github_run_id=github_id), False

    return run, True


def finalize_run(run):
    """Handle a finished run exactly once: alerts, incidents, auto-deploys."""
    if run.status in ACTIVE_RUN or run.finish_handled:
        return False

    claimed = PipelineRun.objects.filter(pk=run.pk, finish_handled=False).update(
        finish_handled=True
    )
    if not claimed:
        return False
    run.finish_handled = True

    handle_pipeline_run_finished(run)

    if run.status == "success":
        trigger_auto_deploys(run)
    return True


def poll_pipeline(pipeline):
    """Look for new GitHub runs of this pipeline and refresh the active ones."""
    first_sync = pipeline.last_synced_at is None
    now = timezone.now()

    params = {"branch": pipeline.branch, "per_page": 1 if first_sync else 20}
    if not first_sync:
        since = pipeline.last_synced_at - timedelta(minutes=10)
        params["created"] = f">={since.strftime('%Y-%m-%dT%H:%M:%SZ')}"

    response = _request(
        "GET",
        f"{API}/repos/{pipeline.repository}/actions/workflows/{pipeline.workflow_file}/runs",
        pipeline.owner,
        params=params,
    )

    new_runs = 0
    # Oldest first, so run numbers in DevOpsPilot follow the push order
    for gh_run in reversed(response.json().get("workflow_runs", [])):
        _, created = record_github_run(pipeline, gh_run, historical=first_sync)
        new_runs += int(created)

    for run in pipeline.runs.filter(status__in=ACTIVE_RUN).order_by("created_at"):
        sync_run(run)
        finalize_run(run)

    # Runs that finished while nobody was looking (e.g. worker was restarted)
    for run in pipeline.runs.filter(finish_handled=False).exclude(status__in=ACTIVE_RUN):
        finalize_run(run)

    Pipeline.objects.filter(pk=pipeline.pk).update(last_synced_at=now)
    return new_runs


# ------------------------------------------------------------------
# Deployments
# ------------------------------------------------------------------

def start_deployment(deployment, *, source="manual", run=None):
    """
    Start a deployment on GitHub Actions.
    Raises GitHubActionsError (after recording the failure) if GitHub refuses.
    """
    deployment.status = "deploying"
    deployment.started_at = timezone.now()
    deployment.finished_at = None
    deployment.github_run_id = None
    deployment.html_url = ""
    deployment.commit_hash = ""
    deployment.health_status = ""
    deployment.finish_handled = False
    deployment.trigger_source = source
    deployment.triggered_by_run = run

    header = [
        f"Deployment: {deployment.name}",
        f"Environment: {deployment.environment}",
        f"Repository: {deployment.repository}",
        f"Branch: {deployment.branch}",
    ]
    if source == "auto" and run:
        header.append(
            f"Started automatically: CI run #{run.id} passed"
            + (f" for commit {run.head_sha[:7]}" if run.head_sha else "")
        )
    deployment.logs = "\n".join(header) + "\n"
    deployment.save()

    try:
        dispatch_deployment(deployment)
    except GitHubActionsError as exc:
        deployment.status = "failed"
        deployment.finished_at = timezone.now()
        deployment.logs += f"\nFailed to start: {exc}\n"
        deployment.save()
        finalize_deployment(deployment)
        raise


def trigger_auto_deploys(run):
    """CI passed: start every deployment of this pipeline that has auto-deploy on."""
    started = []
    targets = run.pipeline.deployments.filter(auto_deploy=True).order_by("id")

    for deployment in targets:
        if deployment.status == "deploying":
            deployment.logs += (
                f"\nCI run #{run.id} passed, but a deployment is already running. "
                "Skipped; push again or click Deploy once it finishes.\n"
            )
            deployment.save(update_fields=["logs", "updated_at"])
            continue

        if (
            deployment.status == "success"
            and run.head_sha
            and deployment.commit_hash == run.head_sha
        ):
            continue  # this exact commit is already live

        try:
            start_deployment(deployment, source="auto", run=run)
            started.append(deployment)
        except GitHubActionsError:
            pass  # recorded on the deployment + incident opened

    return started


def finalize_deployment(deployment):
    """Handle a finished deployment exactly once: alerts, incidents, health check."""
    if deployment.status == "deploying" or deployment.finish_handled:
        return False

    claimed = Deployment.objects.filter(pk=deployment.pk, finish_handled=False).update(
        finish_handled=True
    )
    if not claimed:
        return False
    deployment.finish_handled = True

    handle_deployment_finished(deployment)

    if deployment.status == "success" and deployment.health_monitor_id:
        Deployment.objects.filter(pk=deployment.pk).update(health_status="checking")
        deployment.health_status = "checking"
        run_in_background(post_deploy_health_check, deployment.pk)
    return True


def post_deploy_health_check(deployment_id):
    """Check the linked monitor until it is up (or give up after a few tries)."""
    from monitoring.checker import check_monitor

    deployment = Deployment.objects.select_related("health_monitor").get(pk=deployment_id)
    monitor = deployment.health_monitor
    if monitor is None:
        return

    check = None
    for attempt in range(1, HEALTH_CHECK_ATTEMPTS + 1):
        if attempt > 1:
            time.sleep(HEALTH_CHECK_GAP_SECONDS)
        monitor.refresh_from_db()
        check = check_monitor(monitor)  # stored + normal incident rules apply
        if check.is_up:
            break

    if check and check.is_up:
        health = "healthy"
        line = (
            f"\nHealth check passed: {monitor.url} answered {check.status_code}"
            f" in {check.response_time_ms} ms (attempt {attempt}).\n"
        )
    else:
        health = "unhealthy"
        reason = (check.error if check else "") or "no response"
        line = (
            f"\nHealth check FAILED after {HEALTH_CHECK_ATTEMPTS} attempts: "
            f"{monitor.url} - {reason}\n"
        )

    # Only touch this deployment if it wasn't re-deployed in the meantime
    current = Deployment.objects.filter(pk=deployment_id, health_status="checking").first()
    if current:
        current.health_status = health
        current.logs += line
        current.save(update_fields=["health_status", "logs", "updated_at"])


def poll_deployment(deployment):
    sync_deployment(deployment)
    finalize_deployment(deployment)


# ------------------------------------------------------------------
# Worker entry point
# ------------------------------------------------------------------

def sync_everything():
    """
    Called by the background worker. Returns a short summary dict.
    One broken repo/token never stops the others.
    """
    summary = {"pipelines": 0, "new_runs": 0, "deployments": 0, "errors": 0}
    connected = GitHubConnection.objects.values_list("user_id", flat=True)

    for pipeline in Pipeline.objects.filter(owner_id__in=connected).select_related("owner"):
        try:
            summary["new_runs"] += poll_pipeline(pipeline)
            summary["pipelines"] += 1
        except GitHubActionsError as exc:
            summary["errors"] += 1
            logger.warning("Pipeline %s sync failed: %s", pipeline.pk, exc)
            # Still mark it, so the UI knows the worker is alive
            Pipeline.objects.filter(pk=pipeline.pk).update(last_synced_at=timezone.now())

    active = Deployment.objects.filter(status="deploying", owner_id__in=connected)
    for deployment in active.select_related("owner", "pipeline"):
        try:
            poll_deployment(deployment)
            summary["deployments"] += 1
        except GitHubActionsError as exc:
            summary["errors"] += 1
            logger.warning("Deployment %s sync failed: %s", deployment.pk, exc)

    # Deployments that failed to finalize earlier (e.g. worker restarted)
    for deployment in Deployment.objects.filter(finish_handled=False).exclude(status__in=["deploying", "pending"]):
        finalize_deployment(deployment)

    return summary


# ------------------------------------------------------------------
# Webhook entry point
# ------------------------------------------------------------------

def process_workflow_run_event(repo_full_name, workflow_file, branch, gh_run):
    """A GitHub `workflow_run` webhook arrived. Update whatever it belongs to."""
    pipelines = Pipeline.objects.filter(
        repository__iexact=repo_full_name,
        workflow_file=workflow_file,
        branch=branch,
    ).select_related("owner")

    for pipeline in pipelines:
        run, _ = record_github_run(pipeline, gh_run)
        sync_run(run)
        finalize_run(run)

    # Deploy workflows send webhooks too
    for deployment in Deployment.objects.filter(
        github_run_id=gh_run["id"], status="deploying"
    ).select_related("owner"):
        poll_deployment(deployment)


def webhook_url():
    base = getattr(settings, "PUBLIC_API_URL", "").rstrip("/")
    return f"{base}/api/github/webhook/" if base else ""