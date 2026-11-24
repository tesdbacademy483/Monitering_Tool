import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-hot-toast";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileCode2,
  GitBranch,
  Loader2,
  Wand2,
  X,
} from "lucide-react";
import api from "../services/api";

/**
 * Detects the repo's stack, shows a generated GitHub Actions workflow,
 * lets the user edit it, and commits it to the repo.
 */
export default function WorkflowSetupModal({ pipeline, onClose, onDone }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const bodyRef = useRef(null);

  useEffect(() => {
    if (error) bodyRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [error]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const { data } = await api.get(`pipelines/${pipeline.id}/workflow-preview/`);
        if (cancelled) return;
        setPreview(data);
        setContent(data.content);
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.detail || "Unable to read the repository.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [pipeline.id]);

  const handleCommit = async () => {
    setSaving(true);
    setError("");

    try {
      const { data } = await api.post(`pipelines/${pipeline.id}/setup-workflow/`, {
        content,
      });
      setResult(data);
      toast.success("Workflow added to the repository");
      onDone?.();
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to create the workflow file.");
    } finally {
      setSaving(false);
    }
  };

  const needsReconnect = error.toLowerCase().includes("disconnect");

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
      onClick={() => !saving && onClose()}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-white/10 bg-[#121b30] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-white/10 p-6">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-violet-500/10 p-2.5 text-violet-400">
              <Wand2 size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Set up workflow</h2>
              <p className="mt-1 text-sm text-gray-400">
                DevopsPilot will add a GitHub Actions workflow to{" "}
                <span className="text-gray-200">{pipeline.repository}</span>.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-lg p-2 text-gray-400 hover:bg-white/5 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
              <Loader2 size={18} className="animate-spin" />
              Reading the repository and detecting the project type...
            </div>
          ) : result ? (
            <div className="py-10 text-center">
              <div className="mx-auto mb-4 w-fit rounded-2xl bg-emerald-500/10 p-4 text-emerald-400">
                <CheckCircle2 size={32} />
              </div>
              <h3 className="text-lg font-semibold text-white">Workflow added</h3>
              <p className="mt-2 text-sm text-gray-400">
                <code>{preview?.path}</code> was committed to <code>{preview?.branch}</code>.
                You can click <span className="text-white">Run</span> on this pipeline now.
              </p>
              {result.html_url && (
                <a
                  href={result.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex items-center gap-1.5 text-sm text-violet-400 hover:text-violet-300"
                >
                  <ExternalLink size={14} />
                  View file on GitHub
                </a>
              )}
            </div>
          ) : !preview ? (
            <ErrorBox error={error} needsReconnect={needsReconnect} />
          ) : (
            <div className="space-y-5">
              {error && <ErrorBox error={error} needsReconnect={needsReconnect} />}

              <div className="flex flex-wrap items-center gap-4 text-sm text-gray-400">
                <span className="flex items-center gap-1.5">
                  <FileCode2 size={15} className="text-violet-400" />
                  {preview.path}
                </span>
                <span className="flex items-center gap-1.5">
                  <GitBranch size={15} className="text-violet-400" />
                  {preview.branch}
                </span>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
                  Detected
                </p>
                {preview.detected.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {preview.detected.map((item) => (
                      <span
                        key={item}
                        className="rounded-lg border border-violet-500/20 bg-violet-500/10 px-2.5 py-1.5 text-xs font-medium text-violet-300"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-yellow-400">
                    No known project type found. A basic workflow was generated. Add your
                    own build commands below.
                  </p>
                )}
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
                  Workflow (you can edit it)
                </p>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  spellCheck={false}
                  rows={18}
                  style={{
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
                  }}
                  className="w-full resize-y rounded-xl border border-white/10 bg-[#0b1020] p-4 font-mono text-xs leading-relaxed text-gray-200 outline-none focus:border-violet-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-white/10 p-5">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-white/10 px-4 py-3 text-sm text-gray-300 transition hover:bg-white/5 disabled:opacity-50"
          >
            {result ? "Close" : "Cancel"}
          </button>
          {!result && preview && (
            <button
              onClick={handleCommit}
              disabled={saving || !content.trim()}
              className="flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
              {saving ? "Committing..." : "Commit to repository"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ErrorBox({ error, needsReconnect }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <div>
        <p>{error}</p>
        {needsReconnect && (
          <Link
            to="/profile"
            className="mt-2 inline-block font-medium text-white underline underline-offset-2"
          >
            Go to Profile
          </Link>
        )}
      </div>
    </div>
  );
}