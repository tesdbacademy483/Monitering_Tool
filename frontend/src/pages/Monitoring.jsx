import { useCallback, useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import {
  Activity,
  ArrowDownCircle,
  ArrowUpCircle,
  Clock,
  Gauge,
  Globe,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import api from "../services/api";

const POLL_MS = 15000;

const INTERVALS = [
  { value: 30, label: "Every 30 seconds" },
  { value: 60, label: "Every 1 minute" },
  { value: 300, label: "Every 5 minutes" },
  { value: 900, label: "Every 15 minutes" },
  { value: 1800, label: "Every 30 minutes" },
  { value: 3600, label: "Every 1 hour" },
];

const emptyForm = {
  name: "",
  url: "https://",
  method: "GET",
  interval_seconds: 60,
  timeout_seconds: 10,
  expected_status: 200,
  keyword: "",
  project: "",
};

const STATUS = {
  up: { label: "Up", dot: "bg-emerald-400", text: "text-emerald-400", badge: "bg-emerald-500/10 border-emerald-500/20" },
  down: { label: "Down", dot: "bg-red-500", text: "text-red-400", badge: "bg-red-500/10 border-red-500/20" },
  paused: { label: "Paused", dot: "bg-gray-500", text: "text-gray-400", badge: "bg-gray-500/10 border-gray-500/20" },
  pending: { label: "Pending", dot: "bg-yellow-400", text: "text-yellow-400", badge: "bg-yellow-500/10 border-yellow-500/20" },
};

// ---------- helpers ----------

function timeAgo(iso) {
  if (!iso) return "never";
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function intervalLabel(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${seconds / 60}m`;
  return `${seconds / 3600}h`;
}

function uptimeColor(value) {
  if (value === null || value === undefined) return "text-gray-500";
  if (value >= 99) return "text-emerald-400";
  if (value >= 95) return "text-yellow-400";
  return "text-red-400";
}

function formatUptime(value) {
  return value === null || value === undefined ? "—" : `${value}%`;
}

// ---------- small components ----------

function StatusDot({ status }) {
  const s = STATUS[status] || STATUS.pending;
  return (
    <span className="relative flex h-3 w-3 shrink-0">
      {(status === "up" || status === "down") && (
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${s.dot}`} />
      )}
      <span className={`relative inline-flex h-3 w-3 rounded-full ${s.dot}`} />
    </span>
  );
}

function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${s.badge} ${s.text}`}>
      {s.label}
    </span>
  );
}

function SummaryCard({ title, value, sub, icon: Icon, color }) {
  const colors = {
    violet: "bg-violet-500/10 text-violet-400",
    green: "bg-emerald-500/10 text-emerald-400",
    red: "bg-red-500/10 text-red-400",
    blue: "bg-blue-500/10 text-blue-400",
  };
  return (
    <div className="rounded-2xl border border-white/10 bg-[#121b30] p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">{title}</p>
        <div className={`rounded-xl p-2.5 ${colors[color]}`}>
          <Icon size={20} />
        </div>
      </div>
      <p className="mt-4 text-3xl font-bold text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

// Coloured bar strip of the latest checks (newest on the right)
function CheckBars({ checks }) {
  const latest = [...checks].slice(0, 60).reverse();
  if (latest.length === 0) {
    return <p className="text-xs text-gray-500">No checks yet.</p>;
  }
  return (
    <div className="flex h-8 items-end gap-[3px]">
      {latest.map((c) => (
        <div
          key={c.id}
          title={`${new Date(c.checked_at).toLocaleTimeString()} · ${
            c.is_up ? `UP ${c.response_time_ms}ms` : `DOWN ${c.error}`
          }`}
          className={`h-full flex-1 rounded-sm ${c.is_up ? "bg-emerald-500/80" : "bg-red-500/80"}`}
        />
      ))}
    </div>
  );
}

// ---------- detail panel ----------

function MonitorDetail({ monitor, onClose }) {
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`monitors/${monitor.id}/checks/?hours=24`);
      setChecks(data);
    } catch {
      toast.error("Unable to load check history");
    } finally {
      setLoading(false);
    }
  }, [monitor.id]);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const chartData = [...checks]
    .reverse()
    .map((c) => ({
      time: new Date(c.checked_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      ms: c.is_up ? c.response_time_ms : null,
    }));

  const failures = checks.filter((c) => !c.is_up).slice(0, 10);

  return (
    <div
      className="fixed inset-0 z-[100] flex justify-end bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-2xl overflow-y-auto border-l border-white/10 bg-[#0f172a] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <StatusDot status={monitor.status} />
              <h2 className="truncate text-xl font-bold text-white">{monitor.name}</h2>
              <StatusBadge status={monitor.status} />
            </div>
            <a
              href={monitor.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block truncate text-sm text-violet-400 hover:underline"
            >
              {monitor.url}
            </a>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-white/5 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-white/10 bg-[#121b30] p-4">
            <p className="text-xs text-gray-500">Uptime (24h)</p>
            <p className={`mt-1 text-2xl font-bold ${uptimeColor(monitor.uptime_24h)}`}>
              {formatUptime(monitor.uptime_24h)}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#121b30] p-4">
            <p className="text-xs text-gray-500">Avg response (24h)</p>
            <p className="mt-1 text-2xl font-bold text-white">
              {monitor.avg_response_24h ? `${Math.round(monitor.avg_response_24h)}ms` : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#121b30] p-4">
            <p className="text-xs text-gray-500">Checks (24h)</p>
            <p className="mt-1 text-2xl font-bold text-white">{monitor.checks_24h}</p>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-white/10 bg-[#121b30] p-4">
          <p className="mb-3 text-sm font-medium text-gray-300">Recent checks</p>
          <CheckBars checks={checks} />
        </div>

        <div className="mt-6 rounded-xl border border-white/10 bg-[#121b30] p-4">
          <p className="mb-3 text-sm font-medium text-gray-300">Response time (last 24h)</p>
          {loading ? (
            <div className="flex h-56 items-center justify-center text-gray-400">
              <Loader2 className="animate-spin" />
            </div>
          ) : chartData.length === 0 ? (
            <p className="py-16 text-center text-sm text-gray-500">No data yet.</p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#293148" />
                  <XAxis dataKey="time" stroke="#64748b" fontSize={11} minTickGap={30} />
                  <YAxis stroke="#64748b" fontSize={11} unit="ms" width={60} />
                  <Tooltip
                    contentStyle={{ background: "#121b30", border: "1px solid #ffffff22", borderRadius: 8 }}
                    formatter={(v) => [`${v} ms`, "Response"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="ms"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="mt-6 rounded-xl border border-white/10 bg-[#121b30] p-4">
          <p className="mb-3 text-sm font-medium text-gray-300">Recent failures</p>
          {failures.length === 0 ? (
            <p className="text-sm text-emerald-400">No failures in the last 24 hours 🎉</p>
          ) : (
            <ul className="space-y-2">
              {failures.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-3 rounded-lg bg-red-500/5 p-3 text-sm">
                  <span className="text-red-300">{c.error || `HTTP ${c.status_code}`}</span>
                  <span className="shrink-0 text-xs text-gray-500">
                    {new Date(c.checked_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 text-sm text-gray-400">
          <p>Method: <span className="text-gray-200">{monitor.method}</span></p>
          <p>Interval: <span className="text-gray-200">{intervalLabel(monitor.interval_seconds)}</span></p>
          <p>Expected status: <span className="text-gray-200">{monitor.expected_status}</span></p>
          <p>Timeout: <span className="text-gray-200">{monitor.timeout_seconds}s</span></p>
          {monitor.keyword && (
            <p className="col-span-2">Keyword: <span className="text-gray-200">{monitor.keyword}</span></p>
          )}
          {monitor.project_name && (
            <p className="col-span-2">Project: <span className="text-gray-200">{monitor.project_name}</span></p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- page ----------

export default function Monitoring() {
  const [monitors, setMonitors] = useState([]);
  const [summary, setSummary] = useState(null);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [selected, setSelected] = useState(null);
  const [busyIds, setBusyIds] = useState([]);

  const load = useCallback(async () => {
    try {
      const [list, sum] = await Promise.all([
        api.get("monitors/"),
        api.get("monitors/summary/"),
      ]);
      setMonitors(list.data);
      setSummary(sum.data);
      // keep the open detail panel in sync
      setSelected((current) => (current ? list.data.find((m) => m.id === current.id) || null : null));
    } catch (error) {
      console.error(error);
      toast.error("Unable to load monitors");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const openModal = async () => {
    setForm(emptyForm);
    setModalOpen(true);
    try {
      const { data } = await api.get("projects/");
      setProjects(data);
    } catch {
      setProjects([]);
    }
  };

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        url: form.url.trim(),
        keyword: form.keyword.trim(),
        interval_seconds: Number(form.interval_seconds),
        timeout_seconds: Number(form.timeout_seconds),
        expected_status: Number(form.expected_status),
        project: form.project || null,
      };
      const { data } = await api.post("monitors/", payload);
      toast.success(`${data.name} added`);
      setModalOpen(false);
      await load();
    } catch (error) {
      const data = error.response?.data || {};
      const firstError = Object.values(data).flat()[0];
      toast.error(typeof firstError === "string" ? firstError : "Failed to add monitor");
    } finally {
      setSaving(false);
    }
  };

  const withBusy = async (id, fn) => {
    setBusyIds((prev) => [...prev, id]);
    try {
      await fn();
      await load();
    } finally {
      setBusyIds((prev) => prev.filter((x) => x !== id));
    }
  };

  const checkNow = (m) =>
    withBusy(m.id, async () => {
      try {
        const { data } = await api.post(`monitors/${m.id}/check-now/`);
        if (data.is_up) toast.success(`${m.name} is up (${data.response_time_ms}ms)`);
        else toast.error(`${m.name} is down: ${data.error}`);
      } catch {
        toast.error("Check failed");
      }
    });

  const togglePause = (m) =>
    withBusy(m.id, async () => {
      try {
        await api.post(`monitors/${m.id}/${m.is_active ? "pause" : "resume"}/`);
        toast.success(m.is_active ? `${m.name} paused` : `${m.name} resumed`);
      } catch {
        toast.error("Action failed");
      }
    });

  const remove = (m) => {
    if (!window.confirm(`Delete monitor "${m.name}" and its history?`)) return;
    withBusy(m.id, async () => {
      try {
        await api.delete(`monitors/${m.id}/`);
        toast.success("Monitor deleted");
      } catch {
        toast.error("Delete failed");
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold text-white">Uptime Monitoring</h1>
          <p className="mt-2 text-gray-400">
            Know the moment your websites and APIs go down.
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={load}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#121b30] px-4 py-3 text-gray-300 transition hover:bg-white/5"
            title="Refresh"
          >
            <RefreshCw size={17} />
          </button>
          <button
            onClick={openModal}
            className="flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-3 font-semibold text-white transition hover:bg-violet-500"
          >
            <Plus size={18} />
            Add Monitor
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Monitors"
          value={summary?.total ?? "—"}
          sub={summary ? `${summary.paused} paused` : ""}
          icon={Globe}
          color="violet"
        />
        <SummaryCard
          title="Up"
          value={summary?.up ?? "—"}
          icon={ArrowUpCircle}
          color="green"
        />
        <SummaryCard
          title="Down"
          value={summary?.down ?? "—"}
          icon={ArrowDownCircle}
          color="red"
        />
        <SummaryCard
          title="Uptime (24h)"
          value={formatUptime(summary?.uptime_24h)}
          sub={summary?.avg_response_24h ? `Avg response ${summary.avg_response_24h}ms` : ""}
          icon={Gauge}
          color="blue"
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-[#121b30] py-16 text-gray-400">
          <Loader2 className="mr-2 animate-spin" size={20} />
          Loading monitors...
        </div>
      ) : monitors.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-[#121b30] px-6 py-16 text-center">
          <div className="mx-auto mb-4 w-fit rounded-2xl bg-violet-600/10 p-4 text-violet-400">
            <Activity size={30} />
          </div>
          <h3 className="text-lg font-semibold text-white">No monitors yet</h3>
          <p className="mt-2 text-sm text-gray-400">
            Add a website or API URL and DevOpsPilot will check it on a schedule.
          </p>
          <button
            onClick={openModal}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-3 font-semibold text-white transition hover:bg-violet-500"
          >
            <Plus size={18} />
            Add your first monitor
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#121b30]">
          <div className="hidden grid-cols-12 gap-4 border-b border-white/10 px-5 py-3 text-xs font-medium uppercase tracking-wider text-gray-500 md:grid">
            <div className="col-span-5">Monitor</div>
            <div className="col-span-2">Uptime 24h</div>
            <div className="col-span-2">Response</div>
            <div className="col-span-1">Checked</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>

          {monitors.map((m) => {
            const busy = busyIds.includes(m.id);
            return (
              <div
                key={m.id}
                onClick={() => setSelected(m)}
                className="grid cursor-pointer grid-cols-1 gap-3 border-b border-white/5 px-5 py-4 transition last:border-0 hover:bg-white/[0.03] md:grid-cols-12 md:items-center md:gap-4"
              >
                <div className="flex min-w-0 items-center gap-3 md:col-span-5">
                  <StatusDot status={m.status} />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{m.name}</p>
                    <p className="truncate text-xs text-gray-500">
                      {m.method} {m.url} · every {intervalLabel(m.interval_seconds)}
                    </p>
                    {m.status === "down" && m.last_error && (
                      <p className="mt-0.5 truncate text-xs text-red-400">{m.last_error}</p>
                    )}
                  </div>
                </div>

                <div className={`text-sm font-semibold md:col-span-2 ${uptimeColor(m.uptime_24h)}`}>
                  <span className="mr-2 text-xs font-normal text-gray-500 md:hidden">Uptime</span>
                  {formatUptime(m.uptime_24h)}
                </div>

                <div className="flex items-center gap-1.5 text-sm text-gray-300 md:col-span-2">
                  <Zap size={14} className="text-violet-400" />
                  {m.last_response_ms != null && m.status === "up" ? `${m.last_response_ms}ms` : "—"}
                </div>

                <div className="flex items-center gap-1.5 text-xs text-gray-500 md:col-span-1">
                  <Clock size={13} />
                  {timeAgo(m.last_checked_at)}
                </div>

                <div
                  className="flex items-center gap-1 md:col-span-2 md:justify-end"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => checkNow(m)}
                    disabled={busy || !m.is_active}
                    title="Check now"
                    className="rounded-lg p-2 text-gray-400 transition hover:bg-violet-500/10 hover:text-violet-400 disabled:opacity-40"
                  >
                    {busy ? <Loader2 size={17} className="animate-spin" /> : <RefreshCw size={17} />}
                  </button>
                  <button
                    onClick={() => togglePause(m)}
                    disabled={busy}
                    title={m.is_active ? "Pause" : "Resume"}
                    className="rounded-lg p-2 text-gray-400 transition hover:bg-white/5 hover:text-white disabled:opacity-40"
                  >
                    {m.is_active ? <Pause size={17} /> : <Play size={17} />}
                  </button>
                  <button
                    onClick={() => remove(m)}
                    disabled={busy}
                    title="Delete"
                    className="rounded-lg p-2 text-gray-500 transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-gray-500">
        Checks run in the background worker (<code>python manage.py run_monitors</code>).
        This page refreshes every 15 seconds.
      </p>

      {/* Detail panel */}
      {selected && <MonitorDetail monitor={selected} onClose={() => setSelected(null)} />}

      {/* Add modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => !saving && setModalOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#121b30] p-6 shadow-2xl sm:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">Add Monitor</h2>
                <p className="mt-1 text-sm text-gray-400">We'll check this URL on a schedule.</p>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                disabled={saving}
                className="rounded-lg p-2 text-gray-400 hover:bg-white/5 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <Field label="Name">
                <input
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  placeholder="e.g. Company website"
                  required
                  className={inputClass}
                />
              </Field>

              <Field label="URL">
                <input
                  type="url"
                  value={form.url}
                  onChange={(e) => update("url", e.target.value)}
                  placeholder="https://example.com/health"
                  required
                  className={inputClass}
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Check every">
                  <select
                    value={form.interval_seconds}
                    onChange={(e) => update("interval_seconds", e.target.value)}
                    className={inputClass}
                  >
                    {INTERVALS.map((i) => (
                      <option key={i.value} value={i.value}>{i.label}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Method">
                  <select
                    value={form.method}
                    onChange={(e) => update("method", e.target.value)}
                    className={inputClass}
                  >
                    <option value="GET">GET</option>
                    <option value="HEAD">HEAD</option>
                  </select>
                </Field>

                <Field label="Expected status">
                  <input
                    type="number"
                    min={100}
                    max={599}
                    value={form.expected_status}
                    onChange={(e) => update("expected_status", e.target.value)}
                    className={inputClass}
                  />
                </Field>

                <Field label="Timeout (seconds)">
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={form.timeout_seconds}
                    onChange={(e) => update("timeout_seconds", e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </div>

              <Field label="Keyword (optional)" hint="Mark as down if this text is missing from the page.">
                <input
                  value={form.keyword}
                  onChange={(e) => update("keyword", e.target.value)}
                  placeholder='e.g. "ok"'
                  className={inputClass}
                />
              </Field>

              <Field label="Project (optional)">
                <select
                  value={form.project}
                  onChange={(e) => update("project", e.target.value)}
                  className={inputClass}
                >
                  <option value="">No project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </Field>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  disabled={saving}
                  className="rounded-xl border border-white/10 px-4 py-3 text-gray-300 transition hover:bg-white/5 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-3 font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
                >
                  {saving && <Loader2 size={17} className="animate-spin" />}
                  {saving ? "Checking..." : "Add Monitor"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-[#0b1020] p-3 text-white outline-none transition focus:border-violet-500";

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-gray-300">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}