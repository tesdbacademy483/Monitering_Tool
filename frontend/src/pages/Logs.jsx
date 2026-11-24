import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileText,
  KeyRound,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  ScrollText,
  Search,
  Server,
  XOctagon,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import api from "../services/api";
import LogSourcesModal from "../components/LogSourcesModal";

const LIVE_MS = 5000;
const LEVELS = ["debug", "info", "warning", "error", "critical"];
const RANGES = [
  { value: "15m", label: "Last 15 minutes" },
  { value: "1h", label: "Last hour" },
  { value: "6h", label: "Last 6 hours" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
];

const LEVEL_STYLE = {
  debug: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  info: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  warning: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  error: "bg-red-500/10 text-red-400 border-red-500/20",
  critical: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
};

const ROW_TINT = {
  error: "bg-red-500/[0.04]",
  critical: "bg-fuchsia-500/[0.06]",
};

const mono = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
};

function StatCard({ title, value, icon: Icon, color }) {
  const colors = {
    violet: "bg-violet-500/10 text-violet-400",
    red: "bg-red-500/10 text-red-400",
    yellow: "bg-yellow-500/10 text-yellow-400",
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
    </div>
  );
}

function LevelBadge({ level }) {
  return (
    <span
      className={`inline-flex w-[72px] justify-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold uppercase ${LEVEL_STYLE[level]}`}
    >
      {level}
    </span>
  );
}

function LogRow({ entry, open, onToggle }) {
  const time = new Date(entry.timestamp);
  const hasContext = entry.context && Object.keys(entry.context).length > 0;

  return (
    <div className={`border-b border-white/5 last:border-0 ${ROW_TINT[entry.level] || ""}`}>
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition hover:bg-white/[0.03]"
      >
        <span className="mt-0.5 text-gray-600">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span
          style={mono}
          title={time.toLocaleString()}
          className="mt-0.5 hidden w-[150px] shrink-0 text-xs text-gray-500 sm:block"
        >
          {time.toLocaleDateString(undefined, { month: "short", day: "2-digit" })}{" "}
          {time.toLocaleTimeString()}
        </span>
        <LevelBadge level={entry.level} />
        <span className="hidden w-32 shrink-0 truncate pt-0.5 text-xs text-violet-300 md:block">
          {entry.service || entry.source_name}
        </span>
        <span
          style={mono}
          className={`min-w-0 flex-1 pt-0.5 text-xs text-gray-200 ${open ? "whitespace-pre-wrap break-words" : "truncate"}`}
        >
          {entry.message}
        </span>
      </button>

      {open && (
        <div className="space-y-3 px-11 pb-4 text-xs">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-gray-400">
            <span>Source: <span className="text-gray-200">{entry.source_name}</span></span>
            {entry.service && <span>Service: <span className="text-gray-200">{entry.service}</span></span>}
            {entry.host && <span>Host: <span className="text-gray-200">{entry.host}</span></span>}
            <span>Time: <span className="text-gray-200">{time.toLocaleString()}</span></span>
          </div>
          {hasContext && (
            <pre
              style={mono}
              className="overflow-auto rounded-lg border border-white/10 bg-[#0b1020] p-3 text-gray-300"
            >
              {JSON.stringify(entry.context, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export default function Logs() {
  const [entries, setEntries] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [stats, setStats] = useState(null);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [live, setLive] = useState(true);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  // filters
  const [range, setRange] = useState("24h");
  const [levels, setLevels] = useState([]);
  const [sourceId, setSourceId] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  // debounce the search box
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const buildQuery = useCallback(
    (extra = {}) => {
      const params = new URLSearchParams({ since: range, ...extra });
      if (levels.length) params.set("level", levels.join(","));
      if (sourceId) params.set("source", sourceId);
      if (search) params.set("q", search);
      return params.toString();
    },
    [range, levels, sourceId, search]
  );

  const loadStats = useCallback(async () => {
    try {
      const params = new URLSearchParams({ since: range });
      if (sourceId) params.set("source", sourceId);
      const { data } = await api.get(`logs/stats/?${params}`);
      setStats(data);
    } catch {
      /* stats are optional */
    }
  }, [range, sourceId]);

  const loadSources = useCallback(async () => {
    try {
      const { data } = await api.get("logs/sources/");
      setSources(data);
    } catch {
      /* ignore */
    }
  }, []);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`logs/entries/?${buildQuery()}`);
      setEntries(data.results);
      setHasMore(data.has_more);
    } catch {
      toast.error("Unable to load logs");
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    loadEntries();
    loadStats();
  }, [loadEntries, loadStats]);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  // Live tail: fetch only logs newer than the newest one shown
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(async () => {
      const newest = entriesRef.current[0]?.id;
      try {
        const { data } = await api.get(
          `logs/entries/?${buildQuery(newest ? { after: String(newest) } : {})}`
        );
        if (data.results.length) {
          setEntries((prev) => {
            const seen = new Set(prev.map((e) => e.id));
            const fresh = data.results.filter((e) => !seen.has(e.id));
            return [...fresh, ...prev].slice(0, 1000);
          });
          loadStats();
        }
      } catch {
        /* try again next tick */
      }
    }, LIVE_MS);
    return () => clearInterval(timer);
  }, [live, buildQuery, loadStats]);

  const loadMore = async () => {
    const oldest = entries[entries.length - 1]?.id;
    if (!oldest) return;
    setLoadingMore(true);
    try {
      const { data } = await api.get(`logs/entries/?${buildQuery({ before: String(oldest) })}`);
      setEntries((prev) => [...prev, ...data.results]);
      setHasMore(data.has_more);
    } catch {
      toast.error("Unable to load older logs");
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleLevel = (level) =>
    setLevels((prev) => (prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]));

  const errorCount = stats ? stats.by_level.error + stats.by_level.critical : null;

  const chartData = (stats?.histogram || []).map((row) => {
    const date = new Date(row.bucket);
    return {
      label:
        range === "7d"
          ? date.toLocaleDateString(undefined, { month: "short", day: "2-digit" })
          : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      Errors: row.errors,
      Warnings: row.warnings,
      Other: row.other,
    };
  });

  const noSources = sources.length === 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold text-white">Logs</h1>
          <p className="mt-2 text-gray-400">Search and watch the logs your apps send.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setLive((v) => !v)}
            className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition ${
              live
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-white/10 bg-[#121b30] text-gray-300 hover:bg-white/5"
            }`}
          >
            {live ? <Pause size={16} /> : <Play size={16} />}
            {live ? "Live" : "Paused"}
          </button>
          <button
            onClick={() => {
              loadEntries();
              loadStats();
            }}
            title="Refresh"
            className="rounded-xl border border-white/10 bg-[#121b30] px-4 py-3 text-gray-300 transition hover:bg-white/5"
          >
            <RefreshCw size={17} />
          </button>
          <button
            onClick={() => setSourcesOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-3 font-semibold text-white transition hover:bg-violet-500"
          >
            <KeyRound size={18} />
            Log sources
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Log lines" value={stats?.total ?? "—"} icon={FileText} color="violet" />
        <StatCard title="Errors" value={errorCount ?? "—"} icon={XOctagon} color="red" />
        <StatCard title="Warnings" value={stats?.by_level.warning ?? "—"} icon={AlertTriangle} color="yellow" />
        <StatCard title="Sources" value={stats?.sources ?? sources.length} icon={Server} color="blue" />
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-[#121b30] p-5">
          <p className="mb-3 text-sm font-medium text-gray-300">
            Logs per {range === "7d" ? "day" : "hour"}
          </p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#293148" vertical={false} />
                <XAxis dataKey="label" stroke="#64748b" fontSize={11} minTickGap={20} />
                <YAxis stroke="#64748b" fontSize={11} allowDecimals={false} width={40} />
                <Tooltip
                  cursor={{ fill: "#ffffff08" }}
                  contentStyle={{ background: "#121b30", border: "1px solid #ffffff22", borderRadius: 8 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Other" stackId="a" fill="#3b82f6" />
                <Bar dataKey="Warnings" stackId="a" fill="#eab308" />
                <Bar dataKey="Errors" stackId="a" fill="#ef4444" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#121b30] p-4 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search messages, services, hosts..."
            className="w-full rounded-xl border border-white/10 bg-[#0b1020] py-2.5 pl-9 pr-3 text-sm text-white outline-none focus:border-violet-500"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {LEVELS.map((level) => (
            <button
              key={level}
              onClick={() => toggleLevel(level)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold uppercase transition ${
                levels.includes(level)
                  ? LEVEL_STYLE[level]
                  : "border-white/10 text-gray-500 hover:text-gray-300"
              }`}
            >
              {level}
            </button>
          ))}
        </div>

        <select
          value={sourceId}
          onChange={(e) => setSourceId(e.target.value)}
          className="rounded-xl border border-white/10 bg-[#0b1020] px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500"
        >
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          className="rounded-xl border border-white/10 bg-[#0b1020] px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500"
        >
          {RANGES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>

      {/* Log list */}
      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-[#121b30] py-16 text-gray-400">
          <Loader2 className="mr-2 animate-spin" size={20} />
          Loading logs...
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-[#121b30] px-6 py-16 text-center">
          <div className="mx-auto mb-4 w-fit rounded-2xl bg-violet-600/10 p-4 text-violet-400">
            <ScrollText size={30} />
          </div>
          {noSources ? (
            <>
              <h3 className="text-lg font-semibold text-white">Connect your first app</h3>
              <p className="mt-2 text-sm text-gray-400">
                Create a log source to get an API key and copy-paste code for Python, Node.js or curl.
              </p>
              <button
                onClick={() => setSourcesOpen(true)}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-3 font-semibold text-white transition hover:bg-violet-500"
              >
                <KeyRound size={18} />
                Create a log source
              </button>
            </>
          ) : (
            <>
              <h3 className="text-lg font-semibold text-white">No logs found</h3>
              <p className="mt-2 text-sm text-gray-400">
                Nothing matches these filters in this time range.
                {live && " New logs will appear here automatically."}
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#121b30]">
          {entries.map((entry) => (
            <LogRow
              key={entry.id}
              entry={entry}
              open={openId === entry.id}
              onToggle={() => setOpenId(openId === entry.id ? null : entry.id)}
            />
          ))}
          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="flex w-full items-center justify-center gap-2 border-t border-white/10 py-3 text-sm text-gray-300 transition hover:bg-white/5 disabled:opacity-50"
            >
              {loadingMore && <Loader2 size={15} className="animate-spin" />}
              Load older logs
            </button>
          )}
        </div>
      )}

      {sourcesOpen && (
        <LogSourcesModal
          onClose={() => setSourcesOpen(false)}
          onChanged={() => {
            loadSources();
            loadStats();
          }}
          startWithNew={noSources}
        />
      )}
    </div>
  );
}