import { useEffect, useState } from "react";
import { Zap, AlertTriangle } from "lucide-react";
import api from "../services/api";

const REFRESH_MS = 30000;

/**
 * Shows whether push-to-deploy automation is live.
 * Automation runs in the background worker (python manage.py run_monitors);
 * if it isn't running, pushes won't be picked up until someone opens the page.
 */
export default function AutomationBanner({ hasPipelines = true }) {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const { data } = await api.get("pipelines/automation-status/");
        if (!cancelled) setStatus(data);
      } catch {
        // not critical: hide the banner
      }
    };

    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!status || !hasPipelines) return null;

  if (!status.worker_running) {
    return (
      <div className="mt-6 flex items-start gap-3 rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-4 text-sm text-yellow-200">
        <AlertTriangle size={18} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">Automation is paused: the background worker isn't running</p>
          <p className="mt-1 text-yellow-200/80">
            Pushes to GitHub are only picked up while it runs. Start it in a second terminal:{" "}
            <code className="rounded bg-black/30 px-1.5 py-0.5">python manage.py run_monitors</code>
          </p>
        </div>
      </div>
    );
  }

  const last = status.last_synced_at
    ? new Date(status.last_synced_at).toLocaleTimeString()
    : "never";

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">
      <Zap size={18} className="shrink-0" />
      <span className="font-semibold">Automation on</span>
      <span className="text-emerald-200/80">
        git push → CI → auto-deploy → health check. Checking GitHub every{" "}
        {status.poll_interval_seconds}s
        {status.webhook_available ? " + instant webhooks" : ""} · last check {last}
      </span>
    </div>
  );
}