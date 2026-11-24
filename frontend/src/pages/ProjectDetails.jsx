
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { toast } from "react-hot-toast";
import { ArrowLeft, FolderKanban } from "lucide-react";
import api from "../services/api";

export default function ProjectDetails() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`projects/${id}/`)
      .then((res) => setProject(res.data))
      .catch(() => toast.error("Could not load project"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p className="text-gray-400">Loading project...</p>;

  if (!project) return <p className="text-gray-400">Project not found.</p>;

  return (
    <div>
      <Link to="/projects" className="mb-6 inline-flex items-center gap-2 text-violet-400">
        <ArrowLeft size={18} /> Back to Projects
      </Link>

      <div className="rounded-2xl border border-white/10 bg-[#121b30] p-8">
        <FolderKanban size={40} className="mb-5 text-violet-400" />
        <h1 className="text-3xl font-bold">{project.name}</h1>
        <p className="mt-4 text-gray-400">
          {project.description || "No description provided."}
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl bg-white/5 p-4">
            <p className="text-sm text-gray-400">Project owner</p>
            <p className="mt-2 font-medium">{project.owner}</p>
          </div>
          <div className="rounded-xl bg-white/5 p-4">
            <p className="text-sm text-gray-400">Created at</p>
            <p className="mt-2 font-medium">
              {new Date(project.created_at).toLocaleDateString()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
