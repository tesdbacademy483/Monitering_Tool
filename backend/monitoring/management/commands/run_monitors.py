"""
Background worker: uptime monitoring + push-to-deploy automation.

Run it in its own terminal, next to runserver:
    python manage.py run_monitors

Every PIPELINE_SYNC_SECONDS it also asks GitHub for new workflow runs, so a
`git push` shows up in DevOpsPilot, raises alerts if CI fails, and starts
auto-deploys when CI passes - without anyone clicking anything.
"""

import time

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from monitoring.checker import cleanup_old_checks, run_due_checks

try:  # the logs app is optional
    from logs.alerts import cleanup_old_logs, resolve_quiet_sources
except ImportError:
    cleanup_old_logs = resolve_quiet_sources = None

try:
    from automation.engine import sync_everything
except ImportError:
    sync_everything = None

TICK_SECONDS = 5            # how often we look for due monitors
CLEANUP_EVERY_SECONDS = 3600
LOG_INCIDENTS_EVERY_SECONDS = 60


class Command(BaseCommand):
    help = "Continuously checks monitors whose interval has passed."

    def add_arguments(self, parser):
        parser.add_argument(
            "--once",
            action="store_true",
            help="Run one round of due checks and exit (useful for testing).",
        )

        parser.add_argument(
            "--no-automation",
            action="store_true",
            help="Only run uptime monitors; don't watch GitHub for new runs.",
        )

    def _sync_github(self):
        summary = sync_everything()
        if summary["new_runs"] or summary["errors"]:
            stamp = timezone.localtime().strftime("%H:%M:%S")
            self.stdout.write(
                f"[{stamp}] GitHub: {summary['new_runs']} new run(s) across "
                f"{summary['pipelines']} pipeline(s), {summary['errors']} error(s)"
            )

    def handle(self, *args, **options):
        automation = sync_everything is not None and not options["no_automation"]

        if options["once"]:
            count = run_due_checks()
            self.stdout.write(f"Checked {count} monitor(s).")
            if automation:
                self.stdout.write(f"GitHub sync: {sync_everything()}")
            return

        self.stdout.write(self.style.SUCCESS(
            "DevOpsPilot monitor worker started. Press Ctrl+C to stop."
        ))
        if automation:
            self.stdout.write(
                f"Watching GitHub for pushes every {settings.PIPELINE_SYNC_SECONDS}s "
                "(CI tracking, alerts, auto-deploy)."
            )
        last_cleanup = 0.0
        last_log_check = 0.0
        last_github_sync = 0.0

        try:
            while True:
                try:
                    count = run_due_checks()
                    if count:
                        stamp = timezone.localtime().strftime("%H:%M:%S")
                        self.stdout.write(f"[{stamp}] Checked {count} monitor(s)")

                    if automation and (
                        time.monotonic() - last_github_sync > settings.PIPELINE_SYNC_SECONDS
                    ):
                        last_github_sync = time.monotonic()
                        self._sync_github()

                    if resolve_quiet_sources and (
                        time.monotonic() - last_log_check > LOG_INCIDENTS_EVERY_SECONDS
                    ):
                        closed = resolve_quiet_sources()
                        if closed:
                            self.stdout.write(f"Closed {closed} log incident(s): errors stopped")
                        last_log_check = time.monotonic()

                    if time.monotonic() - last_cleanup > CLEANUP_EVERY_SECONDS:
                        deleted = cleanup_old_checks()
                        if deleted:
                            self.stdout.write(f"Removed {deleted} old check(s)")
                        if cleanup_old_logs:
                            deleted_logs = cleanup_old_logs()
                            if deleted_logs:
                                self.stdout.write(f"Removed {deleted_logs} old log line(s)")
                        last_cleanup = time.monotonic()

                except Exception as exc:  # keep the worker alive on unexpected errors
                    self.stderr.write(self.style.ERROR(f"Worker error: {exc}"))

                time.sleep(TICK_SECONDS)

        except KeyboardInterrupt:
            self.stdout.write("\nMonitor worker stopped.")