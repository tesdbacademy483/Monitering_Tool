from rest_framework import serializers
from .models import Deployment


class DeploymentSerializer(serializers.ModelSerializer):
    pipeline_name = serializers.CharField(
        source="pipeline.name",
        read_only=True,
    )
    health_monitor_name = serializers.CharField(
        source="health_monitor.name",
        read_only=True,
        default=None,
    )

    class Meta:
        model = Deployment
        fields = [
            "id",
            "name",
            "pipeline",
            "pipeline_name",
            "repository",
            "branch",
            "environment",
            "status",
            "commit_hash",
            "workflow_file",
            "github_run_id",
            "html_url",
            "logs",
            "auto_deploy",
            "health_monitor",
            "health_monitor_name",
            "health_status",
            "trigger_source",
            "triggered_by_run",
            "created_at",
            "started_at",
            "finished_at",
            "updated_at",
        ]

        read_only_fields = [
            "id",
            "pipeline_name",
            "repository",
            "branch",
            "status",
            "commit_hash",
            "github_run_id",
            "html_url",
            "logs",
            "health_monitor_name",
            "health_status",
            "trigger_source",
            "triggered_by_run",
            "created_at",
            "started_at",
            "finished_at",
            "updated_at",
        ]

    def validate_workflow_file(self, value):
        # Accept ".github/workflows/deploy.yml" or "deploy.yml" -> store "deploy.yml"
        name = value.strip().split("/")[-1]
        if not name.endswith((".yml", ".yaml")):
            raise serializers.ValidationError("Workflow file must end with .yml or .yaml")
        return name