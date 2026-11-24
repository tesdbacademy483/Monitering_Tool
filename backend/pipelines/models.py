from django.conf import settings
from django.db import models


class Pipeline(models.Model):

    TRIGGER_CHOICES = [
        ("manual", "Manual"),
        ("push", "Push"),
    ]

    STATUS_CHOICES = [
        ("idle", "Idle"),
        ("running", "Running"),
        ("success", "Success"),
        ("failed", "Failed"),
    ]

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="pipelines",
    )

    name = models.CharField(max_length=150)

    repository = models.CharField(max_length=255)

    branch = models.CharField(
        max_length=100,
        default="main",
    )

    trigger = models.CharField(
        max_length=20,
        choices=TRIGGER_CHOICES,
        default="manual",
    )

    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="idle",
    )

    workflow_file = models.CharField(
        max_length=255,
        default="devopspilot.yml",
        help_text="File name inside .github/workflows/ in the repository",
    )

    stages = models.JSONField(default=list, blank=True)

    config = models.TextField(blank=True)

    # Set by the background worker each time it checks GitHub for new runs
    last_synced_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name


# ==========================================
# Pipeline Run Model
# ==========================================

class PipelineRun(models.Model):

    STATUS_CHOICES = [
        ("queued", "Queued"),
        ("running", "Running"),
        ("success", "Success"),
        ("failed", "Failed"),
        ("cancelled", "Cancelled"),
    ]

    pipeline = models.ForeignKey(
        Pipeline,
        on_delete=models.CASCADE,
        related_name="runs",
    )

    EVENT_CHOICES = [
        ("manual", "Manual (DevOpsPilot)"),
        ("push", "Git push"),
        ("pull_request", "Pull request"),
        ("workflow_dispatch", "Workflow dispatch"),
        ("schedule", "Schedule"),
        ("other", "Other"),
    ]

    # Empty when the run came from GitHub (for example a git push)
    triggered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )

    # What started the run, and who/what commit it was for
    event = models.CharField(max_length=30, choices=EVENT_CHOICES, default="manual")
    actor = models.CharField(max_length=150, blank=True, default="")
    commit_message = models.TextField(blank=True, default="")

    # True once incidents/alerts/auto-deploys have been handled for this run,
    # so the webhook, the worker and the browser never handle it twice
    finish_handled = models.BooleanField(default=False)

    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="queued",
    )

    logs = models.TextField(
        blank=True,
        default="",
    )

    # GitHub Actions tracking
    github_run_id = models.BigIntegerField(null=True, blank=True)
    html_url = models.URLField(max_length=500, blank=True, default="")
    head_sha = models.CharField(max_length=40, blank=True, default="")

    started_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    finished_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["pipeline", "github_run_id"],
                name="unique_github_run_per_pipeline",
            ),
        ]

    def __str__(self):
        return f"{self.pipeline.name} - Run #{self.id}"