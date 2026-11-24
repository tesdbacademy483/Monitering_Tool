from rest_framework import serializers
from .models import Pipeline, PipelineRun


class PipelineSerializer(serializers.ModelSerializer):
    latest_run_status = serializers.SerializerMethodField()
    latest_run = serializers.SerializerMethodField()
    auto_deploy_count = serializers.SerializerMethodField()

    class Meta:
        model = Pipeline
        fields = [
            "id",
            "name",
            "repository",
            "branch",
            "trigger",
            "workflow_file",
            "status",
            "latest_run_status",
            "latest_run",
            "auto_deploy_count",
            "last_synced_at",
            "stages",
            "config",
            "created_at",
            "updated_at",
        ]

        read_only_fields = [
            "id",
            "status",
            "latest_run_status",
            "latest_run",
            "auto_deploy_count",
            "last_synced_at",
            "created_at",
            "updated_at",
        ]

    def validate_workflow_file(self, value):
        # Accept ".github/workflows/ci.yml" or "ci.yml" -> store "ci.yml"
        name = value.strip().split("/")[-1]
        if not name.endswith((".yml", ".yaml")):
            raise serializers.ValidationError("Workflow file must end with .yml or .yaml")
        return name

    def get_latest_run_status(self, obj):
        latest_run = obj.runs.order_by("-created_at").first()
        return latest_run.status if latest_run else None

    def get_latest_run(self, obj):
        run = obj.runs.order_by("-created_at").first()
        if not run:
            return None
        return {
            "id": run.id,
            "status": run.status,
            "event": run.event,
            "actor": run.actor,
            "head_sha": run.head_sha,
            "commit_message": (run.commit_message or "").split("\n")[0][:120],
            "created_at": run.created_at,
        }

    def get_auto_deploy_count(self, obj):
        return obj.deployments.filter(auto_deploy=True).count()


class PipelineRunSerializer(serializers.ModelSerializer):

    class Meta:
        model = PipelineRun
        fields = [
            "id",
            "pipeline",
            "triggered_by",
            "status",
            "event",
            "actor",
            "commit_message",
            "logs",
            "github_run_id",
            "html_url",
            "head_sha",
            "started_at",
            "finished_at",
            "created_at",
        ]

        read_only_fields = [
            "id",
            "triggered_by",
            "status",
            "event",
            "actor",
            "commit_message",
            "logs",
            "github_run_id",
            "html_url",
            "head_sha",
            "started_at",
            "finished_at",
            "created_at",
        ]