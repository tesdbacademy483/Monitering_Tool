
import { useEffect, useState } from "react";
import {
  FolderKanban,
  Rocket,
  CheckCircle2,
  AlertCircle,
  Activity,
  GitBranch,
  Star,
  Lock,
  Globe,
} from "lucide-react";

import api from "../services/api";
import StatCard from "../components/StatCard";
import { Link } from "react-router-dom";

export default function Dashboard() {
  const [repositories, setRepositories] = useState([]);
  const [repoLoading, setRepoLoading] = useState(true);
  const [repoError, setRepoError] = useState("");

  // Fetch GitHub repositories
  useEffect(() => {
    api
      .get("github/repositories/")
      .then((response) => {
        const data = response.data.results || response.data;
        setRepositories(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        console.error("GitHub repositories error:", err);
        setRepoError(
          err.response?.data?.detail || "Could not load GitHub repositories."
        );
      })
      .finally(() => setRepoLoading(false));
  }, []);

  const publicRepos = repositories.filter((repo) => !repo.private).length;
  const privateRepos = repositories.filter((repo) => repo.private).length;

  const sortedRepositories = [...repositories].sort(
    (a, b) =>
      new Date(b.updated_at || 0) - new Date(a.updated_at || 0)
  );

  const stats = [
    {
      title: "Total Projects",
      value: repoLoading ? "..." : repositories.length,
      change: "GitHub repositories",
      icon: FolderKanban,
      color: "violet",
    },
    {
      title: "Successful Builds",
      value: "--",
      change: "Connect pipeline API",
      icon: CheckCircle2,
      color: "green",
    },
    {
      title: "Deployments",
      value: "--",
      change: "Connect deployment API",
      icon: Rocket,
      color: "blue",
    },
    {
      title: "Failed Builds",
      value: "--",
      change: "Connect pipeline API",
      icon: AlertCircle,
      color: "red",
    },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Welcome back!</h1>
          <p className="mt-2 text-sm text-gray-400">
            Here's what's happening with your GitHub projects today.
          </p>
        </div>

        <Link
          to="/repositories"
          className="flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold hover:bg-violet-500"
        >
          <GitBranch size={18} />
          View Repositories
        </Link>
      </div>

      {/* Dashboard Stats */}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.title} {...stat} />
        ))}
      </div>

      {/* GitHub Overview */}
      <div className="mt-8 rounded-2xl border border-white/10 bg-[#121b30] p-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <GitBranch className="text-violet-400" size={24} />
            <div>
              <h2 className="text-lg font-semibold">GitHub Overview</h2>
              <p className="text-sm text-gray-400">
                Your connected GitHub repositories
              </p>
            </div>
          </div>

          <Link
            to="/repositories"
            className="text-sm text-violet-400 hover:text-violet-300"
          >
            View all repositories →
          </Link>
        </div>

        {repoLoading ? (
          <p className="text-gray-400">Loading GitHub repositories...</p>
        ) : repoError ? (
          <p className="text-sm text-red-400">{repoError}</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            {/* Total Repositories */}
            <div className="rounded-xl border border-white/10 bg-[#0b1224] p-5">
              <GitBranch size={20} className="text-violet-400" />
              <p className="mt-3 text-sm text-gray-400">
                Total Repositories
              </p>
              <p className="mt-1 text-2xl font-bold">
                {repositories.length}
              </p>
            </div>

            {/* Public Repositories */}
            <div className="rounded-xl border border-white/10 bg-[#0b1224] p-5">
              <Globe size={20} className="text-blue-400" />
              <p className="mt-3 text-sm text-gray-400">
                Public Repositories
              </p>
              <p className="mt-1 text-2xl font-bold">{publicRepos}</p>
            </div>

            {/* Private Repositories */}
            <div className="rounded-xl border border-white/10 bg-[#0b1224] p-5">
              <Lock size={20} className="text-amber-400" />
              <p className="mt-3 text-sm text-gray-400">
                Private Repositories
              </p>
              <p className="mt-1 text-2xl font-bold">{privateRepos}</p>
            </div>
          </div>
        )}
      </div>

      {/* Build Activity and Quick Actions */}
      <div className="mt-8 grid gap-6 xl:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-[#121b30] p-6 xl:col-span-2">
          <div className="flex items-center gap-3">
            <Activity className="text-violet-400" />
            <h2 className="text-lg font-semibold">Build Activity</h2>
          </div>

          <div className="mt-8 flex h-48 items-center justify-center rounded-xl bg-white/[0.02] text-sm text-gray-500">
            Pipeline analytics will appear here.
          </div>
        </div>

        {/* Quick Actions */}
        <div className="rounded-2xl border border-white/10 bg-[#121b30] p-6">
          <h2 className="text-lg font-semibold">Quick Actions</h2>

          <div className="mt-5 space-y-3">
            <Link
              to="/repositories"
              className="block rounded-xl border border-white/10 p-4 text-sm hover:bg-violet-500/10"
            >
              Browse GitHub Repositories
            </Link>

            <Link
              to="/pipelines"
              className="block rounded-xl border border-white/10 p-4 text-sm hover:bg-violet-500/10"
            >
              View Pipelines
            </Link>

            <Link
              to="/deployments"
              className="block rounded-xl border border-white/10 p-4 text-sm hover:bg-violet-500/10"
            >
              Check Deployments
            </Link>
          </div>
        </div>
      </div>

      {/* All GitHub Projects */}
      <div className="mt-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-xl font-semibold">All GitHub Projects</h2>

          <Link
            to="/repositories"
            className="text-sm text-violet-400 hover:text-violet-300"
          >
            Manage repositories →
          </Link>
        </div>

        {repoLoading ? (
          <p className="text-gray-400">Loading GitHub projects...</p>
        ) : repoError ? (
          <p className="text-red-400">{repoError}</p>
        ) : repositories.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center">
            <GitBranch
              className="mx-auto mb-3 text-violet-400"
              size={35}
            />
            <p className="font-medium">No GitHub repositories found</p>
            <p className="mt-2 text-sm text-gray-500">
              Connect your GitHub account to see your projects here.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {sortedRepositories.map((repo) => (
              <a
                key={repo.id}
                href={repo.html_url}
                target="_blank"
                rel="noreferrer"
                className="rounded-2xl border border-white/10 bg-[#121b30] p-6 transition hover:border-violet-500/40 hover:bg-violet-500/5"
              >
                {/* Repository Name */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <GitBranch
                      className="shrink-0 text-violet-400"
                      size={20}
                    />
                    <h3 className="break-all font-semibold">
                      {repo.name}
                    </h3>
                  </div>

                  <span className="shrink-0 rounded-full border border-white/10 px-2 py-1 text-xs text-gray-400">
                    {repo.private ? "Private" : "Public"}
                  </span>
                </div>

                {/* Description */}
                <p className="mt-3 min-h-[40px] line-clamp-2 text-sm text-gray-400">
                  {repo.description || "No description provided."}
                </p>

                {/* Repository Information */}
                <div className="mt-5 flex flex-wrap items-center gap-4 text-xs text-gray-500">
                  {repo.language && <span>{repo.language}</span>}

                  <span className="flex items-center gap-1">
                    <Star size={13} />
                    {repo.stargazers_count ?? 0}
                  </span>

                  <span>Forks: {repo.forks_count ?? 0}</span>
                </div>

                {/* Last Updated */}
                <p className="mt-4 text-xs text-gray-500">
                  Updated:{" "}
                  {repo.updated_at
                    ? new Date(repo.updated_at).toLocaleDateString()
                    : "Unknown"}
                </p>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
  