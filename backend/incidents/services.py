"""
Incident logic: open / resolve incidents and send email alerts.

Called from:
  monitoring/checker.py         -> handle_monitor_check()
  deployments/views.py          -> handle_deployment_finished()
  pipelines/views.py            -> handle_pipeline_run_finished()

Every public function here is wrapped so that an alerting problem
can never break monitoring, deployments or pipelines.
"""

import logging
import threading

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import close_old_connections
from django.utils import timezone
from django.utils.html import escape

from .models import AlertSettings, Incident, IncidentEvent

logger = logging.getLogger(__name__)

ACTIVE = ["open", "acknowledged"]


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def get_settings(user):
    alert_settings, _ = AlertSettings.objects.get_or_create(user=user)
    return alert_settings


def format_duration(seconds):
    seconds = int(seconds)
    if seconds < 60:
        return f"{seconds}s"
    minutes, seconds = divmod(seconds, 60)
    if minutes < 60:
        return f"{minutes}m {seconds}s"
    hours, minutes = divmod(minutes, 60)
    if hours < 24:
        return f"{hours}h {minutes}m"
    days, hours = divmod(hours, 24)
    return f"{days}d {hours}h"


def add_event(incident, kind, message=""):
    return IncidentEvent.objects.create(incident=incident, kind=kind, message=message)


def _frontend_url(path="/incidents"):
    base = getattr(settings, "FRONTEND_URL", "http://localhost:5173").rstrip("/")
    return f"{base}{path}"


def open_incident(owner, *, title, description, source, severity="critical", **links):
    incident = Incident.objects.create(
        owner=owner,
        title=title,
        description=description,
        source=source,
        severity=severity,
        started_at=timezone.now(),
        **links,
    )
    add_event(incident, "opened", description)
    return incident


def resolve_incident(incident, message, automatically=True):
    incident.status = "resolved"
    incident.resolved_at = timezone.now()
    incident.resolved_automatically = automatically
    incident.save(update_fields=["status", "resolved_at", "resolved_automatically", "updated_at"])
    add_event(incident, "resolved", message)
    return incident


# ------------------------------------------------------------------
# Email
# ------------------------------------------------------------------

COLORS = {"down": "#ef4444", "recovered": "#10b981", "info": "#8b5cf6"}


def _email_html(heading, color, rows, body, button_text, button_url):
    row_html = "".join(
        f'<tr><td style="padding:6px 12px 6px 0;color:#94a3b8;white-space:nowrap">{escape(k)}</td>'
        f'<td style="padding:6px 0;color:#e2e8f0">{escape(str(v))}</td></tr>'
        for k, v in rows
    )
    return f"""
<div style="background:#0b1020;padding:32px 16px;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#121b30;border:1px solid #1f2a44;border-radius:14px;overflow:hidden">
    <div style="background:{color};padding:18px 24px;color:#fff;font-size:18px;font-weight:bold">{escape(heading)}</div>
    <div style="padding:24px">
      <p style="color:#cbd5e1;margin:0 0 16px;line-height:1.5">{escape(body)}</p>
      <table style="border-collapse:collapse;font-size:14px">{row_html}</table>
      <a href="{escape(button_url)}" style="display:inline-block;margin-top:22px;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold">{escape(button_text)}</a>
    </div>
    <div style="padding:14px 24px;border-top:1px solid #1f2a44;color:#64748b;font-size:12px">
      Sent by DevOpsPilot. Change alert settings on the Incidents page.
    </div>
  </div>
</div>"""


def _send_email(to, subject, text, html):
    message = EmailMultiAlternatives(
        subject=subject,
        body=text,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[to],
    )
    message.attach_alternative(html, "text/html")
    message.send(fail_silently=False)


def _deliver(incident_id, to, subject, text, html):
    """Runs in a background thread so a slow SMTP server never blocks a request."""
    close_old_connections()
    try:
        _send_email(to, subject, text, html)
        add_event_by_id(incident_id, "alert_sent", f"Email sent to {to}")
    except Exception as exc:  # SMTP errors, wrong password, no internet...
        logger.warning("Alert email failed: %s", exc)
        add_event_by_id(incident_id, "alert_failed", f"Email to {to} failed: {exc}")
    finally:
        close_old_connections()


def add_event_by_id(incident_id, kind, message):
    if incident_id:
        IncidentEvent.objects.create(incident_id=incident_id, kind=kind, message=message)


def send_alert(user, incident, *, kind, subject, body, rows):
    """kind: 'down' or 'recovered'."""
    alert_settings = get_settings(user)
    to = alert_settings.recipient

    if not alert_settings.email_enabled:
        return
    if not to:
        add_event(incident, "alert_failed", "No email address. Add one in alert settings.")
        return

    url = _frontend_url()
    text = f"{subject}\n\n{body}\n\n" + "\n".join(f"{k}: {v}" for k, v in rows) + f"\n\nOpen: {url}\n"
    html = _email_html(subject, COLORS[kind], rows, body, "Open incidents", url)

    if getattr(settings, "ALERTS_SEND_IN_BACKGROUND", True):
        threading.Thread(
            target=_deliver,
            args=(incident.id, to, subject, text, html),
            daemon=True,
        ).start()
    else:
        _deliver(incident.id, to, subject, text, html)


def send_test_email(user):
    """Sends a test alert right away. Raises on failure so the UI can show the error."""
    to = get_settings(user).recipient
    if not to:
        raise ValueError("No email address set. Add one in alert settings.")

    subject = "✅ DevOpsPilot test alert"
    body = "Email alerts are working. You'll get a message like this when something breaks."
    rows = [("Account", user.username), ("Sent at", timezone.localtime().strftime("%d %b %Y, %H:%M"))]
    url = _frontend_url()
    _send_email(
        to,
        subject,
        f"{subject}\n\n{body}\n",
        _email_html(subject, COLORS["info"], rows, body, "Open DevOpsPilot", url),
    )
    return to


# ------------------------------------------------------------------
# Monitors
# ------------------------------------------------------------------

def _monitor_check(monitor, check):
    owner = monitor.owner
    alert_settings = get_settings(owner)
    active = monitor.incidents.filter(status__in=ACTIVE).order_by("-started_at").first()

    if not check.is_up:
        if active:
            return  # already alerted for this outage
        if monitor.consecutive_failures < max(1, alert_settings.monitor_failure_threshold):
            return  # wait for more failures (avoids alerts for one-off blips)

        reason = check.error or f"HTTP {check.status_code}"
        incident = open_incident(
            owner,
            title=f"{monitor.name} is down",
            description=f"{monitor.url} failed {monitor.consecutive_failures} checks in a row: {reason}",
            source="monitor",
            severity="critical",
            monitor=monitor,
        )
        if alert_settings.notify_monitor_down:
            send_alert(
                owner,
                incident,
                kind="down",
                subject=f"🔴 DOWN: {monitor.name}",
                body=f"{monitor.name} is not responding as expected.",
                rows=[
                    ("URL", monitor.url),
                    ("Error", reason),
                    ("Failed checks", monitor.consecutive_failures),
                    ("Detected at", timezone.localtime().strftime("%d %b %Y, %H:%M:%S")),
                ],
            )
        return

    # Monitor is up again
    if active:
        duration = format_duration((timezone.now() - active.started_at).total_seconds())
        resolve_incident(active, f"{monitor.name} is back up after {duration}.")
        if alert_settings.notify_recovery:
            send_alert(
                owner,
                active,
                kind="recovered",
                subject=f"✅ RECOVERED: {monitor.name}",
                body=f"{monitor.name} is back up.",
                rows=[
                    ("URL", monitor.url),
                    ("Downtime", duration),
                    ("Response time", f"{check.response_time_ms} ms"),
                ],
            )


# ------------------------------------------------------------------
# Deployments
# ------------------------------------------------------------------

def _deployment_finished(deployment):
    owner = deployment.owner
    alert_settings = get_settings(owner)
    active = deployment.incidents.filter(status__in=ACTIVE).order_by("-started_at").first()

    if deployment.status == "failed":
        if active:
            add_event(active, "note", "Deployment failed again.")
            return
        severity = "critical" if deployment.environment == "production" else "warning"
        incident = open_incident(
            owner,
            title=f"Deployment failed: {deployment.name} ({deployment.environment})",
            description=f"{deployment.repository}@{deployment.branch} failed to deploy to {deployment.environment}.",
            source="deployment",
            severity=severity,
            deployment=deployment,
        )
        if alert_settings.notify_deployment_failed:
            send_alert(
                owner,
                incident,
                kind="down",
                subject=f"🔴 Deployment failed: {deployment.name} ({deployment.environment})",
                body="A deployment did not complete successfully.",
                rows=[
                    ("Environment", deployment.environment),
                    ("Repository", deployment.repository),
                    ("Branch", deployment.branch),
                    ("GitHub run", deployment.html_url or "-"),
                ],
            )

    elif deployment.status == "success" and active:
        resolve_incident(active, "A later deployment succeeded.")
        if alert_settings.notify_recovery:
            send_alert(
                owner,
                active,
                kind="recovered",
                subject=f"✅ Deployment fixed: {deployment.name} ({deployment.environment})",
                body="The deployment succeeded after an earlier failure.",
                rows=[("Environment", deployment.environment), ("Repository", deployment.repository)],
            )


# ------------------------------------------------------------------
# Pipelines
# ------------------------------------------------------------------

def _pipeline_run_finished(run):
    pipeline = run.pipeline
    owner = pipeline.owner
    alert_settings = get_settings(owner)
    active = pipeline.incidents.filter(status__in=ACTIVE).order_by("-started_at").first()

    if run.status == "failed":
        if active:
            add_event(active, "note", f"Run #{run.id} failed again.")
            return
        incident = open_incident(
            owner,
            title=f"Pipeline failed: {pipeline.name}",
            description=f"Run #{run.id} on {pipeline.repository}@{pipeline.branch} failed.",
            source="pipeline",
            severity="warning",
            pipeline=pipeline,
        )
        if alert_settings.notify_pipeline_failed:
            send_alert(
                owner,
                incident,
                kind="down",
                subject=f"🔴 Pipeline failed: {pipeline.name}",
                body="A pipeline run failed.",
                rows=[
                    ("Repository", pipeline.repository),
                    ("Branch", pipeline.branch),
                    ("Run", f"#{run.id}"),
                    ("GitHub run", run.html_url or "-"),
                ],
            )

    elif run.status == "success" and active:
        resolve_incident(active, f"Run #{run.id} succeeded.")
        if alert_settings.notify_recovery:
            send_alert(
                owner,
                active,
                kind="recovered",
                subject=f"✅ Pipeline fixed: {pipeline.name}",
                body="The pipeline passed again.",
                rows=[("Repository", pipeline.repository), ("Run", f"#{run.id}")],
            )


# ------------------------------------------------------------------
# Safe public entry points
# ------------------------------------------------------------------

def _safe(fn, *args):
    try:
        fn(*args)
    except Exception:
        logger.exception("Incident handling failed")


def handle_monitor_check(monitor, check):
    _safe(_monitor_check, monitor, check)


def handle_deployment_finished(deployment):
    _safe(_deployment_finished, deployment)


def handle_pipeline_run_finished(run):
    _safe(_pipeline_run_finished, run)