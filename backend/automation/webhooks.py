"""
GitHub webhook receiver + one-click webhook setup.

The webhook makes DevOpsPilot react the moment GitHub Actions starts or
finishes a run. It needs a public URL (PUBLIC_API_URL in .env), for example
your server's domain or an ngrok / cloudflared tunnel while developing.

Without a webhook everything still works: the background worker polls GitHub
every PIPELINE_SYNC_SECONDS (30s by default).
"""

import hashlib
import hmac
import json
import logging
import posixpath

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from pipelines.github_actions import API, GitHubActionsError, _request

from . import engine

logger = logging.getLogger(__name__)


def _valid_signature(secret, body, signature_header):
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header or "")


@csrf_exempt
@require_POST
def github_webhook(request):
    secret = getattr(settings, "GITHUB_WEBHOOK_SECRET", "")
    if not secret:
        return JsonResponse({"error": "GITHUB_WEBHOOK_SECRET is not set on the server."}, status=503)

    if not _valid_signature(secret, request.body, request.headers.get("X-Hub-Signature-256")):
        return JsonResponse({"error": "Invalid signature"}, status=401)

    event = request.headers.get("X-GitHub-Event", "")
    if event == "ping":
        return JsonResponse({"ok": True, "message": "pong"})
    if event != "workflow_run":
        return JsonResponse({"ok": True, "ignored": event}, status=202)

    try:
        payload = json.loads(request.body)
        gh_run = payload["workflow_run"]
        repo = payload["repository"]["full_name"]
        workflow_file = posixpath.basename(gh_run.get("path", ""))
        branch = gh_run.get("head_branch") or ""
    except (ValueError, KeyError, TypeError):
        return JsonResponse({"error": "Unexpected payload"}, status=400)

    # Answer GitHub quickly (it gives up after 10s); do the work in the background
    engine.run_in_background(engine.process_workflow_run_event, repo, workflow_file, branch, gh_run)
    return JsonResponse({"ok": True}, status=202)


def connect_webhook(pipeline):
    """Create the DevOpsPilot webhook on the pipeline's repo (if it isn't there yet)."""
    url = engine.webhook_url()
    secret = getattr(settings, "GITHUB_WEBHOOK_SECRET", "")

    if not url or not secret:
        raise GitHubActionsError(
            "Set PUBLIC_API_URL and GITHUB_WEBHOOK_SECRET in backend/.env first. "
            "Until then the background worker keeps everything in sync by polling."
        )
    if "localhost" in url or "127.0.0.1" in url:
        raise GitHubActionsError(
            "GitHub cannot reach localhost. Use your public domain or a tunnel "
            "(ngrok / cloudflared) as PUBLIC_API_URL."
        )

    hooks_url = f"{API}/repos/{pipeline.repository}/hooks"
    try:
        hooks = _request("GET", hooks_url, pipeline.owner).json()
    except GitHubActionsError as exc:
        raise GitHubActionsError(
            f"{exc} You need admin access to the repo to add a webhook."
        ) from exc

    for hook in hooks:
        if hook.get("config", {}).get("url") == url:
            return {"status": "already_connected", "url": url, "hook_id": hook.get("id")}

    hook = _request(
        "POST",
        hooks_url,
        pipeline.owner,
        json={
            "name": "web",
            "active": True,
            "events": ["workflow_run"],
            "config": {
                "url": url,
                "content_type": "json",
                "secret": secret,
                "insecure_ssl": "0",
            },
        },
    ).json()
    return {"status": "connected", "url": url, "hook_id": hook.get("id")}