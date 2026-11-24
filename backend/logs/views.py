from django.shortcuts import render

from datetime import timedelta

from django.db.models import Count, Q
from django.db.models.functions import TruncDay, TruncHour
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import (
    action,
    api_view,
    authentication_classes,
    permission_classes,
)
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .alerts import check_error_spike
from .ingest import IngestError, build_entries, extract_items
from .models import LogEntry, LogSource, hash_key
from .serializers import LogEntrySerializer, LogSourceSerializer

RANGES = {
    "15m": timedelta(minutes=15),
    "1h": timedelta(hours=1),
    "6h": timedelta(hours=6),
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
}
LEVELS = ["debug", "info", "warning", "error", "critical"]


def _since(request, default="24h"):
    key = request.query_params.get("since", default)
    return timezone.now() - RANGES.get(key, RANGES[default]), key


# ------------------------------------------------------------------
# Ingest: POST /api/logs/ingest/   (used by your apps, with an API key)
# ------------------------------------------------------------------

def _read_api_key(request):
    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return request.headers.get("X-API-Key", "").strip()


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def ingest(request):
    raw_key = _read_api_key(request)
    if not raw_key:
        return Response(
            {"detail": "Missing API key. Send 'Authorization: Bearer <key>'."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    source = (
        LogSource.objects.filter(key_hash=hash_key(raw_key)).select_related("owner").first()
    )
    if source is None:
        return Response({"detail": "Invalid API key."}, status=status.HTTP_401_UNAUTHORIZED)
    if not source.is_active:
        return Response({"detail": "This log source is disabled."}, status=status.HTTP_403_FORBIDDEN)

    try:
        items = extract_items(request.data)
    except IngestError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    entries, rejected = build_entries(source, items)
    if entries:
        LogEntry.objects.bulk_create(entries)

    now = timezone.now()
    if not source.last_used_at or now - source.last_used_at > timedelta(seconds=30):
        LogSource.objects.filter(pk=source.pk).update(last_used_at=now)

    if any(e.level in ("error", "critical") for e in entries):
        check_error_spike(source)

    return Response(
        {"accepted": len(entries), "rejected": len(rejected), "errors": rejected[:5]},
        status=status.HTTP_202_ACCEPTED if entries else status.HTTP_400_BAD_REQUEST,
    )


# ------------------------------------------------------------------
# Log sources (API keys)
# ------------------------------------------------------------------

class LogSourceViewSet(viewsets.ModelViewSet):
    serializer_class = LogSourceSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "patch", "delete"]

    def get_queryset(self):
        since = timezone.now() - timedelta(hours=24)
        return (
            LogSource.objects.filter(owner=self.request.user)
            .select_related("project")
            .annotate(
                logs_24h=Count("entries", filter=Q(entries__timestamp__gte=since)),
                errors_24h=Count(
                    "entries",
                    filter=Q(
                        entries__timestamp__gte=since,
                        entries__level__in=["error", "critical"],
                    ),
                ),
            )
        )

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        source = LogSource(owner=request.user, **serializer.validated_data)
        raw_key = source.set_new_key()
        source.save()

        data = LogSourceSerializer(source, context={"request": request}).data
        data["api_key"] = raw_key  # shown only this once
        return Response(data, status=status.HTTP_201_CREATED)

    # POST /api/logs/sources/{id}/regenerate-key/
    @action(detail=True, methods=["post"], url_path="regenerate-key")
    def regenerate_key(self, request, pk=None):
        source = self.get_object()
        raw_key = source.set_new_key()
        source.save(update_fields=["key_hash", "key_prefix"])
        data = LogSourceSerializer(source, context={"request": request}).data
        data["api_key"] = raw_key
        return Response(data)


# ------------------------------------------------------------------
# Reading logs
# ------------------------------------------------------------------

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def entries(request):
    """
    GET /api/logs/entries/?since=24h&level=error,critical&source=3&q=timeout&before=1234
    Newest first. Use ?before=<id> to load older logs, ?after=<id> for new ones.
    """
    params = request.query_params
    since, _ = _since(request)

    queryset = LogEntry.objects.filter(owner=request.user, timestamp__gte=since).select_related("source")

    levels = [lvl for lvl in params.get("level", "").split(",") if lvl in LEVELS]
    if levels:
        queryset = queryset.filter(level__in=levels)

    if params.get("source", "").isdigit():
        queryset = queryset.filter(source_id=int(params["source"]))

    search = params.get("q", "").strip()
    if search:
        queryset = queryset.filter(
            Q(message__icontains=search) | Q(service__icontains=search) | Q(host__icontains=search)
        )

    if params.get("before", "").isdigit():
        queryset = queryset.filter(id__lt=int(params["before"]))
    if params.get("after", "").isdigit():
        queryset = queryset.filter(id__gt=int(params["after"]))

    try:
        limit = max(1, min(int(params.get("limit", 200)), 500))
    except ValueError:
        limit = 200

    rows = list(queryset.order_by("-id")[: limit + 1])
    return Response({
        "results": LogEntrySerializer(rows[:limit], many=True).data,
        "has_more": len(rows) > limit,
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def stats(request):
    """GET /api/logs/stats/?since=24h -> totals per level and a histogram."""
    since, key = _since(request)
    queryset = LogEntry.objects.filter(owner=request.user, timestamp__gte=since)

    if request.query_params.get("source", "").isdigit():
        queryset = queryset.filter(source_id=int(request.query_params["source"]))

    by_level = {row["level"]: row["n"] for row in queryset.values("level").annotate(n=Count("id"))}

    trunc = TruncDay if key == "7d" else TruncHour
    buckets = (
        queryset.annotate(bucket=trunc("timestamp"))
        .values("bucket")
        .annotate(
            total=Count("id"),
            errors=Count("id", filter=Q(level__in=["error", "critical"])),
            warnings=Count("id", filter=Q(level="warning")),
        )
        .order_by("bucket")
    )

    return Response({
        "total": sum(by_level.values()),
        "by_level": {level: by_level.get(level, 0) for level in LEVELS},
        "histogram": [
            {
                "bucket": row["bucket"],
                "errors": row["errors"],
                "warnings": row["warnings"],
                "other": row["total"] - row["errors"] - row["warnings"],
            }
            for row in buckets
        ],
        "sources": LogSource.objects.filter(owner=request.user).count(),
    })
