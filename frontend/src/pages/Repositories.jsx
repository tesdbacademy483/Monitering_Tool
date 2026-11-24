import { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import api from "../services/api";

export default function Repositories() {
  const [repositories, setRepositories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchRepositories = async () => {
      try {
        const response = await api.get("github/repositories/");
        setRepositories(response.data);
      } catch (err) {
        console.error("Failed to fetch repositories:", err);
        setError(
          err.response?.data?.detail || "Failed to load repositories."
        );
      } finally {
        setLoading(false);
      }
    };

    fetchRepositories();
  }, []);

  return (
    <div>
      <h1 className="text-3xl font-bold">Repositories</h1>

      <p className="mt-2 text-gray-400">
        Manage your GitHub repositories connected to DevOpsPilot.
      </p>

      <div className="mt-8 rounded-2xl border border-white/10 bg-[#121b30] p-8">
        <div className="flex items-center gap-3">
          <GitBranch size={24} className="text-violet-400" />
          <h2 className="text-xl font-semibold">Your Repositories</h2>
        </div>

        {loading && (
          <p className="mt-6 text-gray-400">Loading repositories...</p>
        )}

        {error && (
          <p className="mt-6 text-red-400">{error}</p>
        )}

        {!loading && !error && repositories.length === 0 && (
          <p className="mt-6 text-gray-400">
            No repositories found on your GitHub account.
          </p>
        )}

        {!loading && !error && repositories.length > 0 && (
          <div className="mt-6 space-y-3">
            {repositories.map((repo) => (
              <div
                key={repo.id}
                className="rounded-xl border border-white/10 bg-[#0b1224] p-5"
              >
                <div className="flex items-center justify-between gap-4">
                  <a
                    href={repo.html_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-lg font-semibold text-violet-400 hover:text-violet-300"
                  >
                    {repo.name}
                  </a>

                  <span className="text-xs text-gray-500">
                    {repo.private ? "Private" : "Public"}
                  </span>
                </div>

                <p className="mt-2 text-sm text-gray-400">
                  {repo.description || "No description provided."}
                </p>

                <div className="mt-4 flex flex-wrap gap-4 text-sm text-gray-500">
                  {repo.language && <span>{repo.language}</span>}
                  <span>⭐ {repo.stargazers_count}</span>
                  <span>Forks: {repo.forks_count}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}