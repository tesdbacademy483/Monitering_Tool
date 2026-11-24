"""
Turns whatever an app sends into clean LogEntry rows.

Accepted bodies:
  {"message": "...", "level": "error", ...}             one log
  [{...}, {...}]                                        many logs
  {"logs": [{...}, {...}]}                              many logs
"""

import json
from datetime import datetime, timedelta, timezone as dt_timezone

from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .models import LogEntry

MAX_BATCH = 500
MAX_MESSAGE = 10_000
MAX_CONTEXT_BYTES = 10_000

LEVEL_ALIASES = {
    "trace": "debug",
    "debug": "debug",
    "info": "info",
    "information": "info",
    "notice": "info",
    "warn": "warning",
    "warning": "warning",
    "err": "error",
    "error": "error",
    "fatal": "critical",
    "crit": "critical",
    "critical": "critical",
    "emergency": "critical",
    "alert": "critical",
}

# Python logging numbers (logging.ERROR == 40 ...)
NUMERIC_LEVELS = [(50, "critical"), (40, "error"), (30, "warning"), (20, "info"), (0, "debug")]


class IngestError(Exception):
    pass


def extract_items(data):
    if isinstance(data, dict) and isinstance(data.get("logs"), list):
        items = data["logs"]
    elif isinstance(data, list):
        items = data
    elif isinstance(data, dict):
        items = [data]
    else:
        raise IngestError("Send a JSON object, a list of objects, or {\"logs\": [...]}.")

    if not items:
        raise IngestError("No logs in the request.")
    if len(items) > MAX_BATCH:
        raise IngestError(f"Too many logs in one request (max {MAX_BATCH}).")
    return items


def normalize_level(value):
    if isinstance(value, (int, float)):
        for threshold, name in NUMERIC_LEVELS:
            if value >= threshold:
                return name
    if isinstance(value, str):
        return LEVEL_ALIASES.get(value.strip().lower(), "info")
    return "info"


def parse_timestamp(value, now):
    parsed = None

    if isinstance(value, (int, float)):
        seconds = value / 1000 if value > 10_000_000_000 else value  # milliseconds?
        try:
            parsed = datetime.fromtimestamp(seconds, tz=dt_timezone.utc)
        except (OverflowError, OSError, ValueError):
            parsed = None
    elif isinstance(value, str) and value:
        parsed = parse_datetime(value.replace(" ", "T", 1) if "T" not in value else value)
        if parsed and timezone.is_naive(parsed):
            parsed = timezone.make_aware(parsed, dt_timezone.utc)

    # Missing, invalid or far in the future -> use the time we received it
    if parsed is None or parsed > now + timedelta(minutes=5):
        return now
    return parsed


def clean_context(value):
    if not isinstance(value, dict):
        return {}
    try:
        encoded = json.dumps(value, default=str)
    except (TypeError, ValueError):
        return {"note": "context could not be stored"}
    if len(encoded) > MAX_CONTEXT_BYTES:
        return {"note": "context too large, dropped"}
    return json.loads(encoded)


def build_entries(source, items):
    """Returns (entries, rejected_messages)."""
    now = timezone.now()
    entries, rejected = [], []

    for index, item in enumerate(items):
        if not isinstance(item, dict):
            rejected.append(f"#{index}: not a JSON object")
            continue

        message = item.get("message", item.get("msg"))
        if message is None or str(message).strip() == "":
            rejected.append(f"#{index}: 'message' is required")
            continue

        entries.append(LogEntry(
            owner_id=source.owner_id,
            source=source,
            timestamp=parse_timestamp(item.get("timestamp", item.get("time")), now),
            level=normalize_level(item.get("level", item.get("severity"))),
            message=str(message)[:MAX_MESSAGE],
            service=str(item.get("service", "") or "")[:100],
            host=str(item.get("host", "") or "")[:255],
            context=clean_context(item.get("context", item.get("extra"))),
        ))

    return entries, rejected