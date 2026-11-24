from django.contrib import admin

from .models import AlertSettings, Incident, IncidentEvent


class IncidentEventInline(admin.TabularInline):
    model = IncidentEvent
    extra = 0
    readonly_fields = ("kind", "message", "created_at")


@admin.register(Incident)
class IncidentAdmin(admin.ModelAdmin):
    list_display = ("title", "owner", "source", "severity", "status", "started_at", "resolved_at")
    list_filter = ("status", "severity", "source")
    search_fields = ("title", "owner__username")
    inlines = [IncidentEventInline]


@admin.register(AlertSettings)
class AlertSettingsAdmin(admin.ModelAdmin):
    list_display = ("user", "email_enabled", "email", "monitor_failure_threshold")