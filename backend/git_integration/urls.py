from django.urls import path
from automation.webhooks import github_webhook

from . import views

urlpatterns = [
    path("login/", views.github_login, name="github_login"),
    path("callback/", views.github_callback, name="github_callback"),
    path("status/", views.github_status, name="github_status"),
    path("repositories/", views.github_repositories, name="github_repositories"),
    path("disconnect/", views.github_disconnect, name="github_disconnect"),
    path("webhook/", github_webhook, name="github_webhook"),
]