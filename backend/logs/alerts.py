"""
Error-spike alerts for log sources, using the incidents app.

check_error_spike()      -> after logs arrive: open an incident if errors pass the threshold
resolve_quiet_sources()  -> called by the background worker: close incidents once errors stop
"""

import logging
from datetime import timedelta

from django.utils import timezone

logger = logging.getLogger(__name__)

ERROR_LEVELS = ["error", "critical"]
QUIET_MINUTES = 10  # no errors for this long -> incident resolved


def _error_count(source, minutes):
    since = timezone.now() - timedelta(minutes=minutes)
    return source.entries.filter(level__in=ERROR_LEVELS, timestamp__gte=since).count()


def check_error_spike(source):
    try:
        _check(source)
    except Exception:
        logger.exception("Log error-spike check failed")


def _check(source):
    from incidents.models import Incident
    from incidents.services import add_event, get_settings, open_incident, send_alert

    if not source.alert_on_errors:
        return

    count = _error_count(source, source.error_window_minutes)
    if count < source.error_threshold:
        return

    active = Incident.objects.filter(
        log_source=source, status__in=["open", "acknowledged"]
    ).first()
    if active:
        return

    latest = source.entries.filter(level__in=ERROR_LEVELS).order_by("-timestamp").first()
    sample = latest.message[:300] if latest else ""

    incident = open_incident(
        source.owner,
        title=f"Error spike in {source.name}",
        description=(
            f"{count} errors in the last {source.error_window_minutes} minutes "
            f"(threshold {source.error_threshold}). Latest: {sample}"
        ),
        source="logs",
        severity="critical",
        log_source=source,
    )

    alert_settings = get_settings(source.owner)
    if alert_settings.notify_log_errors:
        send_alert(
            source.owner,
            incident,
            kind="down",
            subject=f"🔴 Error spike: {source.name}",
            body=f"{source.name} is logging a lot of errors.",
            rows=[
                ("Errors", f"{count} in {source.error_window_minutes} min"),
                ("Threshold", source.error_threshold),
                ("Latest error", sample or "-"),
            ],
        )
    else:
        add_event(incident, "note", "Email for log errors is turned off in alert settings.")


def resolve_quiet_sources():
    """Close log incidents whose source has had no errors for QUIET_MINUTES."""
    try:
        from incidents.models import Incident
        from incidents.services import format_duration, get_settings, resolve_incident, send_alert

        active = Incident.objects.filter(
            source="logs", status__in=["open", "acknowledged"], log_source__isnull=False
        ).select_related("log_source", "owner")

        closed = 0
        for incident in active:
            source = incident.log_source
            if _error_count(source, QUIET_MINUTES) > 0:
                continue

            duration = format_duration((timezone.now() - incident.started_at).total_seconds())
            resolve_incident(incident, f"No errors for {QUIET_MINUTES} minutes.")
            closed += 1

            if get_settings(incident.owner).notify_recovery:
                send_alert(
                    incident.owner,
                    incident,
                    kind="recovered",
                    subject=f"✅ Errors stopped: {source.name}",
                    body=f"{source.name} has had no errors for {QUIET_MINUTES} minutes.",
                    rows=[("Incident lasted", duration)],
                )
        return closed
    except Exception:
        logger.exception("Resolving quiet log sources failed")
        return 0


def cleanup_old_logs():
    from django.conf import settings

    from .models import LogEntry

    days = getattr(settings, "LOG_RETENTION_DAYS", 7)
    cutoff = timezone.now() - timedelta(days=days)
    deleted, _ = LogEntry.objects.filter(timestamp__lt=cutoff).delete()
    return deleted