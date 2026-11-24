from django.contrib import admin
from django.urls import include, path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from projects.views import ProjectListCreateView, ProjectDetailView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/token/", TokenObtainPairView.as_view()),
    path("api/token/refresh/", TokenRefreshView.as_view()),

    path("api/profile/", include("users.urls")),

    
    path("api/projects/", ProjectListCreateView.as_view()),
    path("api/projects/<int:pk>/", ProjectDetailView.as_view()),


    path("api/github/", include("git_integration.urls")),

    path("api/pipelines/", include("pipelines.urls")),

    path("api/deployments/", include("deployments.urls")),

    path("api/monitors/", include("monitoring.urls")),

    path("api/incidents/", include("incidents.urls")),
    
    path("api/logs/", include("logs.urls")),
]


