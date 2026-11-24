from django.db import models

# Create your models here.
from datetime import timedelta

from django.conf import settings

from django.utils import timezone


class Monitor(models.Model):
    """A URL that DevOpsPilot checks on a schedule."""

    METHOD_CHOICES = [
        ("GET", "GET"),
        ("HEAD", "HEAD"),
    ]

    STATUS_CHOICES = [
        ("pending", "Pending"),   # created, not checked yet
        ("up", "Up"),
        ("down", "Down"),
        ("paused", "Paused"),
    ]

    INTERVAL_CHOICES = [
        (30, "30 seconds"),
        (60, "1 minute"),
        (300, "5 minutes"),
        (900, "15 minutes"),
        (1800, "30 minutes"),
        (3600, "1 hour"),
    ]

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="monitors",
    )
    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="monitors",
    )

    name = models.CharField(max_length=150)
    url = models.URLField(max_length=500)
    method = models.CharField(max_length=10, choices=METHOD_CHOICES, default="GET")
    interval_seconds = models.PositiveIntegerField(choices=INTERVAL_CHOICES, default=60)
    timeout_seconds = models.PositiveIntegerField(default=10)
    expected_status = models.PositiveIntegerField(default=200)
    # Optional: the response body must contain this text
    keyword = models.CharField(max_length=200, blank=True, default="")

    is_active = models.BooleanField(default=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="pending")

    last_checked_at = models.DateTimeField(null=True, blank=True)
    last_response_ms = models.PositiveIntegerField(null=True, blank=True)
    last_error = models.TextField(blank=True, default="")
    consecutive_failures = models.PositiveIntegerField(default=0)
    status_changed_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.url})"

    def is_due(self, now=None):
        if not self.is_active:
            return False
        if self.last_checked_at is None:
            return True
        now = now or timezone.now()
        return self.last_checked_at + timedelta(seconds=self.interval_seconds) <= now


class MonitorCheck(models.Model):
    """One result of checking a monitor."""

    monitor = models.ForeignKey(
        Monitor,
        on_delete=models.CASCADE,
        related_name="checks",
    )
    checked_at = models.DateTimeField(default=timezone.now, db_index=True)
    is_up = models.BooleanField()
    status_code = models.PositiveIntegerField(null=True, blank=True)
    response_time_ms = models.PositiveIntegerField(null=True, blank=True)
    error = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-checked_at"]
        indexes = [
            models.Index(fields=["monitor", "-checked_at"]),
        ]

    def __str__(self):
        state = "UP" if self.is_up else "DOWN"
        return f"{self.monitor.name} {state} @ {self.checked_at:%Y-%m-%d %H:%M:%S}"