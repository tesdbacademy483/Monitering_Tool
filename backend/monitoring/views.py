from django.shortcuts import render

# Create your views here.
from datetime import timedelta

from django.db.models import Avg, Count, Q
from django.db.models.functions import TruncHour
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .checker import check_monitor
from .models import Monitor, MonitorCheck
from .serializers import MonitorCheckSerializer, MonitorSerializer


def _window(hours):
    return timezone.now() - timedelta(hours=hours)


class MonitorViewSet(viewsets.ModelViewSet):
    serializer_class = MonitorSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        since = _window(24)
        return (
            Monitor.objects.filter(owner=self.request.user)
            .select_related("project")
            .annotate(
                checks_24h=Count("checks", filter=Q(checks__checked_at__gte=since)),
                up_24h=Count(
                    "checks",
                    filter=Q(checks__checked_at__gte=since, checks__is_up=True),
                ),
                avg_response_24h=Avg(
                    "checks__response_time_ms",
                    filter=Q(checks__checked_at__gte=since, checks__is_up=True),
                ),
            )
        )

    def list(self, request, *args, **kwargs):
        monitors = list(self.get_queryset())
        for m in monitors:
            m.uptime_24h = round(m.up_24h * 100 / m.checks_24h, 2) if m.checks_24h else None
        return Response(self.get_serializer(monitors, many=True).data)

    def retrieve(self, request, *args, **kwargs):
        m = self.get_object()
        m.uptime_24h = round(m.up_24h * 100 / m.checks_24h, 2) if m.checks_24h else None
        return Response(self.get_serializer(m).data)

    def perform_create(self, serializer):
        monitor = serializer.save(owner=self.request.user)
        # Check straight away so the user sees a result immediately
        check_monitor(monitor)

    def perform_update(self, serializer):
        monitor = serializer.save()
        if not monitor.is_active and monitor.status != "paused":
            monitor.status = "paused"
            monitor.save(update_fields=["status", "updated_at"])

    # POST /api/monitors/{id}/check-now/
    @action(detail=True, methods=["post"], url_path="check-now")
    def check_now(self, request, pk=None):
        monitor = self.get_object()
        check = check_monitor(monitor)
        return Response(MonitorCheckSerializer(check).data, status=status.HTTP_201_CREATED)

    # POST /api/monitors/{id}/pause/
    @action(detail=True, methods=["post"])
    def pause(self, request, pk=None):
        monitor = self.get_object()
        monitor.is_active = False
        monitor.status = "paused"
        monitor.save(update_fields=["is_active", "status", "updated_at"])
        return Response({"status": "paused"})

    # POST /api/monitors/{id}/resume/
    @action(detail=True, methods=["post"])
    def resume(self, request, pk=None):
        monitor = self.get_object()
        monitor.is_active = True
        monitor.status = "pending"
        monitor.last_checked_at = None  # makes it due right away
        monitor.save(update_fields=["is_active", "status", "last_checked_at", "updated_at"])
        return Response({"status": "pending"})

    # GET /api/monitors/{id}/checks/?hours=24
    @action(detail=True, methods=["get"])
    def checks(self, request, pk=None):
        monitor = self.get_object()
        hours = min(int(request.query_params.get("hours", 24)), 24 * 30)
        checks = monitor.checks.filter(checked_at__gte=_window(hours)).order_by("-checked_at")[:500]
        return Response(MonitorCheckSerializer(checks, many=True).data)

    # GET /api/monitors/{id}/stats/?hours=24   -> hourly chart data
    @action(detail=True, methods=["get"])
    def stats(self, request, pk=None):
        monitor = self.get_object()
        hours = min(int(request.query_params.get("hours", 24)), 24 * 30)

        rows = (
            monitor.checks.filter(checked_at__gte=_window(hours))
            .annotate(hour=TruncHour("checked_at"))
            .values("hour")
            .annotate(
                total=Count("id"),
                up=Count("id", filter=Q(is_up=True)),
                avg_ms=Avg("response_time_ms", filter=Q(is_up=True)),
            )
            .order_by("hour")
        )

        return Response([
            {
                "hour": row["hour"],
                "uptime": round(row["up"] * 100 / row["total"], 2) if row["total"] else None,
                "avg_response_ms": round(row["avg_ms"]) if row["avg_ms"] is not None else None,
                "checks": row["total"],
            }
            for row in rows
        ])

    # GET /api/monitors/summary/
    @action(detail=False, methods=["get"])
    def summary(self, request):
        monitors = Monitor.objects.filter(owner=request.user)
        since = _window(24)
        checks = MonitorCheck.objects.filter(monitor__owner=request.user, checked_at__gte=since)
        agg = checks.aggregate(
            total=Count("id"),
            up=Count("id", filter=Q(is_up=True)),
            avg_ms=Avg("response_time_ms", filter=Q(is_up=True)),
        )

        return Response({
            "total": monitors.count(),
            "up": monitors.filter(status="up").count(),
            "down": monitors.filter(status="down").count(),
            "paused": monitors.filter(status="paused").count(),
            "pending": monitors.filter(status="pending").count(),
            "uptime_24h": round(agg["up"] * 100 / agg["total"], 2) if agg["total"] else None,
            "avg_response_24h": round(agg["avg_ms"]) if agg["avg_ms"] is not None else None,
        })