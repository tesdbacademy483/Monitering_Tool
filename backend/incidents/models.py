from django.conf import settings
from django.db import models


class Incident(models.Model):
    """Something broke: a monitor went down, a deployment or pipeline failed."""

    SOURCE_CHOICES = [
        ("monitor", "Monitor"),
        ("deployment", "Deployment"),
        ("pipeline", "Pipeline"),
        ("logs", "Logs"),
        ("manual", "Manual"),
    ]

    SEVERITY_CHOICES = [
        ("critical", "Critical"),
        ("warning", "Warning"),
        ("info", "Info"),
    ]

    STATUS_CHOICES = [
        ("open", "Open"),
        ("acknowledged", "Acknowledged"),
        ("resolved", "Resolved"),
    ]

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="incidents",
    )

    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES)
    severity = models.CharField(max_length=20, choices=SEVERITY_CHOICES, default="critical")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="open")

    # What caused it (only one is set)
    monitor = models.ForeignKey(
        "monitoring.Monitor",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="incidents",
    )
    deployment = models.ForeignKey(
        "deployments.Deployment",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="incidents",
    )
    pipeline = models.ForeignKey(
        "pipelines.Pipeline",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="incidents",
    )
    log_source = models.ForeignKey(
        "logs.LogSource",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="incidents",
    )

    started_at = models.DateTimeField()
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_automatically = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-started_at"]
        indexes = [models.Index(fields=["owner", "status"])]

    def __str__(self):
        return f"[{self.status}] {self.title}"

    @property
    def duration_seconds(self):
        from django.utils import timezone

        end = self.resolved_at or timezone.now()
        return int((end - self.started_at).total_seconds())


class IncidentEvent(models.Model):
    """Timeline entry for an incident."""

    KIND_CHOICES = [
        ("opened", "Opened"),
        ("alert_sent", "Alert sent"),
        ("alert_failed", "Alert failed"),
        ("acknowledged", "Acknowledged"),
        ("resolved", "Resolved"),
        ("reopened", "Reopened"),
        ("note", "Note"),
    ]

    incident = models.ForeignKey(Incident, on_delete=models.CASCADE, related_name="events")
    kind = models.CharField(max_length=20, choices=KIND_CHOICES)
    message = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.kind}: {self.message[:50]}"


class AlertSettings(models.Model):
    """Where and when a user gets alerts."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="alert_settings",
    )

    email_enabled = models.BooleanField(default=True)
    email = models.EmailField(blank=True, default="", help_text="Empty = account email")

    notify_monitor_down = models.BooleanField(default=True)
    notify_deployment_failed = models.BooleanField(default=True)
    notify_pipeline_failed = models.BooleanField(default=True)
    notify_log_errors = models.BooleanField(default=True)
    notify_recovery = models.BooleanField(default=True)

    # A monitor must fail this many checks in a row before an incident opens
    monitor_failure_threshold = models.PositiveIntegerField(default=2)

    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Alert settings for {self.user}"

    @property
    def recipient(self):
        return self.email or self.user.email