from rest_framework import serializers

from .models import LogEntry, LogSource


class LogSourceSerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source="project.name", read_only=True, default=None)
    logs_24h = serializers.IntegerField(read_only=True, default=0)
    errors_24h = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = LogSource
        fields = [
            "id",
            "name",
            "project",
            "project_name",
            "key_prefix",
            "is_active",
            "last_used_at",
            "alert_on_errors",
            "error_threshold",
            "error_window_minutes",
            "logs_24h",
            "errors_24h",
            "created_at",
        ]
        read_only_fields = ["id", "key_prefix", "last_used_at", "created_at"]

    def validate_error_threshold(self, value):
        if not 1 <= value <= 10000:
            raise serializers.ValidationError("Choose a number between 1 and 10000.")
        return value

    def validate_error_window_minutes(self, value):
        if not 1 <= value <= 60:
            raise serializers.ValidationError("Choose between 1 and 60 minutes.")
        return value

    def validate_project(self, project):
        user = self.context["request"].user
        if project and project.owner != user and not project.members.filter(pk=user.pk).exists():
            raise serializers.ValidationError("You don't have access to this project.")
        return project


class LogEntrySerializer(serializers.ModelSerializer):
    source_name = serializers.CharField(source="source.name", read_only=True)

    class Meta:
        model = LogEntry
        fields = [
            "id",
            "timestamp",
            "level",
            "message",
            "service",
            "host",
            "context",
            "source",
            "source_name",
        ]