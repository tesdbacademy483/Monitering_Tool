from django.conf import settings
from django.db import models
from pipelines.models import Pipeline


class Deployment(models.Model):

    ENVIRONMENT_CHOICES = [
        ("development", "Development"),
        ("staging", "Staging"),
        ("production", "Production"),
    ]

    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("deploying", "Deploying"),
        ("success", "Success"),
        ("failed", "Failed"),
        ("cancelled", "Cancelled"),
    ]

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="deployments",
    )

    pipeline = models.ForeignKey(
        Pipeline,
        on_delete=models.CASCADE,
        related_name="deployments",
    )

    name = models.CharField(max_length=150)

    repository = models.CharField(max_length=255)

    branch = models.CharField(max_length=100, default="main")

    environment = models.CharField(
        max_length=20,
        choices=ENVIRONMENT_CHOICES,
        default="development",
    )

    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="pending",
    )

    commit_hash = models.CharField(max_length=40, blank=True)

    # GitHub Actions workflow that performs the deployment
    workflow_file = models.CharField(
        max_length=255,
        default="deploy.yml",
        help_text="File name inside .github/workflows/ in the repository",
    )
    github_run_id = models.BigIntegerField(null=True, blank=True)
    html_url = models.URLField(max_length=500, blank=True, default="")

    logs = models.TextField(blank=True, default="")

    # ---------- Automation ----------
    # Deploy automatically every time the pipeline's CI passes
    auto_deploy = models.BooleanField(default=False)

    # Optional uptime monitor that is checked right after a successful deploy
    health_monitor = models.ForeignKey(
        "monitoring.Monitor",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="deployments",
    )

    TRIGGER_CHOICES = [
        ("manual", "Manual"),
        ("auto", "Automatic (CI passed)"),
    ]
    trigger_source = models.CharField(max_length=10, choices=TRIGGER_CHOICES, default="manual")
    triggered_by_run = models.ForeignKey(
        "pipelines.PipelineRun",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="auto_deployments",
    )
    finish_handled = models.BooleanField(default=False)

    HEALTH_CHOICES = [
        ("", "Not checked"),
        ("checking", "Checking"),
        ("healthy", "Healthy"),
        ("unhealthy", "Unhealthy"),
    ]
    health_status = models.CharField(max_length=10, choices=HEALTH_CHOICES, blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)

    started_at = models.DateTimeField(null=True, blank=True)

    finished_at = models.DateTimeField(null=True, blank=True)

    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} - {self.environment}"