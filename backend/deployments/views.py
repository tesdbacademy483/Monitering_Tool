from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from pipelines.github_actions import GitHubActionsError

from automation.engine import finalize_deployment, start_deployment
from pipelines.workflow_setup import build_deploy_preview, commit_workflow, workflow_status

from .github_deploy import cancel_deployment, sync_deployment
from .models import Deployment
from .serializers import DeploymentSerializer


class DeploymentViewSet(viewsets.ModelViewSet):
    serializer_class = DeploymentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return (
            Deployment.objects.filter(owner=self.request.user)
            .select_related("pipeline")
            .order_by("-created_at")
        )

    def _check_ownership(self, serializer):
        pipeline = serializer.validated_data.get("pipeline")
        if pipeline is not None and pipeline.owner != self.request.user:
            raise ValidationError({"pipeline": "You cannot use another user's pipeline."})
        monitor = serializer.validated_data.get("health_monitor")
        if monitor is not None and monitor.owner != self.request.user:
            raise ValidationError({"health_monitor": "You cannot use another user's monitor."})
        return pipeline

    def perform_update(self, serializer):
        pipeline = self._check_ownership(serializer)
        if pipeline is not None:
            serializer.save(repository=pipeline.repository, branch=pipeline.branch)
        else:
            serializer.save()

    def perform_create(self, serializer):
        pipeline = self._check_ownership(serializer)

        serializer.save(
            owner=self.request.user,
            repository=pipeline.repository,
            branch=pipeline.branch,
        )

    # POST /api/deployments/{id}/deploy/
    @action(detail=True, methods=["post"])
    def deploy(self, request, pk=None):
        deployment = self.get_object()

        if deployment.status == "deploying":
            return Response(
                {"detail": "Deployment is already running."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            start_deployment(deployment, source="manual")
        except GitHubActionsError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(self.get_serializer(deployment).data, status=status.HTTP_200_OK)

    # GET /api/deployments/{id}/refresh/   (frontend polls this while deploying)
    @action(detail=True, methods=["get"])
    def refresh(self, request, pk=None):
        deployment = self.get_object()
        try:
            deployment = sync_deployment(deployment)
            finalize_deployment(deployment)  # alerts + health check, only once
        except GitHubActionsError as exc:
            data = self.get_serializer(deployment).data
            data["sync_error"] = str(exc)
            return Response(data)
        return Response(self.get_serializer(deployment).data)

    # POST /api/deployments/{id}/cancel/
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        deployment = self.get_object()

        if deployment.status != "deploying":
            return Response(
                {"detail": "No active deployment to cancel."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        cancel_deployment(deployment)

        deployment.status = "cancelled"
        deployment.finished_at = timezone.now()
        deployment.logs += "\nDeployment cancelled by user.\n"
        deployment.save()
        finalize_deployment(deployment)

        return Response(self.get_serializer(deployment).data, status=status.HTTP_200_OK)

    # ---------------- Deploy workflow setup ----------------

    # GET /api/deployments/{id}/workflow-status/
    @action(detail=True, methods=["get"], url_path="workflow-status")
    def workflow_status(self, request, pk=None):
        deployment = self.get_object()
        try:
            result = workflow_status(
                request.user, deployment.repository, deployment.branch, deployment.workflow_file
            )
        except GitHubActionsError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        result["workflow_file"] = deployment.workflow_file
        return Response(result)

    # GET /api/deployments/{id}/workflow-preview/
    @action(detail=True, methods=["get"], url_path="workflow-preview")
    def workflow_preview(self, request, pk=None):
        deployment = self.get_object()
        try:
            preview = build_deploy_preview(request.user, deployment.repository, deployment.branch)
        except GitHubActionsError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        preview["path"] = f".github/workflows/{deployment.workflow_file}"
        preview["branch"] = deployment.branch
        return Response(preview)

    # POST /api/deployments/{id}/setup-workflow/   body: {"content": "<yaml>"}
    @action(detail=True, methods=["post"], url_path="setup-workflow")
    def setup_workflow(self, request, pk=None):
        deployment = self.get_object()
        try:
            result = commit_workflow(
                request.user,
                deployment.repository,
                deployment.branch,
                deployment.workflow_file,
                request.data.get("content", ""),
                message=f"Add {deployment.workflow_file} (DevopsPilot deploy)",
            )
        except GitHubActionsError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result, status=status.HTTP_201_CREATED)