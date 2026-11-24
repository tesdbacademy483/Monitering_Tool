from urllib.parse import urlparse

from rest_framework import serializers

from .models import Monitor, MonitorCheck


class MonitorCheckSerializer(serializers.ModelSerializer):
    class Meta:
        model = MonitorCheck
        fields = ["id", "checked_at", "is_up", "status_code", "response_time_ms", "error"]


class MonitorSerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source="project.name", read_only=True, default=None)
    uptime_24h = serializers.FloatField(read_only=True, default=None)
    avg_response_24h = serializers.FloatField(read_only=True, default=None)
    checks_24h = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Monitor
        fields = [
            "id",
            "name",
            "url",
            "method",
            "interval_seconds",
            "timeout_seconds",
            "expected_status",
            "keyword",
            "project",
            "project_name",
            "is_active",
            "status",
            "last_checked_at",
            "last_response_ms",
            "last_error",
            "consecutive_failures",
            "status_changed_at",
            "uptime_24h",
            "avg_response_24h",
            "checks_24h",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "project_name",
            "status",
            "last_checked_at",
            "last_response_ms",
            "last_error",
            "consecutive_failures",
            "status_changed_at",
            "uptime_24h",
            "avg_response_24h",
            "checks_24h",
            "created_at",
            "updated_at",
        ]

    def validate_url(self, value):
        parsed = urlparse(value)
        if parsed.scheme not in ("http", "https"):
            raise serializers.ValidationError("URL must start with http:// or https://")
        return value

    def validate_timeout_seconds(self, value):
        if not 1 <= value <= 60:
            raise serializers.ValidationError("Timeout must be between 1 and 60 seconds.")
        return value

    def validate_expected_status(self, value):
        if not 100 <= value <= 599:
            raise serializers.ValidationError("Enter a valid HTTP status code (100-599).")
        return value

    def validate_project(self, project):
        user = self.context["request"].user
        if project and project.owner != user and not project.members.filter(pk=user.pk).exists():
            raise serializers.ValidationError("You don't have access to this project.")
        return project