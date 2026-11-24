import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  Rocket,
  Plus,
  RefreshCw,
  Trash2,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  Server,
  GitBranch,
  Workflow,
  Loader2,
  Search,
  ExternalLink,
  FileCode2,
  Square,
  Zap,
  HeartPulse,
  AlertTriangle,
  Wand2,
} from "lucide-react";
import api from "../services/api";
import AutomationBanner from "../components/AutomationBanner";
import WorkflowSetupModal from "../components/WorkflowSetupModal";

const environments = ["all", "development", "staging", "production"];

const POLL_MS = 5000;
// Auto-deploys are started by the backend worker; refresh now and then
const BACKGROUND_REFRESH_MS = 15000;

const emptyForm = {
  name: "",
  pipeline: "",
  environment: "development",
  workflow_file: "deploy.yml",
  auto_deploy: true,
  health_monitor: "",
};

const healthStyles = {
  checking: "border-blue-500/20 bg-blue-500/10 text-blue-300",
  healthy: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  unhealthy: "border-red-500/20 bg-red-500/10 text-red-300",
};

const healthLabels = {
  checking: "Health check running...",
  healthy: "Healthy after deploy",
  unhealthy: "Unhealthy after deploy",
};

const statusStyles = {
  pending: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  deploying: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  failed: "bg-red-500/10 text-red-400 border-red-500/20",
  cancelled: "bg-gray-500/10 text-gray-400 border-gray-500/20",
};

function StatusBadge({ status }) {
  const current = statusStyles[status] || statusStyles.pending;

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold capitalize ${current}`}
    >
      {status || "pending"}
    </span>
  );
}

function DeploymentCard({
  deployment,
  onDeploy,
  onCancel,
  onDelete,
  onToggleAuto,
  onSetup,
  workflowMissing,
  deploying,
}) {
  const isDeploying = deployment.status === "deploying";

  return (
    <div className="rounded-2xl border border-white/10 bg-[#121b30] p-5 transition hover:border-violet-500/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-violet-500/10 p-3 text-violet-400">
            <Rocket size={20} />
          </div>

          <div>
            <h3 className="font-semibold text-white">{deployment.name}</h3>
            <p className="mt-1 text-xs text-gray-500">
              Deployment #{deployment.id}
            </p>
          </div>
        </div>

        <StatusBadge status={deployment.status} />
      </div>

      <div className="mt-5 space-y-3">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <GitBranch size={15} className="text-violet-400" />
          <span className="break-all">{deployment.repository}</span>
        </div>

        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Workflow size={15} className="text-violet-400" />
          <span>{deployment.pipeline_name || `Pipeline #${deployment.pipeline}`}</span>
        </div>

        <div className="flex items-center gap-2 text-sm text-gray-400">
          <GitBranch size={15} className="text-violet-400" />
          <span>{deployment.branch}</span>
        </div>

        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Server size={15} className="text-violet-400" />
          <span className="capitalize">{deployment.environment}</span>
        </div>

        <div className="flex items-center gap-2 text-sm text-gray-400">
          <FileCode2 size={15} className="text-violet-400" />
          <span className="truncate">
            .github/workflows/{deployment.workflow_file || "deploy.yml"}
          </span>
        </div>

        {deployment.health_monitor_name && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <HeartPulse size={15} className="text-violet-400" />
            <span>Health check: {deployment.health_monitor_name}</span>
          </div>
        )}

        {deployment.started_at && (
          <div className="text-xs text-gray-500">
            Last deploy:{" "}
            {deployment.trigger_source === "auto"
              ? `automatic, after CI run #${deployment.triggered_by_run} passed`
              : "manual"}
            {" · "}
            {new Date(deployment.started_at).toLocaleString()}
          </div>
        )}

        {(deployment.commit_hash || deployment.html_url) && (
          <div className="flex items-center gap-3 text-xs text-gray-500">
            {deployment.commit_hash && (
              <span>Commit: {deployment.commit_hash.slice(0, 7)}</span>
            )}
            {deployment.html_url && (
              <a
                href={deployment.html_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-violet-400 hover:text-violet-300"
              >
                <ExternalLink size={12} />
                View on GitHub
              </a>
            )}
          </div>
        )}
      </div>

      {/* Automation */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => onToggleAuto(deployment)}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
            deployment.auto_deploy
              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
              : "border-white/10 bg-white/5 text-gray-400 hover:bg-white/10"
          }`}
          title="Deploy automatically every time CI passes"
        >
          <Zap size={13} />
          Auto-deploy {deployment.auto_deploy ? "on" : "off"}
        </button>

        {deployment.health_status && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${
              healthStyles[deployment.health_status]
            }`}
          >
            <HeartPulse size={13} />
            {healthLabels[deployment.health_status]}
          </span>
        )}
      </div>

      {workflowMissing && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3">
          <div className="flex items-center gap-2 text-sm text-yellow-300">
            <AlertTriangle size={16} className="shrink-0" />
            <span>
              <code>{deployment.workflow_file}</code> is missing in this repo
            </span>
          </div>
          <button
            onClick={() => onSetup(deployment)}
            className="flex items-center gap-1.5 rounded-lg bg-yellow-500/20 px-3 py-1.5 text-xs font-semibold text-yellow-200 transition hover:bg-yellow-500/30"
          >
            <Wand2 size={14} />
            Set up deploy workflow
          </button>
        </div>
      )}

      {deployment.logs && (
        <details className="mt-4" open={isDeploying || undefined}>
          <summary className="cursor-pointer text-xs text-violet-400 hover:text-violet-300">
            View deployment logs
          </summary>

          <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-[#0b1020] p-3 text-xs text-gray-400">
            {deployment.logs}
          </pre>
        </details>
      )}

      <div className="mt-5 flex items-center justify-between border-t border-white/5 pt-4">
        <span className="text-xs text-gray-500">
          {deployment.created_at
            ? new Date(deployment.created_at).toLocaleString()
            : "Recently created"}
        </span>

        <div className="flex gap-2">
          {isDeploying && (
            <button
              onClick={() => onCancel(deployment.id)}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-400 transition hover:bg-red-500/20"
              title="Cancel deployment"
            >
              <Square size={13} />
              Cancel
            </button>
          )}

          <button
            onClick={() => onDelete(deployment.id)}
            className="rounded-lg border border-white/10 p-2 text-gray-400 transition hover:border-red-500/30 hover:text-red-400"
            title="Delete deployment"
          >
            <Trash2 size={16} />
          </button>

          <button
            onClick={() => onDeploy(deployment.id)}
            disabled={deploying || isDeploying}
            className="flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deploying || isDeploying ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Play size={14} />
            )}
            {deploying || isDeploying ? "Deploying..." : "Deploy"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Deployments() {
  const [deployments, setDeployments] = useState([]);
  const [pipelines, setPipelines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deployingIds, setDeployingIds] = useState([]);
  const [search, setSearch] = useState("");
  const [environmentFilter, setEnvironmentFilter] = useState("all");
  const [showModal, setShowModal] = useState(false);

  const [form, setForm] = useState(emptyForm);
  const [monitors, setMonitors] = useState([]);
  const [workflowStatus, setWorkflowStatus] = useState({});
  const [setupDeployment, setSetupDeployment] = useState(null);
  const lastStatus = useRef(null);

  const checkWorkflow = async (deploymentId) => {
    try {
      const { data } = await api.get(`deployments/${deploymentId}/workflow-status/`);
      setWorkflowStatus((prev) => ({ ...prev, [deploymentId]: data.exists }));
      return data.exists;
    } catch {
      return null;
    }
  };

  // Toast when the worker started an automatic deployment
  const announceAutoDeploys = (list) => {
    if (lastStatus.current) {
      list.forEach((d) => {
        const before = lastStatus.current[d.id];
        if (d.status === "deploying" && before && before !== "deploying" && d.trigger_source === "auto") {
          toast(`CI passed: deploying ${d.name} to ${d.environment}`, { icon: "🚀" });
        }
      });
    }
    lastStatus.current = Object.fromEntries(list.map((d) => [d.id, d.status]));
  };

  const fetchDeployments = async () => {
    try {
      const response = await api.get("deployments/");
      announceAutoDeploys(response.data);
      setDeployments(response.data);
    } catch (error) {
      toast.error("Failed to load deployments");
    } finally {
      setLoading(false);
    }
  };

  const fetchPipelines = async () => {
    try {
      const response = await api.get("pipelines/");
      setPipelines(response.data);
    } catch (error) {
      toast.error("Failed to load pipelines");
    }
  };

  useEffect(() => {
    const loadAll = async () => {
      try {
        const response = await api.get("deployments/");
        announceAutoDeploys(response.data);
        setDeployments(response.data);
        response.data.forEach((d) => checkWorkflow(d.id));
      } catch {
        toast.error("Failed to load deployments");
      } finally {
        setLoading(false);
      }
    };

    loadAll();
    fetchPipelines();
    api
      .get("monitors/")
      .then(({ data }) => setMonitors(Array.isArray(data) ? data : []))
      .catch(() => {});

    const timer = setInterval(fetchDeployments, BACKGROUND_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const handleToggleAuto = async (deployment) => {
    try {
      await api.patch(`deployments/${deployment.id}/`, {
        auto_deploy: !deployment.auto_deploy,
      });
      toast.success(
        deployment.auto_deploy
          ? `Auto-deploy off for ${deployment.name}`
          : `${deployment.name} will deploy automatically when CI passes`
      );
      fetchDeployments();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to change auto-deploy");
    }
  };

  // While any deployment is running, ask the backend to sync it with GitHub
  const activeIds = deployments
    .filter((d) => d.status === "deploying")
    .map((d) => d.id)
    .join(",");

  useEffect(() => {
    if (!activeIds) return;

    const timer = setInterval(async () => {
      await Promise.all(
        activeIds.split(",").map(async (id) => {
          try {
            const { data } = await api.get(`deployments/${id}/refresh/`);
            if (data.status === "success") {
              toast.success(`${data.name} deployed to ${data.environment}`);
            } else if (data.status === "failed") {
              toast.error(`${data.name} failed on ${data.environment}`);
            }
          } catch (error) {
            console.error("Deployment polling failed:", error);
          }
        })
      );
      await fetchDeployments();
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [activeIds]);

  const handleCreate = async (e) => {
    e.preventDefault();

    if (!form.name.trim() || !form.pipeline) {
      toast.error("Please enter a name and select a pipeline");
      return;
    }

    try {
      const { data: created } = await api.post("deployments/", {
        name: form.name.trim(),
        pipeline: Number(form.pipeline),
        environment: form.environment,
        workflow_file: form.workflow_file.trim() || "deploy.yml",
        auto_deploy: form.auto_deploy,
        health_monitor: form.health_monitor ? Number(form.health_monitor) : null,
      });

      toast.success("Deployment created successfully");
      setShowModal(false);
      setForm(emptyForm);
      await fetchDeployments();

      // Offer to add deploy.yml straight away if the repo doesn't have it
      const exists = await checkWorkflow(created.id);
      if (exists === false) setSetupDeployment(created);
    } catch (error) {
      const message = error.response?.data;
      toast.error(
        typeof message === "string"
          ? message
          : message?.pipeline?.[0] ||
            message?.workflow_file?.[0] ||
            message?.detail ||
            "Failed to create deployment"
      );
    }
  };

  const handleDeploy = async (deploymentId) => {
    setDeployingIds((prev) => [...prev, deploymentId]);

    try {
      await api.post(`deployments/${deploymentId}/deploy/`);
      toast.success("Deployment started on GitHub Actions");
      await fetchDeployments();
    } catch (error) {
      toast.error(
        error.response?.data?.detail || "Deployment failed"
      );
      await fetchDeployments();
    } finally {
      setDeployingIds((prev) =>
        prev.filter((id) => id !== deploymentId)
      );
    }
  };

  const handleCancel = async (deploymentId) => {
    try {
      await api.post(`deployments/${deploymentId}/cancel/`);
      toast.success("Deployment cancelled");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to cancel deployment");
    } finally {
      fetchDeployments();
    }
  };

  const handleDelete = async (deploymentId) => {
    if (!window.confirm("Are you sure you want to delete this deployment?")) {
      return;
    }

    try {
      await api.delete(`deployments/${deploymentId}/`);
      toast.success("Deployment deleted");
      fetchDeployments();
    } catch (error) {
      toast.error("Failed to delete deployment");
    }
  };

  const filteredDeployments = deployments.filter((deployment) => {
    const matchesSearch =
      deployment.name.toLowerCase().includes(search.toLowerCase()) ||
      deployment.repository.toLowerCase().includes(search.toLowerCase());

    const matchesEnvironment =
      environmentFilter === "all" ||
      deployment.environment === environmentFilter;

    return matchesSearch && matchesEnvironment;
  });

  const successCount = deployments.filter(
    (d) => d.status === "success"
  ).length;

  const failedCount = deployments.filter(
    (d) => d.status === "failed"
  ).length;

  const activeCount = deployments.filter(
    (d) => d.status === "deploying"
  ).length;

  const pendingCount = deployments.filter(
    (d) => d.status === "pending"
  ).length;

  const stats = [
    {
      label: "Total Deployments",
      value: deployments.length,
      icon: Rocket,
      color: "text-violet-400",
      bg: "bg-violet-500/10",
    },
    {
      label: "Successful",
      value: successCount,
      icon: CheckCircle2,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
    },
    {
      label: "Deploying",
      value: activeCount,
      icon: Clock,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
    },
    {
      label: "Failed",
      value: failedCount,
      icon: XCircle,
      color: "text-red-400",
      bg: "bg-red-500/10",
    },
  ];

  return (
    <div className="min-h-screen bg-[#0b1020] p-6 text-white md:p-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Deployments</h1>
          <p className="mt-2 text-gray-400">
            Turn on auto-deploy and every push that passes CI goes live by itself.
          </p>
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-3 font-medium text-white transition hover:bg-violet-500"
        >
          <Plus size={18} />
          New Deployment
        </button>
      </div>

      <AutomationBanner hasPipelines={pipelines.length > 0} />

      {/* Stats */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;

          return (
            <div
              key={stat.label}
              className="rounded-2xl border border-white/10 bg-[#121b30] p-5"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-400">{stat.label}</p>
                <div className={`rounded-xl p-2 ${stat.bg} ${stat.color}`}>
                  <Icon size={18} />
                </div>
              </div>

              <p className="mt-4 text-3xl font-bold">{stat.value}</p>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="mt-8 flex flex-col gap-3 md:flex-row">
        <div className="relative flex-1">
          <Search
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search deployments or repositories..."
            className="w-full rounded-xl border border-white/10 bg-[#121b30] py-3 pl-10 pr-4 text-sm text-white outline-none focus:border-violet-500"
          />
        </div>

        <select
          value={environmentFilter}
          onChange={(e) => setEnvironmentFilter(e.target.value)}
          className="rounded-xl border border-white/10 bg-[#121b30] px-4 py-3 text-sm text-white outline-none focus:border-violet-500"
        >
          {environments.map((env) => (
            <option key={env} value={env}>
              {env === "all"
                ? "All Environments"
                : env.charAt(0).toUpperCase() + env.slice(1)}
            </option>
          ))}
        </select>

        <button
          onClick={() => {
            setLoading(true);
            fetchDeployments();
          }}
          className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#121b30] px-4 py-3 text-gray-300 transition hover:bg-white/5"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {/* Deployment cards */}
      <div className="mt-6">
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin text-violet-400" size={32} />
          </div>
        ) : filteredDeployments.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-[#121b30]/50 py-16 text-center">
            <Rocket size={40} className="mx-auto text-gray-600" />
            <h3 className="mt-4 text-lg font-semibold text-white">
              No deployments found
            </h3>
            <p className="mt-2 text-sm text-gray-500">
              Create your first deployment to get started.
            </p>
            <button
              onClick={() => setShowModal(true)}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium hover:bg-violet-500"
            >
              <Plus size={16} />
              Create Deployment
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {filteredDeployments.map((deployment) => (
              <DeploymentCard
                key={deployment.id}
                deployment={deployment}
                onDeploy={handleDeploy}
                onCancel={handleCancel}
                onDelete={handleDelete}
                onToggleAuto={handleToggleAuto}
                onSetup={setSetupDeployment}
                workflowMissing={workflowStatus[deployment.id] === false}
                deploying={deployingIds.includes(deployment.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#121b30] p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">Create Deployment</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreate} className="mt-6 space-y-5">
              <div>
                <label className="mb-2 block text-sm text-gray-400">
                  Deployment Name
                </label>
                <input
                  value={form.name}
                  onChange={(e) =>
                    setForm({ ...form, name: e.target.value })
                  }
                  placeholder="e.g. Production Release v1"
                  required
                  className="w-full rounded-xl border border-white/10 bg-[#0b1020] px-4 py-3 text-white outline-none focus:border-violet-500"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-gray-400">
                  Pipeline
                </label>
                <select
                  value={form.pipeline}
                  onChange={(e) =>
                    setForm({ ...form, pipeline: e.target.value })
                  }
                  required
                  className="w-full rounded-xl border border-white/10 bg-[#0b1020] px-4 py-3 text-white outline-none focus:border-violet-500"
                >
                  <option value="">Select a pipeline</option>
                  {pipelines.map((pipeline) => (
                    <option key={pipeline.id} value={pipeline.id}>
                      {pipeline.name} — {pipeline.repository}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm text-gray-400">
                  Environment
                </label>
                <select
                  value={form.environment}
                  onChange={(e) =>
                    setForm({ ...form, environment: e.target.value })
                  }
                  className="w-full rounded-xl border border-white/10 bg-[#0b1020] px-4 py-3 text-white outline-none focus:border-violet-500"
                >
                  <option value="development">Development</option>
                  <option value="staging">Staging</option>
                  <option value="production">Production</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm text-gray-400">
                  Deploy Workflow File
                </label>
                <div className="flex items-center rounded-xl border border-white/10 bg-[#0b1020] focus-within:border-violet-500">
                  <span className="pl-4 text-sm text-gray-500">.github/workflows/</span>
                  <input
                    value={form.workflow_file}
                    onChange={(e) =>
                      setForm({ ...form, workflow_file: e.target.value })
                    }
                    placeholder="deploy.yml"
                    className="w-full bg-transparent px-1 py-3 text-white outline-none"
                  />
                </div>
                <p className="mt-1.5 text-xs text-gray-500">
                  Needs <code>on: workflow_dispatch</code> with an <code>environment</code> input.
                </p>
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-[#0b1020] p-4">
                <input
                  type="checkbox"
                  checked={form.auto_deploy}
                  onChange={(e) => setForm({ ...form, auto_deploy: e.target.checked })}
                  className="mt-1 h-4 w-4 accent-violet-600"
                />
                <span>
                  <span className="block text-sm font-medium text-white">
                    Deploy automatically when CI passes
                  </span>
                  <span className="mt-0.5 block text-xs text-gray-500">
                    Every push to the pipeline's branch that passes CI is deployed here,
                    no clicks needed.
                  </span>
                </span>
              </label>

              <div>
                <label className="mb-2 block text-sm text-gray-400">
                  Health check after deploy (optional)
                </label>
                <select
                  value={form.health_monitor}
                  onChange={(e) => setForm({ ...form, health_monitor: e.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-[#0b1020] px-4 py-3 text-white outline-none focus:border-violet-500"
                >
                  <option value="">No health check</option>
                  {monitors.map((monitor) => (
                    <option key={monitor.id} value={monitor.id}>
                      {monitor.name} — {monitor.url}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-gray-500">
                  After a successful deploy, this monitor is checked right away and you get
                  an alert if the site doesn't come back up.
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-xl border border-white/10 px-4 py-3 text-sm text-gray-300 hover:bg-white/5"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold hover:bg-violet-500"
                >
                  <Plus size={16} />
                  Create Deployment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {setupDeployment && (
        <WorkflowSetupModal
          pipeline={setupDeployment}
          basePath="deployments"
          onClose={() => setSetupDeployment(null)}
          onDone={() =>
            setWorkflowStatus((prev) => ({ ...prev, [setupDeployment.id]: true }))
          }
        />
      )}
    </div>
  );
}