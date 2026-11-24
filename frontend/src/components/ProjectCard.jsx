
import { FolderKanban, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";

export default function ProjectCard({ project }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#121b30] p-5 transition hover:border-violet-500/50">
      <div className="mb-4 flex items-center justify-between">
        <div className="rounded-xl bg-violet-500/10 p-3 text-violet-400">
          <FolderKanban size={23} />
        </div>

        <ArrowUpRight size={19} className="text-gray-500" />
      </div>

      <h3 className="text-lg font-semibold">{project.name}</h3>

      <p className="mt-2 min-h-10 text-sm text-gray-400">
        {project.description || "No description available"}
      </p>

      <div className="mt-5 flex items-center justify-between">
        <span className="text-xs text-gray-500">
          Created {project.created_at
            ? new Date(project.created_at).toLocaleDateString()
            : "Recently"}
        </span>

        <Link
          to={`/projects/${project.id}`}
          className="text-sm font-medium text-violet-400 hover:text-violet-300"
        >
          View project
        </Link>
      </div>
    </div>
  );
}
