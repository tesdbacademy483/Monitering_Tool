from rest_framework import serializers

from .models import AlertSettings, Incident, IncidentEvent


class IncidentEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = IncidentEvent
        fields = ["id", "kind", "message", "created_at"]


class IncidentSerializer(serializers.ModelSerializer):
    duration_seconds = serializers.IntegerField(read_only=True)
    monitor_name = serializers.CharField(source="monitor.name", read_only=True, default=None)
    deployment_name = serializers.CharField(source="deployment.name", read_only=True, default=None)
    pipeline_name = serializers.CharField(source="pipeline.name", read_only=True, default=None)
    log_source_name = serializers.CharField(source="log_source.name", read_only=True, default=None)

    class Meta:
        model = Incident
        fields = [
            "id",
            "title",
            "description",
            "source",
            "severity",
            "status",
            "monitor",
            "monitor_name",
            "deployment",
            "deployment_name",
            "pipeline",
            "pipeline_name",
            "log_source",
            "log_source_name",
            "started_at",
            "acknowledged_at",
            "resolved_at",
            "resolved_automatically",
            "duration_seconds",
        ]
        read_only_fields = fields


class IncidentDetailSerializer(IncidentSerializer):
    events = IncidentEventSerializer(many=True, read_only=True)

    class Meta(IncidentSerializer.Meta):
        fields = IncidentSerializer.Meta.fields + ["events"]
        read_only_fields = fields


class AlertSettingsSerializer(serializers.ModelSerializer):
    account_email = serializers.EmailField(source="user.email", read_only=True)
    email_configured = serializers.SerializerMethodField()

    class Meta:
        model = AlertSettings
        fields = [
            "email_enabled",
            "email",
            "account_email",
            "email_configured",
            "notify_monitor_down",
            "notify_deployment_failed",
            "notify_pipeline_failed",
            "notify_log_errors",
            "notify_recovery",
            "monitor_failure_threshold",
        ]

    def get_email_configured(self, obj):
        from django.conf import settings

        return bool(getattr(settings, "ALERT_EMAIL_CONFIGURED", False))

    def validate_monitor_failure_threshold(self, value):
        if not 1 <= value <= 10:
            raise serializers.ValidationError("Choose a number between 1 and 10.")
        return value