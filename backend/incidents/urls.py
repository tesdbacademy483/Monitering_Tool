from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import IncidentViewSet, alert_settings, test_email

router = DefaultRouter()
router.register("", IncidentViewSet, basename="incident")

# The settings URLs must come before the router's "<id>/" pattern
urlpatterns = [
    path("settings/", alert_settings, name="alert-settings"),
    path("settings/test-email/", test_email, name="alert-test-email"),
] + router.urls