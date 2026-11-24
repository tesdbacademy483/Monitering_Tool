import { useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import {
  Plus,
  GitBranch,
  Workflow,
  Play,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Trash2,
  RefreshCw,
  ScrollText,
  ExternalLink,
  FileCode2,
  AlertTriangle,
  Wand2,
  GitCommitHorizontal,
  Rocket,
  Webhook,
} from "lucide-react";
import api from "../services/api";
import WorkflowSetupModal from "../components/WorkflowSetupModal";
import AutomationBanner from "../components/AutomationBanner";

const initialForm = {
  name: "",
  repository: "",
  branch: "main",
  trigger: "push",
  workflow_file: "devopspilot.yml",
  stages: ["Build", "Test"],
};

const ACTIVE = ["queued", "running"];
const POLL_MS = 5000;
// Pushes are picked up by the backend worker; refresh the list now and then
const BACKGROUND_REFRESH_MS = 15000;

const eventLabels = {
  manual: "Run button",
  push: "push",
  pull_request: "pull request",
  workflow_dispatch: "dispatch",
  schedule: "schedule",
  other: "GitHub",
};

function LatestRunLine({ run }) {
  if (!run) {
    return (
      <p className="mt-3 text-xs text-gray-500">
        No runs yet. Push a commit and it will show up here.
      </p>
    );
  }

  const sha = run.head_sha ? run.head_sha.slice(0, 7) : "";

  return (
    <div className="mt-3 flex items-start gap-2 text-xs text-gray-400">
      <GitCommitHorizontal size={14} className="mt-0.5 shrink-0 text-violet-400" />
      <span className="min-w-0">
        <span className="text-gray-300">Run #{run.id}</span>
        {" · "}
        {eventLabels[run.event] || run.event}
        {run.actor ? ` by ${run.actor}` : ""}
        {sha && (
          <>
            {" · "}
            <code className="text-gray-300">{sha}</code>
          </>
        )}
        {run.commit_message && (
          <span className="block truncate text-gray-500">{run.commit_message}</span>
        )}
      </span>
    </div>
  );
}

const statusStyles = {
  idle: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  queued: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  running: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  cancelled: "bg-gray-500/10 text-gray-300 border-gray-500/20",
  success: "bg-green-500/10 text-green-400 border-green-500/20",
  failed: "bg-red-500/10 text-red-400 border-red-500/20",
};

function StatusBadge({ status }) {
  const normalized = status || "idle";

  const icons = {
    idle: Clock,
    queued: Clock,
    running: Loader2,
    success: CheckCircle2,
    failed: XCircle,
    cancelled: XCircle,
  };

  const Icon = icons[normalized] || Clock;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium capitalize ${
        statusStyles[normalized] || statusStyles.idle
      }`}
    >
      <Icon
        size={14}
        className={normalized === "running" ? "animate-spin" : ""}
      />
      {normalized}
    </span>
  );
}

function PipelineCard({
  pipeline,
  onDelete,
  onStop,
  onRun,
  onLogs,
  onSetup,
  onConnectWebhook,
  webhookAvailable,
  isRunning,
  workflowMissing,
}) {
  const stages = Array.isArray(pipeline.stages) ? pipeline.stages : [];

  return (
    <div className="rounded-2xl border border-white/10 bg-[#121b30] p-5 transition hover:border-violet-500/30 hover:bg-[#151f36]">
      {/* Card Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="rounded-xl bg-violet-600/15 p-3 text-violet-400">
            <Workflow size={22} />
          </div>

          <div className="min-w-0">
            <h3 className="truncate font-semibold text-white">
              {pipeline.name}
            </h3>

            <p className="mt-1 text-xs text-gray-500">
              Pipeline #{pipeline.id}
            </p>
          </div>
        </div>

        <StatusBadge
          status={pipeline.latest_run_status || pipeline.status}
        />
      </div>

      {/* Repository */}
      <div className="mt-5 rounded-xl border border-white/5 bg-[#0b1020] p-3">
        <div className="flex items-center gap-2 text-sm text-gray-300">
          <GitBranch size={16} className="shrink-0 text-violet-400" />
          <span className="truncate">{pipeline.repository}</span>
        </div>

        <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
          <GitBranch size={14} />
          <span>{pipeline.branch}</span>
          <span className="mx-1">·</span>
          <span className="capitalize">{pipeline.trigger} trigger</span>
        </div>

        <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
          <FileCode2 size={14} />
          <span className="truncate">
            .github/workflows/{pipeline.workflow_file}
          </span>
        </div>

        <LatestRunLine run={pipeline.latest_run} />
      </div>

      {/* Automation */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {pipeline.auto_deploy_count > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">
            <Rocket size={13} />
            Auto-deploys to {pipeline.auto_deploy_count} environment
            {pipeline.auto_deploy_count > 1 ? "s" : ""} when CI passes
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-gray-400">
            <Rocket size={13} />
            No auto-deploy (turn it on in Deployments)
          </span>
        )}

        {webhookAvailable && (
          <button
            onClick={() => onConnectWebhook(pipeline.id)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-gray-300 transition hover:bg-white/10"
            title="Add a GitHub webhook so runs show up instantly"
          >
            <Webhook size={13} />
            Connect webhook
          </button>
        )}
      </div>

      {/* Stages */}
      <div className="mt-5">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          Pipeline Stages
        </p>

        {stages.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {stages.map((stage, index) => {
              const stageName =
                typeof stage === "string" ? stage : stage.name || stage.type;

              return (
                <span
                  key={`${stageName}-${index}`}
                  className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-gray-300"
                >
                  {index + 1}. {stageName}
                </span>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-gray-500">No stages configured</p>
        )}
      </div>

      {/* Missing workflow warning */}
      {workflowMissing && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3">
          <div className="flex items-center gap-2 text-sm text-yellow-300">
            <AlertTriangle size={16} className="shrink-0" />
            <span>
              <code>{pipeline.workflow_file}</code> is missing in this repo
            </span>
          </div>
          <button
            onClick={() => onSetup(pipeline)}
            className="flex items-center gap-1.5 rounded-lg bg-yellow-500/20 px-3 py-1.5 text-xs font-semibold text-yellow-200 transition hover:bg-yellow-500/30"
          >
            <Wand2 size={14} />
            Set up workflow
          </button>
        </div>
      )}

      {/* Footer */}
      <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4">
        <p className="text-xs text-gray-500">
          Created{" "}
          {pipeline.created_at
            ? new Date(pipeline.created_at).toLocaleDateString()
            : "Recently"}
        </p>

        <div className="flex items-center gap-2">
          {pipeline.latest_run_status && (
            <button
              onClick={() => onLogs(pipeline)}
              title="View logs"
              className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm font-medium text-gray-300 transition hover:bg-white/10"
            >
              <ScrollText size={15} />
              Logs
            </button>
          )}

          {isRunning ? (
            <>
              <button
                disabled
                className="flex items-center gap-2 rounded-lg bg-blue-500/10 px-3 py-2 text-sm font-medium text-blue-400"
              >
                <Loader2 size={15} className="animate-spin" />
                Running
              </button>

              <button
                onClick={() => onStop(pipeline.id)}
                className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm font-medium text-red-400 transition hover:bg-red-500/20"
              >
                <XCircle size={15} />
                Stop
              </button>
            </>
          ) : (
            <button
              onClick={() => onRun(pipeline.id)}
              disabled={isRunning}
              className="flex items-center gap-2 rounded-lg bg-violet-600/10 px-3 py-2 text-sm font-medium text-violet-400 transition hover:bg-violet-600/20 disabled:opacity-50"
            >
              <Play size={15} />
              Run
            </button>
          )}

          <button
            onClick={() => onDelete(pipeline.id)}
            title="Delete pipeline"
            className="rounded-lg p-2 text-gray-500 transition hover:bg-red-500/10 hover:text-red-400"
          >
            <Trash2 size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Pipelines() {
  const [pipelines, setPipelines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(initialForm);

  // GitHub repository states
  const [githubRepos, setGithubRepos] = useState([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState("");



  // Fetch pipelines
  const [runningIds, setRunningIds] = useState([]);
  // const queuedCount = pipelines.filter(
  //     (pipeline) => pipeline.latest_run_status === "queued"
  // ).length;
  // Logs modal
  const [logsPipeline, setLogsPipeline] = useState(null);
  const [logsRun, setLogsRun] = useState(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const logsEndRef = useRef(null);

  // Workflow file check: { [pipelineId]: true | false }
  const [workflowStatus, setWorkflowStatus] = useState({});
  const [setupPipeline, setSetupPipeline] = useState(null);
  const [webhookAvailable, setWebhookAvailable] = useState(false);
  const seenRunIds = useRef(null);

  const checkWorkflow = async (pipelineId) => {
    try {
      const { data } = await api.get(`pipelines/${pipelineId}/workflow-status/`);
      setWorkflowStatus((prev) => ({ ...prev, [pipelineId]: data.exists }));
      return data.exists;
    } catch {
      // GitHub not connected / unreachable: don't show a warning
      return null;
    }
  };

  const checkWorkflows = (list) => {
    list.forEach((pipeline) => checkWorkflow(pipeline.id));
  };

  const fetchPipelines = async (silent = false) => {
    if (!silent) setLoading(true);

    try {
      const response = await api.get("pipelines/");
      announceNewRuns(response.data);
      setPipelines(response.data);
      if (!silent) checkWorkflows(response.data);
    } catch (error) {
      console.error("Failed to fetch pipelines:", error);
      toast.error("Unable to load pipelines");
    } finally {
      setLoading(false);
    }
  };

  // Toast when the worker picked up a new run from a git push
  const announceNewRuns = (list) => {
    const ids = new Set(list.map((p) => p.latest_run?.id).filter(Boolean));
    if (seenRunIds.current) {
      list.forEach((p) => {
        const run = p.latest_run;
        if (run && !seenRunIds.current.has(run.id) && run.event !== "manual") {
          toast(`New ${eventLabels[run.event] || "run"} on ${p.name}: ${run.commit_message || "CI started"}`, {
            icon: "🚀",
          });
        }
      });
    }
    seenRunIds.current = ids;
  };

  useEffect(() => {
    fetchPipelines();
    api
      .get("pipelines/automation-status/")
      .then(({ data }) => setWebhookAvailable(data.webhook_available))
      .catch(() => {});

    const timer = setInterval(() => fetchPipelines(true), BACKGROUND_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const handleConnectWebhook = async (pipelineId) => {
    try {
      const { data } = await api.post(`pipelines/${pipelineId}/connect-webhook/`);
      toast.success(
        data.status === "already_connected"
          ? "Webhook was already connected"
          : "Webhook added. Runs will now show up instantly."
      );
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to add the webhook");
    }
  };

  // Poll GitHub (through our backend) while any pipeline is active
  const activeIds = pipelines
    .filter((p) => ACTIVE.includes(p.latest_run_status))
    .map((p) => p.id)
    .join(",");

  useEffect(() => {
    if (!activeIds) return;

    const timer = setInterval(async () => {
      const ids = activeIds.split(",");

      await Promise.all(
        ids.map(async (id) => {
          try {
            const { data } = await api.get(`pipelines/${id}/latest-run/`);
            if (!ACTIVE.includes(data.status)) {
              const name =
                pipelines.find((p) => String(p.id) === id)?.name || "Pipeline";
              if (data.status === "success") toast.success(`${name} succeeded`);
              else if (data.status === "failed") toast.error(`${name} failed`);
            }
          } catch (error) {
            console.error("Polling failed:", error);
          }
        })
      );

      // Refresh the list (silently) so badges and counts update
      await fetchPipelines(true);
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [activeIds]);

  // ---------- Logs modal ----------
  const refreshLogs = async (pipelineId) => {
    try {
      const { data } = await api.get(`pipelines/${pipelineId}/latest-run/`);
      setLogsRun(data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to load logs");
    }
  };

  const openLogs = async (pipeline) => {
    setLogsPipeline(pipeline);
    setLogsRun(null);
    setLogsLoading(true);
    await refreshLogs(pipeline.id);
    setLogsLoading(false);
  };

  const closeLogs = () => {
    setLogsPipeline(null);
    setLogsRun(null);
  };

  // Live-refresh the open logs while that run is active
  useEffect(() => {
    if (!logsPipeline || !logsRun || !ACTIVE.includes(logsRun.status)) return;
    const timer = setInterval(() => refreshLogs(logsPipeline.id), POLL_MS);
    return () => clearInterval(timer);
  }, [logsPipeline, logsRun?.status]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logsRun?.logs]);

  // Fetch GitHub repositories when modal opens
  const openCreateModal = async () => {
    setModalOpen(true);
    setReposLoading(true);
    setReposError("");

    try {
      const response = await api.get("github/repositories/");
      setGithubRepos(response.data);
    } catch (error) {
      console.error("Failed to fetch GitHub repositories:", error);

      setGithubRepos([]);

      setReposError(
        error.response?.data?.error ||
          "Unable to load GitHub repositories."
      );
    } finally {
      setReposLoading(false);
    }
  };
  

  const handleRun = async (pipelineId) => {
    setRunningIds((prev) => [...prev, pipelineId]);

    try {
      const response = await api.post(`pipelines/${pipelineId}/run/`);

      toast.success(`Run #${response.data.id} started on GitHub Actions`);

      // Refresh pipeline data to get the latest run status (starts polling)
      await fetchPipelines(true);
    } catch (error) {
      console.error("Failed to run pipeline:", error.response?.data || error);
      checkWorkflow(pipelineId);
      toast.error(
        error.response?.data?.detail || "Failed to start pipeline run"
      );
    } finally {
      setRunningIds((prev) => prev.filter((id) => id !== pipelineId));
    }
  };

  const handleStop = async (pipelineId) => {
    try {
      await api.post(`pipelines/${pipelineId}/stop/`);

      toast.success("Pipeline stopped");

      await fetchPipelines(true);
    } catch (error) {
      console.error("Stop pipeline failed:", error.response?.data || error);

      toast.error(
        error.response?.data?.detail || "Unable to stop pipeline"
      );
    }
  };

  // Update form fields
  const updateForm = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  // Toggle pipeline stages
  const toggleStage = (stage) => {
    setForm((prev) => ({
      ...prev,
      stages: prev.stages.includes(stage)
        ? prev.stages.filter((s) => s !== stage)
        : [...prev.stages, stage],
    }));
  };

  // Create pipeline
  const handleCreate = async (e) => {
    e.preventDefault();

    if (!form.name.trim() || !form.repository.trim()) {
      toast.error("Pipeline name and repository are required");
      return;
    }

    setCreating(true);

    try {
      const payload = {
        name: form.name.trim(),
        repository: form.repository.trim(),
        branch: form.branch.trim() || "main",
        trigger: form.trigger,
        workflow_file: form.workflow_file.trim() || "devopspilot.yml",
        stages: form.stages.map((stage) => ({
          name: stage,
          type: stage.toLowerCase(),
        })),
        config: "",
      };

      const { data: created } = await api.post("pipelines/", payload);

      toast.success("Pipeline created successfully");

      setForm(initialForm);
      setModalOpen(false);

      await fetchPipelines(true);

      // Offer to add the workflow straight away if the repo doesn't have it
      const exists = await checkWorkflow(created.id);
      if (exists === false) setSetupPipeline(created);
    } catch (error) {
      console.error(
        "Create pipeline failed:",
        error.response?.data || error
      );
      const data = error.response?.data;
      toast.error(data?.workflow_file?.[0] || "Failed to create pipeline");
    } finally {
      setCreating(false);
    }
  };

  // Delete pipeline
  const handleDelete = async (id) => {
    const confirmed = window.confirm(
      "Are you sure you want to delete this pipeline?"
    );

    if (!confirmed) return;

    try {
      await api.delete(`pipelines/${id}/`);

      setPipelines((prev) =>
        prev.filter((pipeline) => pipeline.id !== id)
      );

      toast.success("Pipeline deleted");
    } catch (error) {
      console.error("Delete pipeline failed:", error);
      toast.error("Failed to delete pipeline");
    }
  };

  const successfulCount = pipelines.filter(
    (pipeline) => pipeline.latest_run_status === "success"
  ).length;

  const runningCount = pipelines.filter(
    (pipeline) => pipeline.latest_run_status === "running"
  ).length;

  const queuedCount = pipelines.filter(
    (pipeline) => pipeline.latest_run_status === "queued"
  ).length;

  const failedCount = pipelines.filter(
    (pipeline) => pipeline.latest_run_status === "failed"
  ).length;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold text-white">Pipelines</h1>

          <p className="mt-2 text-gray-400">
            Every push to GitHub is built and tested automatically.
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => fetchPipelines()}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#121b30] px-4 py-3 text-gray-300 transition hover:bg-white/5 disabled:opacity-50"
          >
            <RefreshCw
              size={17}
              className={loading ? "animate-spin" : ""}
            />
          </button>

          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-3 font-semibold text-white transition hover:bg-violet-500"
          >
            <Plus size={18} />
            Create Pipeline
          </button>
        </div>
      </div>

      <AutomationBanner hasPipelines={pipelines.length > 0} />

      {/* Statistics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          title="Total Pipelines"
          value={pipelines.length}
          icon={Workflow}
          color="violet"
        />

        <StatCard
          title="Successful"
          value={successfulCount}
          icon={CheckCircle2}
          color="green"
        />

        <StatCard
          title="Running"
          value={runningCount}
          icon={Play}
          color="blue"
        />

        <StatCard
          title="Failed"
          value={failedCount}
          icon={XCircle}
          color="red"
        />

        <StatCard
          title="Queued"
          value={queuedCount}
          icon={Clock}
          color="yellow"
        />
      </div>

      {/* Pipeline List */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Your Pipelines</h2>

          <span className="text-sm text-gray-500">
            {pipelines.length} total
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-[#121b30] py-16 text-gray-400">
            <Loader2 className="mr-2 animate-spin" size={20} />
            Loading pipelines...
          </div>
        ) : pipelines.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-[#121b30] px-6 py-16 text-center">
            <div className="mx-auto mb-4 w-fit rounded-2xl bg-violet-600/10 p-4 text-violet-400">
              <Workflow size={30} />
            </div>

            <h3 className="text-lg font-semibold text-white">
              No pipelines yet
            </h3>

            <p className="mt-2 text-sm text-gray-400">
              Create your first pipeline to start automating your repository.
            </p>

            <button
              onClick={openCreateModal}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-3 font-semibold text-white transition hover:bg-violet-500"
            >
              <Plus size={18} />
              Create your first pipeline
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {pipelines.map((pipeline) => (
              <PipelineCard
                key={pipeline.id}
                pipeline={pipeline}
                onDelete={handleDelete}
                onRun={handleRun}
                onStop={handleStop}
                onLogs={openLogs}
                onSetup={setSetupPipeline}
                onConnectWebhook={handleConnectWebhook}
                webhookAvailable={webhookAvailable}
                workflowMissing={workflowStatus[pipeline.id] === false}
                isRunning={
                  runningIds.includes(pipeline.id) ||
                  ["queued", "running"].includes(pipeline.latest_run_status)
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Workflow setup */}
      {setupPipeline && (
        <WorkflowSetupModal
          pipeline={setupPipeline}
          onClose={() => setSetupPipeline(null)}
          onDone={() =>
            setWorkflowStatus((prev) => ({ ...prev, [setupPipeline.id]: true }))
          }
        />
      )}

      {/* Create Pipeline Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => !creating && setModalOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#121b30] p-6 shadow-2xl sm:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">
                  Create Pipeline
                </h2>

                <p className="mt-1 text-sm text-gray-400">
                  Configure your repository workflow.
                </p>
              </div>

              <button
                onClick={() => setModalOpen(false)}
                disabled={creating}
                className="rounded-lg p-2 text-gray-400 hover:bg-white/5 hover:text-white"
              >
                <XCircle size={20} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-5">
              {/* Pipeline Name */}
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-300">
                  Pipeline Name
                </label>

                <input
                  value={form.name}
                  onChange={(e) => updateForm("name", e.target.value)}
                  placeholder="e.g. Frontend CI Pipeline"
                  required
                  className="w-full rounded-xl border border-white/10 bg-[#0b1020] p-3 text-white outline-none transition focus:border-violet-500"
                />
              </div>

              {/* GitHub Repository Dropdown */}
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-300">
                  GitHub Repository
                </label>

                {reposLoading ? (
                  <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#0b1020] p-3 text-sm text-gray-400">
                    <Loader2 size={16} className="animate-spin" />
                    Loading repositories...
                  </div>
                ) : reposError ? (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
                    <p className="text-sm text-red-400">{reposError}</p>

                    <button
                      type="button"
                      onClick={openCreateModal}
                      className="mt-2 text-sm text-violet-400 hover:text-violet-300"
                    >
                      Retry loading repositories
                    </button>
                  </div>
                ) : githubRepos.length === 0 ? (
                  <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-3">
                    <p className="text-sm text-yellow-400">
                      No repositories found.
                    </p>

                    <p className="mt-1 text-xs text-gray-400">
                      Connect GitHub or check that your account has repositories.
                    </p>
                  </div>
                ) : (
                  <select
                    value={form.repository}
                    onChange={(e) => {
                      const selectedRepo = githubRepos.find(
                        (repo) => repo.full_name === e.target.value
                      );

                      updateForm(
                        "repository",
                        selectedRepo?.full_name || ""
                      );

                      updateForm(
                        "branch",
                        selectedRepo?.default_branch || "main"
                      );
                    }}
                    required
                    className="w-full rounded-xl border border-white/10 bg-[#0b1020] p-3 text-white outline-none transition focus:border-violet-500"
                  >
                    <option value="">Select a repository</option>

                    {githubRepos.map((repo) => (
                      <option key={repo.id} value={repo.full_name}>
                        {repo.full_name}
                        {repo.private ? " (Private)" : ""}
                      </option>
                    ))}
                  </select>
                )}

                {form.repository && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-green-400">
                    <GitBranch size={14} />
                    Selected: {form.repository}
                  </div>
                )}
              </div>

              {/* Branch */}
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-300">
                  Branch
                </label>

                <input
                  value={form.branch}
                  onChange={(e) => updateForm("branch", e.target.value)}
                  placeholder="main"
                  className="w-full rounded-xl border border-white/10 bg-[#0b1020] p-3 text-white outline-none transition focus:border-violet-500"
                />
              </div>

              {/* Trigger */}
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-300">
                  Trigger
                </label>

                <select
                  value={form.trigger}
                  onChange={(e) => updateForm("trigger", e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#0b1020] p-3 text-white outline-none focus:border-violet-500"
                >
                  <option value="push">On every push (automatic)</option>
                  <option value="manual">Manual only</option>
                </select>
                <p className="mt-1.5 text-xs text-gray-500">
                  DevOpsPilot tracks every run of the workflow either way. The generated
                  workflow runs on each push to the branch.
                </p>
              </div>

              {/* Workflow File */}
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-300">
                  GitHub Actions Workflow File
                </label>

                <div className="flex items-center rounded-xl border border-white/10 bg-[#0b1020] focus-within:border-violet-500">
                  <span className="pl-3 text-sm text-gray-500">
                    .github/workflows/
                  </span>
                  <input
                    value={form.workflow_file}
                    onChange={(e) => updateForm("workflow_file", e.target.value)}
                    placeholder="devopspilot.yml"
                    className="w-full bg-transparent p-3 pl-1 text-white outline-none"
                  />
                </div>

                <p className="mt-1.5 text-xs text-gray-500">
                  The workflow must include <code>on: workflow_dispatch</code>.
                </p>
              </div>

              {/* Pipeline Stages */}
              <div>
                <label className="mb-3 block text-sm font-medium text-gray-300">
                  Pipeline Stages
                </label>

                <div className="grid grid-cols-2 gap-3">
                  {["Build", "Test", "Deploy"].map((stage) => (
                    <label
                      key={stage}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${
                        form.stages.includes(stage)
                          ? "border-violet-500/40 bg-violet-500/10 text-violet-300"
                          : "border-white/10 bg-[#0b1020] text-gray-400"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={form.stages.includes(stage)}
                        onChange={() => toggleStage(stage)}
                        className="accent-violet-500"
                      />
                      {stage}
                    </label>
                  ))}
                </div>
              </div>

              {/* Buttons */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  disabled={creating}
                  className="rounded-xl border border-white/10 px-4 py-3 text-gray-300 transition hover:bg-white/5 disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={creating}
                  className="flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-3 font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
                >
                  {creating && (
                    <Loader2 size={17} className="animate-spin" />
                  )}

                  {creating ? "Creating..." : "Create Pipeline"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Logs Modal */}
      {logsPipeline && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={closeLogs}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-2xl border border-white/10 bg-[#121b30] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/10 p-5">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold text-white">
                  {logsPipeline.name}
                  {logsRun && (
                    <span className="ml-2 text-sm font-normal text-gray-500">
                      Run #{logsRun.id}
                    </span>
                  )}
                </h2>
                {logsRun?.sync_error && (
                  <p className="mt-1 text-xs text-red-400">
                    {logsRun.sync_error}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {logsRun && <StatusBadge status={logsRun.status} />}

                {logsRun?.html_url && (
                  <a
                    href={logsRun.html_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/10"
                  >
                    <ExternalLink size={14} />
                    GitHub
                  </a>
                )}

                <button
                  onClick={closeLogs}
                  className="rounded-lg p-2 text-gray-400 hover:bg-white/5 hover:text-white"
                >
                  <XCircle size={20} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto bg-[#0b1020] p-5">
              {logsLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Loader2 size={16} className="animate-spin" />
                  Loading logs...
                </div>
              ) : (
                <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-gray-300">
                  {logsRun?.logs || "No logs yet."}
                </pre>
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color }) {
  const colorStyles = {
    violet: "bg-violet-500/10 text-violet-400",
    green: "bg-green-500/10 text-green-400",
    blue: "bg-blue-500/10 text-blue-400",
    red: "bg-red-500/10 text-red-400",
    yellow: "bg-yellow-500/10 text-yellow-400",
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-[#121b30] p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">{title}</p>

        <div className={`rounded-xl p-2.5 ${colorStyles[color]}`}>
          <Icon size={20} />
        </div>
      </div>

      <p className="mt-4 text-3xl font-bold text-white">{value}</p>
    </div>
  );
}