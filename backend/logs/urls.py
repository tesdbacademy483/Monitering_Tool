from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("sources", views.LogSourceViewSet, basename="log-source")

urlpatterns = [
    path("ingest/", views.ingest, name="log-ingest"),
    path("entries/", views.entries, name="log-entries"),
    path("stats/", views.stats, name="log-stats"),
] + router.urls