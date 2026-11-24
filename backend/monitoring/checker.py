"""
The uptime checker.

check_monitor()   -> checks one URL and saves the result
run_due_checks()  -> checks every monitor whose interval has passed
cleanup_old_checks() -> deletes old history so the DB stays small
"""

import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import requests
from django.db import close_old_connections
from django.utils import timezone

from .models import Monitor, MonitorCheck

USER_AGENT = "DevOpsPilot-Monitor/1.0"
MAX_WORKERS = 10          # how many URLs are checked at the same time
KEEP_HISTORY_DAYS = 30


def check_monitor(monitor):
    """Request the monitor's URL once, store a MonitorCheck, update the monitor."""
    started = time.perf_counter()
    status_code = None
    error = ""

    try:
        response = requests.request(
            monitor.method,
            monitor.url,
            timeout=monitor.timeout_seconds,
            allow_redirects=True,
            headers={"User-Agent": USER_AGENT},
        )
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        status_code = response.status_code

        is_up = status_code == monitor.expected_status
        if not is_up:
            error = f"Expected status {monitor.expected_status}, got {status_code}"
        elif monitor.keyword and monitor.method == "GET" and monitor.keyword not in response.text:
            is_up = False
            error = f"Keyword '{monitor.keyword}' not found in response"

    except requests.Timeout:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        is_up = False
        error = f"Timed out after {monitor.timeout_seconds}s"
    except requests.ConnectionError:
        elapsed_ms = None
        is_up = False
        error = "Connection failed (site unreachable or DNS error)"
    except requests.RequestException as exc:
        elapsed_ms = None
        is_up = False
        error = f"Request error: {exc.__class__.__name__}"

    now = timezone.now()

    check = MonitorCheck.objects.create(
        monitor=monitor,
        checked_at=now,
        is_up=is_up,
        status_code=status_code,
        response_time_ms=elapsed_ms,
        error=error,
    )

    new_status = "up" if is_up else "down"
    if monitor.status != new_status:
        monitor.status_changed_at = now

    monitor.status = new_status
    monitor.last_checked_at = now
    monitor.last_response_ms = elapsed_ms
    monitor.last_error = error
    monitor.consecutive_failures = 0 if is_up else monitor.consecutive_failures + 1
    monitor.save(update_fields=[
        "status",
        "status_changed_at",
        "last_checked_at",
        "last_response_ms",
        "last_error",
        "consecutive_failures",
        "updated_at",
    ])

    # Open or close incidents and send alerts (never raises)
    from incidents.services import handle_monitor_check
    handle_monitor_check(monitor, check)

    return check


def _check_in_thread(monitor_id):
    close_old_connections()
    try:
        monitor = Monitor.objects.get(pk=monitor_id)
        return check_monitor(monitor)
    finally:
        close_old_connections()


def run_due_checks():
    """Check every active monitor that is due. Returns how many were checked."""
    now = timezone.now()
    due_ids = [m.id for m in Monitor.objects.filter(is_active=True) if m.is_due(now)]

    if not due_ids:
        return 0

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        list(pool.map(_check_in_thread, due_ids))

    return len(due_ids)


def cleanup_old_checks(days=KEEP_HISTORY_DAYS):
    cutoff = timezone.now() - timedelta(days=days)
    deleted, _ = MonitorCheck.objects.filter(checked_at__lt=cutoff).delete()
    return deleted