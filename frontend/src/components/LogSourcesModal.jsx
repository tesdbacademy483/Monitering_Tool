import { useCallback, useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import api from "../services/api";

const INGEST_URL = `${api.defaults.baseURL.replace(/\/$/, "")}/logs/ingest/`;

const SNIPPETS = {
  curl: {
    label: "curl",
    code: (key) => `curl -X POST ${INGEST_URL} \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"level": "error", "message": "Something broke", "service": "api"}'`,
  },
  powershell: {
    label: "PowerShell",
    code: (key) => `Invoke-RestMethod -Method Post -Uri "${INGEST_URL}" \`
  -Headers @{ Authorization = "Bearer ${key}" } \`
  -ContentType "application/json" \`
  -Body '{"level": "error", "message": "Something broke", "service": "api"}'`,
  },
  python: {
    label: "Python",
    code: (
      key,
    ) => `# Works with Django, Flask, FastAPI or any Python app (pip install requests)
import logging
import requests


class DevOpsPilotHandler(logging.Handler):
    def __init__(self, url, api_key, service=""):
        super().__init__()
        self.url = url
        self.service = service
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {api_key}"

    def emit(self, record):
        # Skip the HTTP library's own logs to avoid a loop
        if record.name.startswith(("urllib3", "requests")):
            return
        try:
            self.session.post(self.url, json={
                "level": record.levelname,
                "message": self.format(record),
                "service": self.service or record.name,
                "timestamp": record.created,
            }, timeout=3)
        except Exception:
            pass  # never crash the app because logging failed


handler = DevOpsPilotHandler(
    "${INGEST_URL}",
    "${key}",
    service="my-app",
)
handler.setLevel(logging.INFO)
logging.getLogger().addHandler(handler)
logging.getLogger().setLevel(logging.INFO)

logging.info("App started")
logging.error("Payment failed for order 42")`,
  },
  node: {
    label: "Node.js",
    code: (key) => `// Node 18+ (built-in fetch)
async function sendLog(level, message, context = {}) {
  try {
    await fetch("${INGEST_URL}", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer ${key}",
      },
      body: JSON.stringify({ level, message, context, service: "my-app" }),
    });
  } catch {
    // never crash the app because logging failed
  }
}

sendLog("info", "Server started");
sendLog("error", "Payment failed", { orderId: 42 });`,
  },
};

function CopyButton({ text, label = "Copy" }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed. Select the text and press Ctrl+C.");
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-gray-300 transition hover:bg-white/10"
    >
      {copied ? (
        <Check size={13} className="text-emerald-400" />
      ) : (
        <Copy size={13} />
      )}
      {copied ? "Copied" : label}
    </button>
  );
}

const monoStyle = {
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
};

function KeyReveal({ source, apiKey, onDone }) {
  const [tab, setTab] = useState("python");
  const code = SNIPPETS[tab].code(apiKey);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
        <p className="text-sm font-semibold text-emerald-300">
          API key for "{source.name}"
        </p>
        <div className="mt-3 flex items-center gap-2">
          <code
            style={monoStyle}
            className="flex-1 break-all rounded-lg bg-[#0b1020] px-3 py-2 text-xs text-white"
          >
            {apiKey}
          </code>
          <CopyButton text={apiKey} />
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-xs text-yellow-200">
          <AlertTriangle size={14} className="mt-px shrink-0" />
          Copy it now. For security it is only shown once. Keep it out of Git
          (put it in your app's .env file).
        </p>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          Send your first log
        </p>
        <div className="mb-2 flex flex-wrap gap-2">
          {Object.entries(SNIPPETS).map(([key, snippet]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                tab === key
                  ? "bg-violet-600 text-white"
                  : "bg-white/5 text-gray-400 hover:text-white"
              }`}
            >
              {snippet.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <pre
            style={monoStyle}
            className="max-h-72 overflow-auto rounded-xl border border-white/10 bg-[#0b1020] p-4 pt-12 text-xs leading-relaxed text-gray-200"
          >
            {code}
          </pre>
          <div className="absolute right-3 top-3">
            <CopyButton text={code} />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={onDone}
          className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500"
        >
          I've saved the key
        </button>
      </div>
    </div>
  );
}

function SourceRow({ source, onChanged, onNewKey }) {
  const [busy, setBusy] = useState(false);
  const [threshold, setThreshold] = useState(source.error_threshold);
  const [windowMinutes, setWindowMinutes] = useState(
    source.error_window_minutes,
  );

  const patch = async (data, message) => {
    setBusy(true);
    try {
      await api.patch(`logs/sources/${source.id}/`, data);
      if (message) toast.success(message);
      onChanged();
    } catch (error) {
      const first = Object.values(error.response?.data || {}).flat()[0];
      toast.error(typeof first === "string" ? first : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    if (
      !window.confirm(
        `Create a new key for "${source.name}"? The old key stops working immediately.`,
      )
    )
      return;
    setBusy(true);
    try {
      const { data } = await api.post(
        `logs/sources/${source.id}/regenerate-key/`,
      );
      onNewKey(data);
    } catch {
      toast.error("Could not regenerate the key");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${source.name}" and all of its logs?`)) return;
    setBusy(true);
    try {
      await api.delete(`logs/sources/${source.id}/`);
      toast.success("Log source deleted");
      onChanged();
    } catch {
      toast.error("Delete failed");
      setBusy(false);
    }
  };

  const alertsChanged =
    Number(threshold) !== source.error_threshold ||
    Number(windowMinutes) !== source.error_window_minutes;

  return (
    <div className="rounded-xl border border-white/10 bg-[#0b1020] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-white">
            {source.name}
            {!source.is_active && (
              <span className="ml-2 rounded-full bg-gray-500/20 px-2 py-0.5 text-xs text-gray-400">
                disabled
              </span>
            )}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
            <KeyRound size={12} />
            <span style={monoStyle}>{source.key_prefix}…</span>
            <span>·</span>
            {source.logs_24h} logs / {source.errors_24h} errors (24h)
            <span>·</span>
            {source.last_used_at
              ? `last log ${new Date(source.last_used_at).toLocaleString()}`
              : "no logs yet"}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() =>
              patch(
                { is_active: !source.is_active },
                source.is_active ? "Source disabled" : "Source enabled",
              )
            }
            disabled={busy}
            className="rounded-lg px-2.5 py-1.5 text-xs text-gray-300 transition hover:bg-white/5 disabled:opacity-40"
          >
            {source.is_active ? "Disable" : "Enable"}
          </button>
          <button
            onClick={regenerate}
            disabled={busy}
            title="New API key"
            className="rounded-lg p-2 text-gray-400 transition hover:bg-white/5 hover:text-white disabled:opacity-40"
          >
            <RotateCw size={15} />
          </button>
          <button
            onClick={remove}
            disabled={busy}
            title="Delete"
            className="rounded-lg p-2 text-gray-500 transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/5 pt-3 text-xs text-gray-400">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={source.alert_on_errors}
            onChange={(e) => patch({ alert_on_errors: e.target.checked })}
            disabled={busy}
            className="accent-violet-500"
          />
          Alert when
        </label>
        <input
          type="number"
          min={1}
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          disabled={!source.alert_on_errors}
          className="w-16 rounded-md border border-white/10 bg-[#121b30] px-2 py-1 text-white disabled:opacity-40"
        />
        errors in
        <input
          type="number"
          min={1}
          max={60}
          value={windowMinutes}
          onChange={(e) => setWindowMinutes(e.target.value)}
          disabled={!source.alert_on_errors}
          className="w-14 rounded-md border border-white/10 bg-[#121b30] px-2 py-1 text-white disabled:opacity-40"
        />
        minutes
        {alertsChanged && (
          <button
            onClick={() =>
              patch(
                {
                  error_threshold: Number(threshold),
                  error_window_minutes: Number(windowMinutes),
                },
                "Alert rule saved",
              )
            }
            disabled={busy}
            className="ml-1 rounded-md bg-violet-600 px-2.5 py-1 font-medium text-white hover:bg-violet-500"
          >
            Save
          </button>
        )}
      </div>
    </div>
  );
}

export default function LogSourcesModal({
  onClose,
  onChanged,
  startWithNew = false,
}) {
  const [sources, setSources] = useState(null);
  const [projects, setProjects] = useState([]);
  const [creating, setCreating] = useState(startWithNew);
  const [form, setForm] = useState({ name: "", project: "" });
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState(null); // { source, apiKey }

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("logs/sources/");
      setSources(data);
    } catch {
      toast.error("Unable to load log sources");
    }
  }, []);

  useEffect(() => {
    load();
    api
      .get("projects/")
      .then(({ data }) => setProjects(data))
      .catch(() => {});
  }, [load]);

  const changed = () => {
    load();
    onChanged?.();
  };

  const create = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.post("logs/sources/", {
        name: form.name.trim(),
        project: form.project || null,
      });
      setRevealed({ source: data, apiKey: data.api_key });
      setCreating(false);
      setForm({ name: "", project: "" });
      changed();
    } catch (error) {
      const first = Object.values(error.response?.data || {}).flat()[0];
      toast.error(
        typeof first === "string" ? first : "Could not create the source",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
      onClick={() => !revealed && onClose()}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-white/10 bg-[#121b30] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-white/10 p-6">
          <div>
            <h2 className="text-xl font-bold text-white">Log sources</h2>
            <p className="mt-1 text-sm text-gray-400">
              Each app gets its own API key to send logs to DevOpsPilot.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 hover:bg-white/5 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {revealed ? (
            <KeyReveal
              source={revealed.source}
              apiKey={revealed.apiKey}
              onDone={() => setRevealed(null)}
            />
          ) : (
            <>
              {creating ? (
                <form
                  onSubmit={create}
                  className="space-y-3 rounded-xl border border-violet-500/30 bg-violet-500/5 p-4"
                >
                  <input
                    autoFocus
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="App name, e.g. Expenses API"
                    required
                    className="w-full rounded-lg border border-white/10 bg-[#0b1020] px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500"
                  />
                  <select
                    value={form.project}
                    onChange={(e) =>
                      setForm({ ...form, project: e.target.value })
                    }
                    className="w-full rounded-lg border border-white/10 bg-[#0b1020] px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500"
                  >
                    <option value="">No project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setCreating(false)}
                      className="rounded-lg px-4 py-2 text-sm text-gray-300 hover:bg-white/5"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={saving || !form.name.trim()}
                      className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
                    >
                      {saving && <Loader2 size={14} className="animate-spin" />}
                      Create & get API key
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={() => setCreating(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 py-3 text-sm text-gray-300 transition hover:border-violet-500/50 hover:text-white"
                >
                  <Plus size={16} />
                  New log source
                </button>
              )}

              {sources === null ? (
                <div className="flex justify-center py-8 text-gray-400">
                  <Loader2 className="animate-spin" />
                </div>
              ) : sources.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-500">
                  No log sources yet.
                </p>
              ) : (
                sources.map((source) => (
                  <SourceRow
                    key={source.id}
                    source={source}
                    onChanged={changed}
                    onNewKey={(data) =>
                      setRevealed({ source: data, apiKey: data.api_key })
                    }
                  />
                ))
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
