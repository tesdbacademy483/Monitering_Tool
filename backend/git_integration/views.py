import requests

from django.conf import settings
from django.core import signing
from django.contrib.auth import get_user_model
from django.shortcuts import redirect
from django.urls import reverse

from rest_framework.decorators import (
    api_view,
    permission_classes,
    authentication_classes,
)
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response

from .models import GitHubConnection


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def github_login(request):
    # Create a secure state value containing the logged-in user ID
    state = signing.dumps(
        {"user_id": request.user.pk},
        salt="github-oauth",
    )

    from urllib.parse import urlencode

    params = {
        "client_id": settings.GITHUB_CLIENT_ID,
        "redirect_uri": "http://127.0.0.1:8000/api/github/callback/",
        "scope": "read:user repo workflow",
        "state": state,
    }

    github_url = "https://github.com/login/oauth/authorize"

    return Response({
        "authorization_url": f"{github_url}?{urlencode(params)}"
    })


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def github_callback(request):
    code = request.GET.get("code")
    state = request.GET.get("state")

    if not code or not state:
        return Response({"error": "Missing code or state"}, status=400)

    # Verify the state and recover the DevOpsPilot user
    try:
        state_data = signing.loads(
            state,
            salt="github-oauth",
            max_age=600,
        )
        User = get_user_model()
        user = User.objects.get(pk=state_data["user_id"])
    except (signing.BadSignature, signing.SignatureExpired, KeyError, User.DoesNotExist):
        return Response({"error": "Invalid or expired authorization"}, status=400)

    try:
        token_response = requests.post(
            "https://github.com/login/oauth/access_token",
            headers={"Accept": "application/json"},
            data={
                "client_id": settings.GITHUB_CLIENT_ID,
                "client_secret": settings.GITHUB_CLIENT_SECRET,
                "code": code,
            },
            timeout=15,
        )
        token_response.raise_for_status()
        token_data = token_response.json()
    except requests.RequestException:
        return Response({"error": "Could not contact GitHub"}, status=502)

    access_token = token_data.get("access_token")

    if not access_token:
        return Response({"error": "GitHub authorization failed"}, status=400)

    try:
        user_response = requests.get(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=15,
        )
        user_response.raise_for_status()
        github_user = user_response.json()
    except requests.RequestException:
        return Response({"error": "Could not retrieve GitHub account"}, status=502)

    GitHubConnection.objects.update_or_create(
        user=user,
        defaults={
            "github_username": github_user["login"],
            "access_token": access_token,
        },
    )

    return redirect("http://localhost:5173/profile?github=connected")

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def github_status(request):
    try:
        connection = GitHubConnection.objects.get(user=request.user)

        return Response({
            "connected": True,
            "github_username": connection.github_username,
        })

    except GitHubConnection.DoesNotExist:
        return Response({
            "connected": False,
            "github_username": None,
        })

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def github_repositories(request):
    try:
        connection = GitHubConnection.objects.get(user=request.user)
    except GitHubConnection.DoesNotExist:
        return Response(
            {"error": "GitHub account is not connected"},
            status=404,
        )

    headers = {
        "Authorization": f"Bearer {connection.access_token}",
        "Accept": "application/vnd.github+json",
    }

    try:
        response = requests.get(
            "https://api.github.com/user/repos",
            headers=headers,
            params={
                "sort": "updated",
                "per_page": 100,
                "type": "all",
            },
            timeout=15,
        )

        if response.status_code == 401:
            return Response(
                {"error": "GitHub token is invalid. Please reconnect GitHub."},
                status=401,
            )

        response.raise_for_status()
        repositories = response.json()

    except requests.RequestException:
        return Response(
            {"error": "Unable to fetch repositories from GitHub"},
            status=502,
        )

    repo_data = []

    for repo in repositories:
        repo_data.append({
            "id": repo["id"],
            "name": repo["name"],
            "full_name": repo["full_name"],
            "description": repo["description"],
            "private": repo["private"],
            "html_url": repo["html_url"],
            "language": repo["language"],
            "default_branch": repo["default_branch"],
            "updated_at": repo["updated_at"],
            "stargazers_count": repo["stargazers_count"],
            "forks_count": repo["forks_count"],
        })

    return Response(repo_data)

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def github_disconnect(request):
    try:
        connection = GitHubConnection.objects.get(user=request.user)
        connection.delete()

        return Response({
            "message": "GitHub disconnected successfully"
        })

    except GitHubConnection.DoesNotExist:
        return Response({
            "message": "GitHub account is already disconnected"
        }, status=200)