"""
Automatic GitHub Actions workflow setup.

1. workflow_status()   -> does .github/workflows/<file> exist on the branch?
2. build_preview()     -> looks at the repo's files, detects the stack(s)
                          and generates a matching workflow YAML
3. commit_workflow()   -> commits that YAML to the repo

Creating files inside .github/workflows needs the OAuth "workflow" scope,
so users must reconnect GitHub once after this feature is added.
"""

import base64
import json
import posixpath

import requests

from .github_actions import API, GitHubActionsError, _headers

MAX_WORKFLOW_BYTES = 50_000
SKIP_DIRS = ("node_modules/", "venv/", ".venv/", "vendor/", "dist/", "build/", ".git/")

SCOPE_MESSAGE = (
    "DevopsPilot needs permission to create workflow files. "
    "Go to Profile, click Disconnect, then Connect GitHub again."
)


# ------------------------------------------------------------------
# GitHub helpers
# ------------------------------------------------------------------

def _raw(method, url, user, **kwargs):
    """Like requests.request, but with the user's GitHub token. Never raises on 4xx."""
    kwargs.setdefault("timeout", 20)
    try:
        return requests.request(method, url, headers=_headers(user), **kwargs)
    except requests.RequestException:
        raise GitHubActionsError("Could not reach GitHub. Check your internet connection.")


def _check_auth(response):
    if response.status_code == 401:
        raise GitHubActionsError("GitHub token expired. Reconnect GitHub on the Profile page.")


def _workflow_path(workflow_file):
    return f".github/workflows/{workflow_file}"


def workflow_status(user, repo, branch, workflow_file):
    response = _raw(
        "GET",
        f"{API}/repos/{repo}/contents/{_workflow_path(workflow_file)}",
        user,
        params={"ref": branch},
    )
    _check_auth(response)

    if response.status_code == 200:
        return {"exists": True, "html_url": response.json().get("html_url", "")}
    if response.status_code == 404:
        return {"exists": False, "html_url": ""}

    raise GitHubActionsError(f"GitHub error {response.status_code} while checking the workflow.")


def _repo_paths(user, repo, branch):
    """All file paths in the branch (one API call)."""
    response = _raw(
        "GET",
        f"{API}/repos/{repo}/git/trees/{branch}",
        user,
        params={"recursive": "1"},
    )
    _check_auth(response)

    if response.status_code == 404:
        raise GitHubActionsError(
            f"Branch '{branch}' was not found in {repo}. Check the branch name, "
            "or the repository may be empty."
        )
    if response.status_code == 409:
        raise GitHubActionsError(f"{repo} is empty. Push some code first.")
    if response.status_code >= 400:
        raise GitHubActionsError(f"GitHub error {response.status_code} while reading the repo.")

    return [
        item["path"]
        for item in response.json().get("tree", [])
        if item.get("type") == "blob" and not any(skip in item["path"] + "/" for skip in SKIP_DIRS)
    ]


def _read_package_scripts(user, repo, branch, directory):
    """Return the "scripts" section of package.json (empty dict if unreadable)."""
    path = posixpath.join(directory, "package.json") if directory else "package.json"
    response = _raw(
        "GET",
        f"{API}/repos/{repo}/contents/{path}",
        user,
        params={"ref": branch},
    )
    if response.status_code != 200:
        return {}
    try:
        raw = base64.b64decode(response.json().get("content", ""))
        scripts = json.loads(raw).get("scripts", {})
        return scripts if isinstance(scripts, dict) else {}
    except (ValueError, TypeError):
        return {}


def _has_workflow_scope(user):
    response = _raw("GET", f"{API}/user", user)
    _check_auth(response)
    scopes = [s.strip() for s in response.headers.get("X-OAuth-Scopes", "").split(",")]
    return "workflow" in scopes


# ------------------------------------------------------------------
# Stack detection
# ------------------------------------------------------------------

def detect_stacks(paths):
    """
    Look at the root and one folder deep (e.g. backend/, frontend/).
    Returns a list of {"stack": ..., "dir": ..., ...extra info}.
    """
    files = set(paths)
    candidate_dirs = sorted({""} | {p.split("/")[0] for p in paths if p.count("/") >= 1})

    def has(d, name):
        return posixpath.join(d, name) in files if d else name in files

    stacks = []

    for d in candidate_dirs:
        found_in_dir = False

        if has(d, "package.json"):
            if has(d, "pnpm-lock.yaml"):
                manager = "pnpm"
            elif has(d, "yarn.lock"):
                manager = "yarn"
            elif has(d, "package-lock.json"):
                manager = "npm-ci"
            else:
                manager = "npm"
            stacks.append({"stack": "node", "dir": d, "manager": manager})
            found_in_dir = True

        if has(d, "requirements.txt") or has(d, "pyproject.toml") or has(d, "manage.py"):
            prefix = f"{d}/" if d else ""
            has_tests = any(
                p.startswith(prefix)
                and (posixpath.basename(p).startswith("test_") or "/tests/" in "/" + p[len(prefix):])
                and p.endswith(".py")
                for p in paths
            )
            stacks.append({
                "stack": "django" if has(d, "manage.py") else "python",
                "dir": d,
                "requirements": has(d, "requirements.txt"),
                "pyproject": has(d, "pyproject.toml"),
                "tests": has_tests,
            })
            found_in_dir = True

        if has(d, "pom.xml"):
            stacks.append({"stack": "maven", "dir": d})
            found_in_dir = True
        elif has(d, "build.gradle") or has(d, "build.gradle.kts"):
            stacks.append({"stack": "gradle", "dir": d, "wrapper": has(d, "gradlew")})
            found_in_dir = True

        if has(d, "go.mod"):
            stacks.append({"stack": "go", "dir": d})
            found_in_dir = True

        if not found_in_dir and has(d, "Dockerfile"):
            stacks.append({"stack": "docker", "dir": d})

    # A root-level project already covers sub-folders of the same stack
    root_stacks = {s["stack"] for s in stacks if s["dir"] == ""}
    stacks = [s for s in stacks if s["dir"] == "" or s["stack"] not in root_stacks]

    return stacks


# ------------------------------------------------------------------
# YAML generation
# ------------------------------------------------------------------

LABELS = {
    "node": "Node.js",
    "python": "Python",
    "django": "Django",
    "maven": "Java (Maven)",
    "gradle": "Java (Gradle)",
    "go": "Go",
    "docker": "Docker",
}


def _job_id(stack):
    name = stack["stack"]
    if stack["dir"]:
        safe = "".join(ch if ch.isalnum() else "_" for ch in stack["dir"].lower())
        name = f"{name}_{safe}"
    return name


def _job_header(stack):
    label = LABELS[stack["stack"]]
    title = f"{label} ({stack['dir']})" if stack["dir"] else label
    lines = [
        f"  {_job_id(stack)}:",
        f"    name: {title}",
        "    runs-on: ubuntu-latest",
    ]
    if stack["dir"]:
        lines += [
            "    defaults:",
            "      run:",
            f"        working-directory: {stack['dir']}",
        ]
    lines += [
        "    steps:",
        "      - name: Checkout code",
        "        uses: actions/checkout@v5",
        "",
    ]
    return lines


def _node_steps(stack):
    d = stack["dir"]
    lock = {
        "npm-ci": "package-lock.json",
        "yarn": "yarn.lock",
        "pnpm": "pnpm-lock.yaml",
    }.get(stack["manager"])

    lines = []
    if stack["manager"] == "pnpm":
        lines += [
            "      - name: Set up pnpm",
            "        uses: pnpm/action-setup@v4",
            "",
        ]
    lines += [
        "      - name: Set up Node",
        "        uses: actions/setup-node@v4",
        "        with:",
        '          node-version: "22"',
    ]
    if lock:
        cache = "npm" if stack["manager"] == "npm-ci" else stack["manager"]
        lines += [
            f"          cache: {cache}",
            f"          cache-dependency-path: {posixpath.join(d, lock) if d else lock}",
        ]
    lines.append("")

    install = {
        "npm-ci": "npm ci",
        "npm": "npm install",
        "yarn": "yarn install --frozen-lockfile",
        "pnpm": "pnpm install --frozen-lockfile",
    }[stack["manager"]]
    lines += [
        "      - name: Install dependencies",
        f"        run: {install}",
        "",
    ]

    # npm can run package.json scripts no matter which tool installed the packages
    scripts = stack.get("scripts", {})
    if "build" in scripts:
        lines += ["      - name: Build", "        run: npm run build", ""]

    test_script = str(scripts.get("test", ""))
    if test_script and "no test specified" not in test_script:
        lines += ["      - name: Test", "        run: npm test", ""]

    if "build" not in scripts and "Test" not in "".join(lines):
        lines += [
            "      - name: Check project",
            "        run: npm ls --depth=0 || true",
            "",
        ]
    return lines


def _python_steps(stack):
    lines = [
        "      - name: Set up Python",
        "        uses: actions/setup-python@v5",
        "        with:",
        '          python-version: "3.12"',
        "",
        "      - name: Install dependencies",
        "        run: |",
        "          python -m pip install --upgrade pip",
    ]
    if stack["requirements"]:
        lines.append("          pip install -r requirements.txt")
    elif stack["pyproject"]:
        lines.append("          pip install .")
    lines.append("")

    if stack["stack"] == "django":
        lines += [
            "      - name: Django system check",
            "        run: python manage.py check",
            "",
        ]
    else:
        lines += [
            "      - name: Check syntax",
            "        run: python -m compileall -q .",
            "",
        ]

    if stack["tests"]:
        lines += [
            "      - name: Run tests",
            "        run: |",
            "          pip install pytest",
            "          pytest",
            "",
        ]
    return lines


def _maven_steps(stack):
    return [
        "      - name: Set up Java",
        "        uses: actions/setup-java@v4",
        "        with:",
        "          distribution: temurin",
        '          java-version: "21"',
        "          cache: maven",
        "",
        "      - name: Build and test",
        "        run: mvn -B package",
        "",
    ]


def _gradle_steps(stack):
    command = "./gradlew build" if stack["wrapper"] else "gradle build"
    lines = [
        "      - name: Set up Java",
        "        uses: actions/setup-java@v4",
        "        with:",
        "          distribution: temurin",
        '          java-version: "21"',
        "",
        "      - name: Set up Gradle",
        "        uses: gradle/actions/setup-gradle@v4",
        "",
    ]
    if stack["wrapper"]:
        lines += [
            "      - name: Make Gradle wrapper executable",
            "        run: chmod +x gradlew",
            "",
        ]
    lines += [
        "      - name: Build and test",
        f"        run: {command}",
        "",
    ]
    return lines


def _go_steps(stack):
    d = stack["dir"]
    return [
        "      - name: Set up Go",
        "        uses: actions/setup-go@v5",
        "        with:",
        f"          go-version-file: {posixpath.join(d, 'go.mod') if d else 'go.mod'}",
        "",
        "      - name: Build",
        "        run: go build ./...",
        "",
        "      - name: Test",
        "        run: go test ./...",
        "",
    ]


def _docker_steps(stack):
    return [
        "      - name: Build Docker image",
        "        run: docker build -t app:ci .",
        "",
    ]


def _fallback_job():
    return [
        "  build:",
        "    name: Build",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Checkout code",
        "        uses: actions/checkout@v5",
        "",
        "      - name: Show project files",
        "        run: ls -la",
        "",
        "      # No known project type was detected.",
        "      # Add your own build and test commands here, for example:",
        "      # - name: Build",
        "      #   run: make build",
        "",
    ]


STEP_BUILDERS = {
    "node": _node_steps,
    "python": _python_steps,
    "django": _python_steps,
    "maven": _maven_steps,
    "gradle": _gradle_steps,
    "go": _go_steps,
    "docker": _docker_steps,
}


def generate_workflow(stacks, branch, on_push=True):
    lines = [
        "# Generated by DevopsPilot",
        "# Runs when you click Run in DevopsPilot"
        + (", and on every push to this branch." if on_push else "."),
        "# DevopsPilot picks up every run, alerts you when it fails and",
        "# starts auto-deploys when it passes.",
        "",
        "name: DevOpsPilot CI",
        "",
        "on:",
        "  workflow_dispatch:",
    ]
    if on_push:
        lines += ["  push:", f"    branches: [{branch}]"]
    lines += [
        "",
        "# A newer push cancels the older, still-running CI for the same branch",
        "concurrency:",
        "  group: ci-${{ github.ref }}",
        "  cancel-in-progress: true",
        "",
        "jobs:",
    ]

    if not stacks:
        lines += _fallback_job()
    else:
        for stack in stacks:
            lines += _job_header(stack)
            lines += STEP_BUILDERS[stack["stack"]](stack)

    return "\n".join(lines).rstrip() + "\n"


def describe(stack):
    label = LABELS[stack["stack"]]
    return f"{label} in /{stack['dir']}" if stack["dir"] else f"{label} (root)"


def generate_deploy_workflow(stacks):
    """
    deploy.yml: DevOpsPilot starts it (after CI passes, or the Deploy button)
    with the environment as input. It builds the project, then calls the
    hosting provider's deploy hook stored as a GitHub environment secret.
    """
    lines = [
        "# Generated by DevopsPilot",
        "# DevopsPilot starts this workflow automatically when CI passes",
        "# (for deployments with auto-deploy on), or when you click Deploy.",
        "#",
        "# One-time setup on GitHub:",
        "#   Settings -> Environments -> New environment: development / staging / production",
        "#   In each environment add a secret named DEPLOY_HOOK_URL.",
        "#   Render, Vercel and Netlify all give you a deploy hook URL in their settings.",
        "#   Tip: add 'Required reviewers' to production for a manual approval step.",
        "",
        "name: DevOpsPilot Deploy",
        "",
        "on:",
        "  workflow_dispatch:",
        "    inputs:",
        "      environment:",
        "        description: Where to deploy",
        "        required: true",
        "        default: development",
        "        type: choice",
        "        options: [development, staging, production]",
        "",
        "# Never run two deploys to the same environment at once",
        "concurrency:",
        "  group: deploy-${{ inputs.environment }}",
        "  cancel-in-progress: false",
        "",
        "jobs:",
    ]

    build_jobs = []
    for stack in stacks:
        lines += _job_header(stack)
        lines += STEP_BUILDERS[stack["stack"]](stack)
        build_jobs.append(_job_id(stack))

    lines += [
        "  deploy:",
        "    name: Deploy to ${{ inputs.environment }}",
    ]
    if build_jobs:
        lines.append(f"    needs: [{', '.join(build_jobs)}]")
    lines += [
        "    runs-on: ubuntu-latest",
        "    environment: ${{ inputs.environment }}",
        "    steps:",
        "      - name: Trigger deploy hook",
        "        env:",
        "          DEPLOY_HOOK_URL: ${{ secrets.DEPLOY_HOOK_URL }}",
        "        run: |",
        '          if [ -z "$DEPLOY_HOOK_URL" ]; then',
        "            echo \"::error::Add a DEPLOY_HOOK_URL secret to the '${{ inputs.environment }}' environment (repo Settings -> Environments).\"",
        "            exit 1",
        "          fi",
        '          curl --fail-with-body -sS -X POST "$DEPLOY_HOOK_URL"',
        '          echo "Deploy hook accepted for ${{ inputs.environment }}"',
        "",
        "      # Deploying to your own server instead? Replace the step above with:",
        "      # - name: Deploy over SSH",
        "      #   uses: appleboy/ssh-action@v1",
        "      #   with:",
        "      #     host: ${{ secrets.SSH_HOST }}",
        "      #     username: ${{ secrets.SSH_USER }}",
        "      #     key: ${{ secrets.SSH_KEY }}",
        "      #     script: |",
        "      #       cd /srv/app && git pull && ./restart.sh",
        "",
    ]
    return "\n".join(lines).rstrip() + "\n"


def _detect(user, repo, branch):
    paths = _repo_paths(user, repo, branch)
    stacks = detect_stacks(paths)
    for stack in stacks:
        if stack["stack"] == "node":
            stack["scripts"] = _read_package_scripts(user, repo, branch, stack["dir"])
    return stacks


def build_preview(user, repo, branch, on_push=True):
    stacks = _detect(user, repo, branch)
    return {
        "detected": [describe(s) for s in stacks],
        "content": generate_workflow(stacks, branch, on_push=on_push),
    }


def build_deploy_preview(user, repo, branch):
    stacks = _detect(user, repo, branch)
    return {
        "detected": [describe(s) for s in stacks],
        "content": generate_deploy_workflow(stacks),
    }


# ------------------------------------------------------------------
# Commit
# ------------------------------------------------------------------

def commit_workflow(user, repo, branch, workflow_file, content, message=None):
    if not content or not content.strip():
        raise GitHubActionsError("The workflow is empty.")
    if len(content.encode()) > MAX_WORKFLOW_BYTES:
        raise GitHubActionsError("The workflow file is too large.")
    if "workflow_dispatch" not in content:
        raise GitHubActionsError(
            "The workflow must include 'workflow_dispatch' so DevopsPilot can start it."
        )

    if workflow_status(user, repo, branch, workflow_file)["exists"]:
        raise GitHubActionsError(
            f".github/workflows/{workflow_file} already exists on '{branch}'."
        )

    if not _has_workflow_scope(user):
        raise GitHubActionsError(SCOPE_MESSAGE)

    response = _raw(
        "PUT",
        f"{API}/repos/{repo}/contents/{_workflow_path(workflow_file)}",
        user,
        json={
            "message": message or f"Add {workflow_file} (DevopsPilot CI)",
            "content": base64.b64encode(content.encode()).decode(),
            "branch": branch,
        },
    )
    _check_auth(response)

    if response.status_code in (200, 201):
        data = response.json()
        return {
            "html_url": data.get("content", {}).get("html_url", ""),
            "commit_sha": data.get("commit", {}).get("sha", ""),
        }
    if response.status_code in (403, 404):
        raise GitHubActionsError(
            "GitHub refused to create the file. You need write access to this repo"
            " and the 'workflow' permission. " + SCOPE_MESSAGE
        )
    if response.status_code == 409:
        raise GitHubActionsError("The branch changed while saving. Please try again.")

    message = ""
    try:
        message = response.json().get("message", "")
    except ValueError:
        pass
    raise GitHubActionsError(f"GitHub error {response.status_code}: {message}")