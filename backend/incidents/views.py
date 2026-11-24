from datetime import timedelta

from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Incident
from .serializers import (
    AlertSettingsSerializer,
    IncidentDetailSerializer,
    IncidentSerializer,
)
from .services import add_event, format_duration, get_settings, resolve_incident, send_test_email


class IncidentViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = (
            Incident.objects.filter(owner=self.request.user)
            .select_related("monitor", "deployment", "pipeline", "log_source")
        )
        status_filter = self.request.query_params.get("status")
        if status_filter == "active":
            queryset = queryset.filter(status__in=["open", "acknowledged"])
        elif status_filter in ("open", "acknowledged", "resolved"):
            queryset = queryset.filter(status=status_filter)
        return queryset

    def get_serializer_class(self):
        if self.action == "retrieve":
            return IncidentDetailSerializer
        return IncidentSerializer

    def list(self, request, *args, **kwargs):
        incidents = self.get_queryset()[:200]
        return Response(IncidentSerializer(incidents, many=True).data)

    # POST /api/incidents/{id}/acknowledge/
    @action(detail=True, methods=["post"])
    def acknowledge(self, request, pk=None):
        incident = self.get_object()
        if incident.status != "open":
            return Response(
                {"detail": f"Incident is already {incident.status}."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        incident.status = "acknowledged"
        incident.acknowledged_at = timezone.now()
        incident.save(update_fields=["status", "acknowledged_at", "updated_at"])
        add_event(incident, "acknowledged", f"Acknowledged by {request.user.username}.")
        return Response(IncidentDetailSerializer(incident).data)

    # POST /api/incidents/{id}/resolve/
    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        incident = self.get_object()
        if incident.status == "resolved":
            return Response(
                {"detail": "Incident is already resolved."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        resolve_incident(
            incident,
            f"Resolved by {request.user.username}.",
            automatically=False,
        )
        return Response(IncidentDetailSerializer(incident).data)

    # POST /api/incidents/{id}/note/   body: {"message": "..."}
    @action(detail=True, methods=["post"])
    def note(self, request, pk=None):
        incident = self.get_object()
        message = str(request.data.get("message", "")).strip()
        if not message:
            return Response({"detail": "Note is empty."}, status=status.HTTP_400_BAD_REQUEST)
        add_event(incident, "note", f"{request.user.username}: {message[:2000]}")
        return Response(IncidentDetailSerializer(incident).data, status=status.HTTP_201_CREATED)

    # GET /api/incidents/summary/
    @action(detail=False, methods=["get"])
    def summary(self, request):
        incidents = Incident.objects.filter(owner=request.user)
        now = timezone.now()

        counts = incidents.aggregate(
            open=Count("id", filter=Q(status="open")),
            acknowledged=Count("id", filter=Q(status="acknowledged")),
            resolved_7d=Count("id", filter=Q(status="resolved", resolved_at__gte=now - timedelta(days=7))),
        )

        resolved_30d = incidents.filter(
            status="resolved", resolved_at__gte=now - timedelta(days=30)
        ).only("started_at", "resolved_at")
        durations = [(i.resolved_at - i.started_at).total_seconds() for i in resolved_30d]
        mttr = sum(durations) / len(durations) if durations else None

        return Response({
            **counts,
            "mttr_seconds": int(mttr) if mttr is not None else None,
            "mttr_display": format_duration(mttr) if mttr is not None else None,
        })


# GET / PUT /api/incidents/settings/
@api_view(["GET", "PUT", "PATCH"])
@permission_classes([IsAuthenticated])
def alert_settings(request):
    settings_obj = get_settings(request.user)

    if request.method == "GET":
        return Response(AlertSettingsSerializer(settings_obj).data)

    serializer = AlertSettingsSerializer(settings_obj, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data)


# POST /api/incidents/settings/test-email/
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def test_email(request):
    try:
        sent_to = send_test_email(request.user)
    except ValueError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as exc:
        return Response(
            {"detail": f"Email could not be sent: {exc}"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return Response({"detail": f"Test email sent to {sent_to}."})