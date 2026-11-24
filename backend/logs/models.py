import hashlib
import secrets

from django.conf import settings
from django.db import models

KEY_PREFIX = "dp_"


def hash_key(raw_key):
    return hashlib.sha256(raw_key.encode()).hexdigest()


class LogSource(models.Model):
    """An app or service that sends logs to DevOpsPilot with its own API key."""

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="log_sources",
    )
    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="log_sources",
    )
    name = models.CharField(max_length=150)

    # Only a hash of the key is stored. The full key is shown once, when created.
    key_hash = models.CharField(max_length=64, unique=True, editable=False)
    key_prefix = models.CharField(max_length=16, editable=False)

    is_active = models.BooleanField(default=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    # Error-spike alerts
    alert_on_errors = models.BooleanField(default=True)
    error_threshold = models.PositiveIntegerField(default=10)
    error_window_minutes = models.PositiveIntegerField(default=5)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    def set_new_key(self):
        """Generate a new API key, store its hash, and return the full key once."""
        raw_key = KEY_PREFIX + secrets.token_urlsafe(32)
        self.key_hash = hash_key(raw_key)
        self.key_prefix = raw_key[:10]
        return raw_key


class LogEntry(models.Model):
    LEVEL_CHOICES = [
        ("debug", "Debug"),
        ("info", "Info"),
        ("warning", "Warning"),
        ("error", "Error"),
        ("critical", "Critical"),
    ]

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="log_entries",
    )
    source = models.ForeignKey(
        LogSource,
        on_delete=models.CASCADE,
        related_name="entries",
    )

    timestamp = models.DateTimeField(db_index=True)
    level = models.CharField(max_length=10, choices=LEVEL_CHOICES, default="info")
    message = models.TextField()
    service = models.CharField(max_length=100, blank=True, default="")
    host = models.CharField(max_length=255, blank=True, default="")
    context = models.JSONField(default=dict, blank=True)
    received_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-timestamp", "-id"]
        indexes = [
            models.Index(fields=["owner", "-timestamp"]),
            models.Index(fields=["owner", "level", "-timestamp"]),
            models.Index(fields=["source", "level", "-timestamp"]),
        ]

    def __str__(self):
        return f"[{self.level}] {self.message[:60]}"