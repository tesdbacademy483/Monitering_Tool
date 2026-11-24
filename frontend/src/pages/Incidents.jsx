import { useCallback, useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import {
  Activity,
  AlertOctagon,
  BellRing,
  CheckCircle2,
  Clock,
  Eye,
  Globe,
  Loader2,
  Mail,
  MessageSquare,
  RefreshCw,
  Rocket,
  ScrollText,
  Send,
  Settings2,
  ShieldCheck,
  Timer,
  Workflow,
  X,
  XCircle,
} from "lucide-react";
import api from "../services/api";

const POLL_MS = 15000;

const TABS = [
  { key: "active", label: "Active" },
  { key: "resolved", label: "Resolved" },
  { key: "all", label: "All" },
];

const SEVERITY = {
  critical: "bg-red-500/10 text-red-400 border-red-500/20",
  warning: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  info: "bg-blue-500/10 text-blue-400 border-blue-500/20",
};

const STATUS = {
  open: { label: "Open", className: "bg-red-500/10 text-red-400 border-red-500/20", dot: "bg-red-500" },
  acknowledged: {
    label: "Acknowledged",
    className: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    dot: "bg-yellow-400",
  },
  resolved: {
    label: "Resolved",
    className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    dot: "bg-emerald-400",
  },
};

const SOURCE_ICON = {
  monitor: Globe,
  deployment: Rocket,
  pipeline: Workflow,
  logs: ScrollText,
  manual: AlertOctagon,
};

const EVENT_STYLE = {
  opened: { icon: AlertOctagon, color: "text-red-400 bg-red-500/10" },
  alert_sent: { icon: Mail, color: "text-violet-400 bg-violet-500/10" },
  alert_failed: { icon: XCircle, color: "text-red-400 bg-red-500/10" },
  acknowledged: { icon: Eye, color: "text-yellow-400 bg-yellow-500/10" },
  resolved: { icon: CheckCircle2, color: "text-emerald-400 bg-emerald-500/10" },
  reopened: { icon: AlertOctagon, color: "text-red-400 bg-red-500/10" },
  note: { icon: MessageSquare, color: "text-blue-400 bg-blue-500/10" },
};

// ---------- helpers ----------

function formatDuration(seconds) {
  if (seconds == null) return "—";
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function formatTime(iso) {
  return iso ? new Date(iso).toLocaleString() : "—";
}

function timeAgo(iso) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  return `${formatDuration(seconds).split(" ")[0]} ago`;
}

// ---------- small components ----------

function Badge({ className, children }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${className}`}>
      {children}
    </span>
  );
}

function SummaryCard({ title, value, icon: Icon, color }) {
  const colors = {
    red: "bg-red-500/10 text-red-400",
    yellow: "bg-yellow-500/10 text-yellow-400",
    green: "bg-emerald-500/10 text-emerald-400",
    violet: "bg-violet-500/10 text-violet-400",
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
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block text-sm text-gray-200">{label}</span>
        {hint && <span className="block text-xs text-gray-500">{hint}</span>}
      </span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${
          checked ? "bg-violet-600" : "bg-white/10"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </label>
  );
}

// ---------- detail drawer ----------

function IncidentDetail({ incidentId, onClose, onChanged }) {
  const [incident, setIncident] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`incidents/${incidentId}/`);
      setIncident(data);
    } catch {
      toast.error("Unable to load incident");
    }
  }, [incidentId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const act = async (action, body) => {
    setBusy(true);
    try {
      const { data } = await api.post(`incidents/${incidentId}/${action}/`, body);
      setIncident(data);
      onChanged();
      return true;
    } catch (error) {
      toast.error(error.response?.data?.detail || "Action failed");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addNote = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    if (await act("note", { message: note.trim() })) setNote("");
  };

  const SourceIcon = incident ? SOURCE_ICON[incident.source] || AlertOctagon : AlertOctagon;
  const related =
    incident?.monitor_name ||
    incident?.deployment_name ||
    incident?.pipeline_name ||
    incident?.log_source_name ||
    null;

  return (
    <div className="fixed inset-0 z-[100] flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-xl flex-col border-l border-white/10 bg-[#0f172a]"
        onClick={(e) => e.stopPropagation()}
      >
        {!incident ? (
          <div className="flex flex-1 items-center justify-center text-gray-400">
            <Loader2 className="animate-spin" />
          </div>
        ) : (
          <>
            <div className="border-b border-white/10 p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="rounded-xl bg-white/5 p-2.5 text-gray-300">
                    <SourceIcon size={20} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold text-white">{incident.title}</h2>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge className={STATUS[incident.status].className}>
                        {STATUS[incident.status].label}
                      </Badge>
                      <Badge className={SEVERITY[incident.severity]}>{incident.severity}</Badge>
                      <Badge className="border-white/10 bg-white/5 text-gray-300">{incident.source}</Badge>
                    </div>
                  </div>
                </div>
                <button onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-white/5 hover:text-white">
                  <X size={20} />
                </button>
              </div>

              {incident.description && (
                <p className="mt-4 text-sm leading-relaxed text-gray-400">{incident.description}</p>
              )}

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-[#121b30] p-3">
                  <p className="text-xs text-gray-500">Started</p>
                  <p className="mt-1 text-gray-200">{formatTime(incident.started_at)}</p>
                </div>
                <div className="rounded-xl bg-[#121b30] p-3">
                  <p className="text-xs text-gray-500">
                    {incident.status === "resolved" ? "Duration" : "Ongoing for"}
                  </p>
                  <p className="mt-1 text-gray-200">{formatDuration(incident.duration_seconds)}</p>
                </div>
                {related && (
                  <div className="col-span-2 rounded-xl bg-[#121b30] p-3">
                    <p className="text-xs capitalize text-gray-500">{incident.source}</p>
                    <p className="mt-1 text-gray-200">{related}</p>
                  </div>
                )}
              </div>

              {incident.status !== "resolved" && (
                <div className="mt-4 flex gap-3">
                  {incident.status === "open" && (
                    <button
                      onClick={() => act("acknowledge")}
                      disabled={busy}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-yellow-500/20 bg-yellow-500/10 py-2.5 text-sm font-semibold text-yellow-300 transition hover:bg-yellow-500/20 disabled:opacity-50"
                    >
                      <Eye size={16} />
                      Acknowledge
                    </button>
                  )}
                  <button
                    onClick={() => act("resolve")}
                    disabled={busy}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                  >
                    <CheckCircle2 size={16} />
                    Resolve
                  </button>
                </div>
              )}
            </div>

            {/* Timeline */}
            <div className="flex-1 overflow-y-auto p-6">
              <p className="mb-4 text-xs font-medium uppercase tracking-wider text-gray-500">Timeline</p>
              <ol className="relative space-y-5 border-l border-white/10 pl-6">
                {incident.events.map((event) => {
                  const style = EVENT_STYLE[event.kind] || EVENT_STYLE.note;
                  const Icon = style.icon;
                  return (
                    <li key={event.id} className="relative">
                      <span
                        className={`absolute -left-[37px] flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-[#0f172a] ${style.color}`}
                      >
                        <Icon size={14} />
                      </span>
                      <p className="text-sm capitalize text-gray-200">{event.kind.replace("_", " ")}</p>
                      {event.message && (
                        <p className="mt-0.5 break-words text-sm text-gray-400">{event.message}</p>
                      )}
                      <p className="mt-1 text-xs text-gray-500">{formatTime(event.created_at)}</p>
                    </li>
                  );
                })}
              </ol>
            </div>

            <form onSubmit={addNote} className="flex gap-2 border-t border-white/10 p-4">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add a note (what you found, what you did)..."
                className="flex-1 rounded-xl border border-white/10 bg-[#0b1020] px-4 py-2.5 text-sm text-white outline-none focus:border-violet-500"
              />
              <button
                type="submit"
                disabled={busy || !note.trim()}
                className="rounded-xl bg-violet-600 px-4 text-white transition hover:bg-violet-500 disabled:opacity-40"
              >
                <Send size={16} />
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- alert settings ----------

function AlertSettingsModal({ onClose }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api
      .get("incidents/settings/")
      .then(({ data }) => setForm(data))
      .catch(() => toast.error("Unable to load alert settings"));
  }, []);

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const save = async (showToast = true) => {
    setSaving(true);
    try {
      const { data } = await api.put("incidents/settings/", {
        email_enabled: form.email_enabled,
        email: form.email.trim(),
        notify_monitor_down: form.notify_monitor_down,
        notify_deployment_failed: form.notify_deployment_failed,
        notify_pipeline_failed: form.notify_pipeline_failed,
        notify_log_errors: form.notify_log_errors,
        notify_recovery: form.notify_recovery,
        monitor_failure_threshold: Number(form.monitor_failure_threshold),
      });
      setForm(data);
      if (showToast) toast.success("Alert settings saved");
      return true;
    } catch (error) {
      const data = error.response?.data || {};
      const first = Object.values(data).flat()[0];
      toast.error(typeof first === "string" ? first : "Unable to save settings");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    if (!(await save(false))) return;
    setTesting(true);
    try {
      const { data } = await api.post("incidents/settings/test-email/");
      toast.success(data.detail);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Test email failed", { duration: 8000 });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
      onClick={() => !saving && onClose()}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#121b30] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">Alert settings</h2>
            <p className="mt-1 text-sm text-gray-400">Where and when DevOpsPilot emails you.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-white/5 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {!form ? (
          <div className="flex justify-center py-10 text-gray-400">
            <Loader2 className="animate-spin" />
          </div>
        ) : (
          <div className="space-y-5">
            {!form.email_configured && (
              <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs leading-relaxed text-yellow-200">
                Gmail isn't configured on the server yet, so emails are only printed in the
                backend terminal. Add <code>GMAIL_ADDRESS</code> and <code>GMAIL_APP_PASSWORD</code> to{" "}
                <code>backend/.env</code> and restart the server.
              </div>
            )}

            <div className="rounded-xl border border-white/10 bg-[#0b1020] p-4">
              <Toggle
                checked={form.email_enabled}
                onChange={(v) => update("email_enabled", v)}
                label="Email alerts"
              />
              <label className="mt-2 block text-xs text-gray-500">Send alerts to</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                placeholder={form.account_email || "you@example.com"}
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#121b30] px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500"
              />
              <p className="mt-1.5 text-xs text-gray-500">
                Leave empty to use your account email
                {form.account_email ? ` (${form.account_email})` : ""}.
              </p>
            </div>

            <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-[#0b1020] px-4">
              <Toggle
                checked={form.notify_monitor_down}
                onChange={(v) => update("notify_monitor_down", v)}
                label="Monitor goes down"
              />
              <Toggle
                checked={form.notify_deployment_failed}
                onChange={(v) => update("notify_deployment_failed", v)}
                label="Deployment fails"
              />
              <Toggle
                checked={form.notify_pipeline_failed}
                onChange={(v) => update("notify_pipeline_failed", v)}
                label="Pipeline fails"
              />
              <Toggle
                checked={form.notify_log_errors}
                onChange={(v) => update("notify_log_errors", v)}
                label="Error spike in logs"
              />
              <Toggle
                checked={form.notify_recovery}
                onChange={(v) => update("notify_recovery", v)}
                label="Recovery messages"
                hint="Email again when things are working again"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-gray-300">
                Open a monitor incident after
              </label>
              <select
                value={form.monitor_failure_threshold}
                onChange={(e) => update("monitor_failure_threshold", e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-[#0b1020] p-3 text-sm text-white outline-none focus:border-violet-500"
              >
                {[1, 2, 3, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} failed check{n > 1 ? "s" : ""} in a row
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-gray-500">
                2 or more avoids alerts for one-off network blips.
              </p>
            </div>

            <div className="flex flex-wrap justify-between gap-3 pt-2">
              <button
                onClick={sendTest}
                disabled={saving || testing}
                className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm text-gray-200 transition hover:bg-white/5 disabled:opacity-50"
              >
                {testing ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                Send test email
              </button>
              <button
                onClick={() => save().then((ok) => ok && onClose())}
                disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
              >
                {saving && <Loader2 size={16} className="animate-spin" />}
                Save
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- page ----------

export default function Incidents() {
  const [tab, setTab] = useState("active");
  const [incidents, setIncidents] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const query = tab === "all" ? "" : `?status=${tab}`;
      const [list, sum] = await Promise.all([
        api.get(`incidents/${query}`),
        api.get("incidents/summary/"),
      ]);
      setIncidents(list.data);
      setSummary(sum.data);
    } catch (error) {
      console.error(error);
      toast.error("Unable to load incidents");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    setLoading(true);
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const activeCount = summary ? summary.open + summary.acknowledged : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold text-white">Incidents</h1>
          <p className="mt-2 text-gray-400">
            Outages and failures, with alerts sent to your email.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={load}
            title="Refresh"
            className="rounded-xl border border-white/10 bg-[#121b30] px-4 py-3 text-gray-300 transition hover:bg-white/5"
          >
            <RefreshCw size={17} />
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-3 font-semibold text-white transition hover:bg-violet-500"
          >
            <Settings2 size={18} />
            Alert settings
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="Open" value={summary?.open ?? "—"} icon={BellRing} color="red" />
        <SummaryCard title="Acknowledged" value={summary?.acknowledged ?? "—"} icon={Eye} color="yellow" />
        <SummaryCard title="Resolved (7 days)" value={summary?.resolved_7d ?? "—"} icon={ShieldCheck} color="green" />
        <SummaryCard
          title="Avg. time to resolve (30d)"
          value={summary?.mttr_display ?? "—"}
          icon={Timer}
          color="violet"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
              tab === t.key
                ? "bg-violet-600 text-white"
                : "border border-white/10 bg-[#121b30] text-gray-400 hover:text-white"
            }`}
          >
            {t.label}
            {t.key === "active" && activeCount > 0 && (
              <span className="ml-2 rounded-full bg-red-500 px-1.5 py-0.5 text-xs text-white">{activeCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-[#121b30] py-16 text-gray-400">
          <Loader2 className="mr-2 animate-spin" size={20} />
          Loading incidents...
        </div>
      ) : incidents.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-[#121b30] px-6 py-16 text-center">
          <div className="mx-auto mb-4 w-fit rounded-2xl bg-emerald-500/10 p-4 text-emerald-400">
            <ShieldCheck size={30} />
          </div>
          <h3 className="text-lg font-semibold text-white">
            {tab === "active" ? "All systems normal" : "No incidents yet"}
          </h3>
          <p className="mt-2 text-sm text-gray-400">
            Incidents open automatically when a monitor goes down, a deployment or pipeline
            fails, or an app logs a burst of errors.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#121b30]">
          {incidents.map((incident) => {
            const Icon = SOURCE_ICON[incident.source] || Activity;
            const status = STATUS[incident.status];
            return (
              <button
                key={incident.id}
                onClick={() => setSelectedId(incident.id)}
                className="flex w-full flex-col gap-3 border-b border-white/5 px-5 py-4 text-left transition last:border-0 hover:bg-white/[0.03] md:flex-row md:items-center md:gap-4"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${status.dot}`} />
                  <div className="rounded-lg bg-white/5 p-2 text-gray-400">
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{incident.title}</p>
                    <p className="truncate text-xs text-gray-500">{incident.description}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={SEVERITY[incident.severity]}>{incident.severity}</Badge>
                  <Badge className={status.className}>{status.label}</Badge>
                </div>

                <div className="flex items-center gap-1.5 text-xs text-gray-500 md:w-40 md:justify-end">
                  <Clock size={13} />
                  {incident.status === "resolved"
                    ? `lasted ${formatDuration(incident.duration_seconds)}`
                    : `started ${timeAgo(incident.started_at)}`}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedId && (
        <IncidentDetail
          incidentId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={load}
        />
      )}

      {settingsOpen && <AlertSettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}