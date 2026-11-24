from django.utils import timezone

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .github_actions import (
    GitHubActionsError,
    cancel_run,
    dispatch_workflow,
    sync_run,
)
from django.conf import settings
from django.db.models import Max
from datetime import timedelta

from .models import Pipeline, PipelineRun
from automation.engine import finalize_run, webhook_url
from automation.webhooks import connect_webhook as connect_repo_webhook
from .workflow_setup import build_preview, commit_workflow, workflow_status
from .serializers import PipelineSerializer, PipelineRunSerializer

ACTIVE = ["queued", "running"]


class PipelineViewSet(viewsets.ModelViewSet):
    serializer_class = PipelineSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Pipeline.objects.filter(
            owner=self.request.user
        ).order_by("-created_at")

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    # POST /api/pipelines/{id}/run/
    @action(detail=True, methods=["post"])
    def run(self, request, pk=None):
        pipeline = self.get_object()

        if pipeline.runs.filter(status__in=ACTIVE).exists():
            return Response(
                {"detail": "This pipeline already has an active run."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        pipeline_run = PipelineRun.objects.create(
            pipeline=pipeline,
            triggered_by=request.user,
            status="queued",
            logs=(
                f"Pipeline: {pipeline.name}\n"
                f"Repository: {pipeline.repository}\n"
                f"Branch: {pipeline.branch}\n"
            ),
        )

        try:
            dispatch_workflow(pipeline, pipeline_run)
        except GitHubActionsError as exc:
            pipeline_run.status = "failed"
            pipeline_run.finished_at = timezone.now()
            pipeline_run.logs += f"\nFailed to start: {exc}\n"
            pipeline_run.save(update_fields=["status", "finished_at", "logs"])

            pipeline.status = "failed"
            pipeline.save(update_fields=["status", "updated_at"])

            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        pipeline.status = "running"
        pipeline.save(update_fields=["status", "updated_at"])

        return Response(
            PipelineRunSerializer(pipeline_run).data,
            status=status.HTTP_201_CREATED,
        )

    # GET /api/pipelines/{id}/latest-run/   (frontend polls this)
    @action(detail=True, methods=["get"], url_path="latest-run")
    def latest_run(self, request, pk=None):
        pipeline = self.get_object()
        run = pipeline.runs.order_by("-created_at").first()

        if not run:
            return Response({"detail": "No runs yet."}, status=status.HTTP_404_NOT_FOUND)

        try:
            run = sync_run(run)
            finalize_run(run)  # alerts + auto-deploy, only once per run
        except GitHubActionsError as exc:
            data = PipelineRunSerializer(run).data
            data["sync_error"] = str(exc)
            return Response(data)

        return Response(PipelineRunSerializer(run).data)

    # GET /api/pipelines/{id}/runs/   (run history)
    @action(detail=True, methods=["get"])
    def runs(self, request, pk=None):
        pipeline = self.get_object()
        runs = pipeline.runs.order_by("-created_at")[:20]
        return Response(PipelineRunSerializer(runs, many=True).data)

    # POST /api/pipelines/{id}/stop/
    @action(detail=True, methods=["post"])
    def stop(self, request, pk=None):
        pipeline = self.get_object()

        active_run = pipeline.runs.filter(
            status__in=ACTIVE
        ).order_by("-created_at").first()

        if not active_run:
            return Response(
                {"detail": "No active run found for this pipeline."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        cancel_run(active_run)

        active_run.status = "cancelled"
        active_run.finished_at = timezone.now()
        active_run.logs += "\nRun cancelled by user.\n"
        active_run.save(update_fields=["status", "finished_at", "logs"])
        finalize_run(active_run)

        pipeline.status = "idle"
        pipeline.save(update_fields=["status", "updated_at"])

        return Response(
            PipelineRunSerializer(active_run).data,
            status=status.HTTP_200_OK,
        )

    # ---------------- Workflow setup ----------------

    # GET /api/pipelines/{id}/workflow-status/
    @action(detail=True, methods=["get"], url_path="workflow-status")
    def workflow_status(self, request, pk=None):
        pipeline = self.get_object()
        try:
            result = workflow_status(
                request.user, pipeline.repository, pipeline.branch, pipeline.workflow_file
            )
        except GitHubActionsError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        result["workflow_file"] = pipeline.workflow_file
        result["branch"] = pipeline.branch
        return Response(result)

    # GET /api/pipelines/{id}/workflow-preview/
    @action(detail=True, methods=["get"], url_path="workflow-preview")
    def workflow_preview(self, request, pk=None):
        pipeline = self.get_object()
        try:
            preview = build_preview(
                request.user, pipeline.repository, pipeline.branch,
                on_push=pipeline.trigger == "push",
            )
        except GitHubActionsError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        preview["path"] = f".github/workflows/{pipeline.workflow_file}"
        preview["branch"] = pipeline.branch
        return Response(preview)

    # POST /api/pipelines/{id}/setup-workflow/   body: {"content": "<yaml>"}
    @action(detail=True, methods=["post"], url_path="setup-workflow")
    def setup_workflow(self, request, pk=None):
        pipeline = self.get_object()
        content = request.data.get("content", "")

        try:
            result = commit_workflow(
                request.user,
                pipeline.repository,
                pipeline.branch,
                pipeline.workflow_file,
                content,
            )
        except GitHubActionsError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(result, status=status.HTTP_201_CREATED)

    # ---------------- Automation ----------------

    # GET /api/pipelines/automation-status/
    @action(detail=False, methods=["get"], url_path="automation-status")
    def automation_status(self, request):
        pipelines = self.get_queryset()
        last_sync = pipelines.aggregate(last=Max("last_synced_at"))["last"]
        interval = settings.PIPELINE_SYNC_SECONDS
        worker_running = bool(
            last_sync and timezone.now() - last_sync < timedelta(seconds=max(120, interval * 4))
        )
        return Response({
            "worker_running": worker_running,
            "last_synced_at": last_sync,
            "poll_interval_seconds": interval,
            "webhook_available": bool(webhook_url() and settings.GITHUB_WEBHOOK_SECRET),
            "webhook_url": webhook_url(),
        })

    # POST /api/pipelines/{id}/connect-webhook/
    @action(detail=True, methods=["post"], url_path="connect-webhook")
    def connect_webhook(self, request, pk=None):
        pipeline = self.get_object()
        try:
            result = connect_repo_webhook(pipeline)
        except GitHubActionsError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result)