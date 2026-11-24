from django.contrib import admin

from .models import LogEntry, LogSource


@admin.register(LogSource)
class LogSourceAdmin(admin.ModelAdmin):
    list_display = ("name", "owner", "key_prefix", "is_active", "last_used_at", "alert_on_errors")
    readonly_fields = ("key_hash", "key_prefix")


@admin.register(LogEntry)
class LogEntryAdmin(admin.ModelAdmin):
    list_display = ("timestamp", "level", "source", "service", "short_message")
    list_filter = ("level", "source")
    search_fields = ("message",)

    def short_message(self, obj):
        return obj.message[:80]