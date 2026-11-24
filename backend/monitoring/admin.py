from django.contrib import admin

# Register your models here.
from django.contrib import admin

from .models import Monitor, MonitorCheck


@admin.register(Monitor)
class MonitorAdmin(admin.ModelAdmin):
    list_display = ("name", "url", "owner", "status", "interval_seconds", "last_checked_at", "is_active")
    list_filter = ("status", "is_active")
    search_fields = ("name", "url", "owner__username")


@admin.register(MonitorCheck)
class MonitorCheckAdmin(admin.ModelAdmin):
    list_display = ("monitor", "checked_at", "is_up", "status_code", "response_time_ms")
    list_filter = ("is_up",)
    date_hierarchy = "checked_at"