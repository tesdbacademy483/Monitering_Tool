"""
Background worker for uptime monitoring.

Run it in its own terminal, next to runserver:
    python manage.py run_monitors
"""

import time

from django.core.management.base import BaseCommand
from django.utils import timezone

from monitoring.checker import cleanup_old_checks, run_due_checks

TICK_SECONDS = 5            # how often we look for due monitors
CLEANUP_EVERY_SECONDS = 3600


class Command(BaseCommand):
    help = "Continuously checks monitors whose interval has passed."

    def add_arguments(self, parser):
        parser.add_argument(
            "--once",
            action="store_true",
            help="Run one round of due checks and exit (useful for testing).",
        )

    def handle(self, *args, **options):
        if options["once"]:
            count = run_due_checks()
            self.stdout.write(f"Checked {count} monitor(s).")
            return

        self.stdout.write(self.style.SUCCESS(
            "DevOpsPilot monitor worker started. Press Ctrl+C to stop."
        ))
        last_cleanup = 0.0

        try:
            while True:
                try:
                    count = run_due_checks()
                    if count:
                        stamp = timezone.localtime().strftime("%H:%M:%S")
                        self.stdout.write(f"[{stamp}] Checked {count} monitor(s)")

                    if time.monotonic() - last_cleanup > CLEANUP_EVERY_SECONDS:
                        deleted = cleanup_old_checks()
                        if deleted:
                            self.stdout.write(f"Removed {deleted} old check(s)")
                        last_cleanup = time.monotonic()

                except Exception as exc:  # keep the worker alive on unexpected errors
                    self.stderr.write(self.style.ERROR(f"Worker error: {exc}"))

                time.sleep(TICK_SECONDS)

        except KeyboardInterrupt:
            self.stdout.write("\nMonitor worker stopped.")