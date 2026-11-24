from django.test import TestCase

# Create your tests here.
"""
End-to-end tests for push-to-deploy automation, against a fake GitHub API.

    python manage.py test automation
"""

import hashlib
import hmac
import json
import re
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from automation import engine
from deployments.models import Deployment
from git_integration.models import GitHubConnection
from incidents.models import Incident
from monitoring.models import Monitor
from pipelines.models import Pipeline, PipelineRun
from pipelines.workflow_setup import generate_deploy_workflow, generate_workflow

REPO = "octo/shop"


class FakeResponse:
    def __init__(self, status=200, data=None, text=""):
        self.status_code = status
        self._data = data
        self.text = text or (json.dumps(data) if data is not None else "")
        self.content = self.text.encode()
        self.headers = {"X-OAuth-Scopes": "repo, workflow"}

    def json(self):
        return self._data


class FakeGitHub:
    """Just enough of the GitHub REST API for DevOpsPilot."""

    def __init__(self):
        self.runs = {}            # id -> run dict
        self.dispatches = []      # (workflow, body)
        self.hooks = []
        self.next_id = 1000

    def add_run(self, workflow="ci.yml", event="push", status="queued", conclusion=None,
                sha="a" * 40, message="Fix checkout bug", actor="dev1"):
        self.next_id += 1
        run = {
            "id": self.next_id,
            "path": f".github/workflows/{workflow}",
            "event": event,
            "status": status,
            "conclusion": conclusion,
            "head_sha": sha,
            "head_branch": "main",
            "head_commit": {"message": message},
            "actor": {"login": actor},
            "html_url": f"https://github.com/{REPO}/actions/runs/{self.next_id}",
            "created_at": "2026-11-24T04:00:00Z",
            "updated_at": "2026-11-24T04:05:00Z",
            "run_started_at": "2026-11-24T04:00:05Z",
            "_workflow": workflow,
        }
        self.runs[run["id"]] = run
        return run

    def finish(self, run, conclusion="success"):
        run["status"], run["conclusion"] = "completed", conclusion

    def __call__(self, method, url, headers=None, **kwargs):
        path = url.replace("https://api.github.com", "")

        m = re.fullmatch(rf"/repos/{REPO}/actions/workflows/([^/]+)/runs", path)
        if m and method == "GET":
            runs = [r for r in self.runs.values() if r["_workflow"] == m.group(1)]
            runs.sort(key=lambda r: -r["id"])  # newest first, like GitHub
            per_page = kwargs.get("params", {}).get("per_page", 30)
            return FakeResponse(data={"workflow_runs": runs[:per_page]})

        m = re.fullmatch(rf"/repos/{REPO}/actions/workflows/([^/]+)/dispatches", path)
        if m and method == "POST":
            self.dispatches.append((m.group(1), kwargs.get("json")))
            run = self.add_run(workflow=m.group(1), event="workflow_dispatch", status="queued")
            return FakeResponse(data={"workflow_run_id": run["id"], "html_url": run["html_url"]})

        m = re.fullmatch(rf"/repos/{REPO}/actions/runs/(\d+)", path)
        if m:
            return FakeResponse(data=self.runs[int(m.group(1))])

        m = re.fullmatch(rf"/repos/{REPO}/actions/runs/(\d+)/jobs", path)
        if m:
            run = self.runs[int(m.group(1))]
            return FakeResponse(data={"jobs": [{
                "id": run["id"] * 10, "name": "build", "status": run["status"],
                "conclusion": run["conclusion"],
                "steps": [{"name": "npm test", "status": run["status"], "conclusion": run["conclusion"]}],
            }]})

        if re.fullmatch(rf"/repos/{REPO}/actions/jobs/\d+/logs", path):
            return FakeResponse(text="all good\n")

        if path == f"/repos/{REPO}/hooks":
            if method == "GET":
                return FakeResponse(data=self.hooks)
            hook = {"id": len(self.hooks) + 1, "config": kwargs["json"]["config"]}
            self.hooks.append(hook)
            return FakeResponse(status=201, data=hook)

        raise AssertionError(f"Unexpected GitHub call: {method} {path}")


def run_now(fn, *args):
    fn(*args)


@override_settings(ALERTS_SEND_IN_BACKGROUND=False)
@mock.patch.object(engine, "run_in_background", run_now)
@mock.patch.object(engine, "HEALTH_CHECK_GAP_SECONDS", 0)
class AutomationTests(TestCase):
    def setUp(self):
        self.github = FakeGitHub()
        patcher = mock.patch("pipelines.github_actions.requests.request", self.github)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.user = get_user_model().objects.create_user("dev", "dev@example.com", "pw")
        GitHubConnection.objects.create(user=self.user, github_username="dev", access_token="t")
        self.pipeline = Pipeline.objects.create(
            owner=self.user, name="Shop CI", repository=REPO, branch="main",
            trigger="push", workflow_file="ci.yml",
        )
        self.staging = Deployment.objects.create(
            owner=self.user, pipeline=self.pipeline, name="Shop", repository=REPO,
            branch="main", environment="staging", workflow_file="deploy.yml",
            auto_deploy=True,
        )

    # -------------------------------------------------- helpers

    def first_sync(self):
        """The first sync only imports history; it must never deploy."""
        old = self.github.add_run(status="completed", conclusion="success", sha="0" * 40)
        engine.sync_everything()
        return old

    def site(self, status_code):
        """Patch HTTP so the monitored site answers `status_code`; GitHub stays fake."""
        page = mock.Mock(status_code=status_code, text="page")

        def route(method, url, **kwargs):
            if url.startswith("https://api.github.com"):
                return self.github(method, url, **kwargs)
            return page

        return mock.patch("pipelines.github_actions.requests.request", side_effect=route)

    def finish_deploy(self, conclusion="success"):
        self.staging.refresh_from_db()
        self.github.finish(self.github.runs[self.staging.github_run_id], conclusion)
        engine.sync_everything()
        self.staging.refresh_from_db()

    # -------------------------------------------------- tests

    def test_first_sync_imports_history_without_deploying(self):
        self.first_sync()
        run = self.pipeline.runs.get()
        self.assertEqual(run.status, "success")
        self.assertTrue(run.finish_handled)
        self.assertEqual(self.github.dispatches, [])

    def test_push_runs_ci_then_auto_deploys(self):
        self.first_sync()

        # Developer pushes; GitHub starts CI
        gh = self.github.add_run(sha="b" * 40, message="Add cart page\n\nlong body")
        engine.sync_everything()
        run = self.pipeline.runs.get(github_run_id=gh["id"])
        self.assertEqual(run.event, "push")
        self.assertEqual(run.actor, "dev1")
        self.assertEqual(run.status, "queued")
        self.assertIsNone(run.triggered_by)
        self.assertEqual(self.github.dispatches, [])

        # CI passes -> deploy.yml dispatched with the environment
        self.github.finish(gh, "success")
        engine.sync_everything()
        run.refresh_from_db()
        self.assertEqual(run.status, "success")
        self.assertIn("Add cart page", run.logs)
        self.assertEqual(
            self.github.dispatches,
            [("deploy.yml", {"ref": "main", "inputs": {"environment": "staging"},
                             "return_run_details": True})],
        )
        self.staging.refresh_from_db()
        self.assertEqual(self.staging.status, "deploying")
        self.assertEqual(self.staging.trigger_source, "auto")
        self.assertEqual(self.staging.triggered_by_run, run)

        # Deploy finishes
        self.finish_deploy("success")
        self.assertEqual(self.staging.status, "success")
        self.assertEqual(self.staging.commit_hash, "a" * 40)
        self.assertIn("CI run #", self.staging.logs)

        # Syncing again never deploys twice
        engine.sync_everything()
        engine.finalize_run(run)
        self.assertEqual(len(self.github.dispatches), 1)

    def test_failed_ci_opens_incident_and_does_not_deploy(self):
        self.first_sync()
        gh = self.github.add_run(status="completed", conclusion="failure", sha="c" * 40)
        engine.sync_everything()

        run = self.pipeline.runs.get(github_run_id=gh["id"])
        self.assertEqual(run.status, "failed")
        self.assertTrue(Incident.objects.filter(pipeline=self.pipeline, status="open").exists())
        self.assertEqual(self.github.dispatches, [])

    def test_manual_deploy_off_means_no_auto_deploy(self):
        self.staging.auto_deploy = False
        self.staging.save()
        self.first_sync()
        self.github.add_run(status="completed", conclusion="success", sha="d" * 40)
        engine.sync_everything()
        self.assertEqual(self.github.dispatches, [])

    def test_same_commit_already_live_is_skipped(self):
        self.staging.status = "success"
        self.staging.commit_hash = "e" * 40
        self.staging.finish_handled = True
        self.staging.save()
        self.first_sync()
        self.github.add_run(status="completed", conclusion="success", sha="e" * 40)
        engine.sync_everything()
        self.assertEqual(self.github.dispatches, [])

    def test_failed_deploy_opens_incident(self):
        self.first_sync()
        self.github.add_run(status="completed", conclusion="success", sha="f" * 40)
        engine.sync_everything()
        self.finish_deploy("failure")
        self.assertEqual(self.staging.status, "failed")
        self.assertTrue(Incident.objects.filter(deployment=self.staging, status="open").exists())

    def test_health_check_after_deploy(self):
        monitor = Monitor.objects.create(owner=self.user, name="Shop site", url="https://shop.example.com/")
        self.staging.health_monitor = monitor
        self.staging.save()
        self.first_sync()
        self.github.add_run(status="completed", conclusion="success", sha="1" * 40)
        engine.sync_everything()

        with self.site(200):
            self.finish_deploy("success")

        self.staging.refresh_from_db()
        self.assertEqual(self.staging.health_status, "healthy")
        self.assertIn("Health check passed", self.staging.logs)
        self.assertEqual(monitor.checks.count(), 1)

    def test_health_check_failure_is_reported(self):
        monitor = Monitor.objects.create(owner=self.user, name="Shop site", url="https://shop.example.com/")
        self.staging.health_monitor = monitor
        self.staging.save()
        self.first_sync()
        self.github.add_run(status="completed", conclusion="success", sha="2" * 40)
        engine.sync_everything()

        with self.site(502):
            self.finish_deploy("success")

        self.staging.refresh_from_db()
        self.assertEqual(self.staging.health_status, "unhealthy")
        self.assertIn("Health check FAILED", self.staging.logs)
        self.assertEqual(monitor.checks.count(), engine.HEALTH_CHECK_ATTEMPTS)
        # Monitor's own rules (2 failures by default) opened a "down" incident
        self.assertTrue(Incident.objects.filter(monitor=monitor, status="open").exists())

    def test_manual_run_button_is_not_duplicated_by_worker(self):
        self.first_sync()
        client = APIClient()
        client.force_authenticate(self.user)
        with mock.patch("pipelines.github_actions.time.sleep"):
            response = client.post(f"/api/pipelines/{self.pipeline.id}/run/")
        self.assertEqual(response.status_code, 201)
        engine.sync_everything()
        self.assertEqual(self.pipeline.runs.filter(event="manual").count(), 1)
        self.assertEqual(self.pipeline.runs.count(), 2)  # history + this run

    def test_dispatched_run_not_matched_yet_is_attached_not_duplicated(self):
        self.first_sync()
        pending = PipelineRun.objects.create(pipeline=self.pipeline, triggered_by=self.user)
        self.github.add_run(event="workflow_dispatch", status="in_progress")
        engine.sync_everything()
        pending.refresh_from_db()
        self.assertIsNotNone(pending.github_run_id)
        self.assertEqual(pending.status, "running")
        self.assertEqual(pending.event, "manual")
        self.assertEqual(self.pipeline.runs.count(), 2)


@override_settings(GITHUB_WEBHOOK_SECRET="s3cret", ALERTS_SEND_IN_BACKGROUND=False,
                   PUBLIC_API_URL="https://pilot.example.com")
@mock.patch.object(engine, "run_in_background", run_now)
class WebhookTests(TestCase):
    def setUp(self):
        self.github = FakeGitHub()
        patcher = mock.patch("pipelines.github_actions.requests.request", self.github)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.user = get_user_model().objects.create_user("dev", "dev@example.com", "pw")
        GitHubConnection.objects.create(user=self.user, github_username="dev", access_token="t")
        self.pipeline = Pipeline.objects.create(
            owner=self.user, name="Shop CI", repository=REPO, workflow_file="ci.yml",
        )
        Deployment.objects.create(
            owner=self.user, pipeline=self.pipeline, name="Shop", repository=REPO,
            environment="production", auto_deploy=True,
        )

    def post(self, payload, secret="s3cret", event="workflow_run"):
        body = json.dumps(payload).encode()
        sig = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        return self.client.post(
            "/api/github/webhook/", body, content_type="application/json",
            HTTP_X_HUB_SIGNATURE_256=sig, HTTP_X_GITHUB_EVENT=event,
        )

    def test_bad_signature_rejected(self):
        response = self.post({"zen": "hi"}, secret="wrong", event="ping")
        self.assertEqual(response.status_code, 401)

    def test_ping(self):
        self.assertEqual(self.post({"zen": "hi"}, event="ping").status_code, 200)

    def test_completed_run_webhook_deploys(self):
        gh = self.github.add_run(status="completed", conclusion="success", sha="9" * 40)
        payload = {"action": "completed", "workflow_run": gh, "repository": {"full_name": "Octo/Shop"}}
        response = self.post(payload)
        self.assertEqual(response.status_code, 202)
        run = self.pipeline.runs.get(github_run_id=gh["id"])
        self.assertEqual(run.status, "success")
        self.assertEqual(self.github.dispatches[0][1]["inputs"], {"environment": "production"})

        # GitHub retries the webhook: nothing happens twice
        self.post(payload)
        self.assertEqual(self.pipeline.runs.count(), 1)
        self.assertEqual(len(self.github.dispatches), 1)

    def test_connect_webhook_endpoint(self):
        client = APIClient()
        client.force_authenticate(self.user)
        url = f"/api/pipelines/{self.pipeline.id}/connect-webhook/"
        first = client.post(url).json()
        second = client.post(url).json()
        self.assertEqual(first["status"], "connected")
        self.assertEqual(second["status"], "already_connected")
        self.assertEqual(self.github.hooks[0]["config"]["url"], "https://pilot.example.com/api/github/webhook/")

    def test_automation_status(self):
        client = APIClient()
        client.force_authenticate(self.user)
        data = client.get("/api/pipelines/automation-status/").json()
        self.assertTrue(data["webhook_available"])
        self.assertFalse(data["worker_running"])
        engine.sync_everything()
        self.assertTrue(client.get("/api/pipelines/automation-status/").json()["worker_running"])


class DeployWorkflowTests(TestCase):
    def test_generated_deploy_workflow_is_valid(self):
        import yaml

        stacks = [{"stack": "node", "dir": "frontend", "manager": "npm-ci", "scripts": {"build": "vite build"}},
                  {"stack": "django", "dir": "backend", "requirements": True, "pyproject": False, "tests": False}]
        doc = yaml.safe_load(generate_deploy_workflow(stacks))
        on = doc.get("on", doc.get(True))
        self.assertEqual(on["workflow_dispatch"]["inputs"]["environment"]["options"],
                         ["development", "staging", "production"])
        self.assertEqual(doc["jobs"]["deploy"]["needs"], ["node_frontend", "django_backend"])
        self.assertEqual(doc["jobs"]["deploy"]["environment"], "${{ inputs.environment }}")

    def test_deployment_api_toggle_and_monitor(self):
        user = get_user_model().objects.create_user("u", "u@example.com", "pw")
        other = get_user_model().objects.create_user("o", "o@example.com", "pw")
        pipeline = Pipeline.objects.create(owner=user, name="p", repository=REPO)
        dep = Deployment.objects.create(owner=user, pipeline=pipeline, name="d", repository=REPO)
        mine = Monitor.objects.create(owner=user, name="m", url="https://a.example.com")
        theirs = Monitor.objects.create(owner=other, name="x", url="https://b.example.com")

        client = APIClient()
        client.force_authenticate(user)
        ok = client.patch(f"/api/deployments/{dep.id}/", {"auto_deploy": True, "health_monitor": mine.id}, format="json")
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertTrue(ok.json()["auto_deploy"])
        self.assertEqual(ok.json()["health_monitor_name"], "m")
        bad = client.patch(f"/api/deployments/{dep.id}/", {"health_monitor": theirs.id}, format="json")
        self.assertEqual(bad.status_code, 400)


class CIWorkflowTests(TestCase):
    def test_push_trigger_controls_on_push(self):
        import yaml

        stacks = [{"stack": "go", "dir": ""}]
        auto = yaml.safe_load(generate_workflow(stacks, "main", on_push=True))
        manual = yaml.safe_load(generate_workflow(stacks, "main", on_push=False))
        self.assertEqual(auto[True]["push"], {"branches": ["main"]})
        self.assertNotIn("push", manual[True])
        self.assertIn("workflow_dispatch", manual[True])