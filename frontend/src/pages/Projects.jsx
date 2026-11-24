
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { Plus, FolderKanban, Trash2, X } from "lucide-react";
import api from "../services/api";
import ProjectCard from "../components/ProjectCard";

export default function Projects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const fetchProjects = async () => {
    try {
      const response = await api.get("projects/");
      setProjects(response.data.results || response.data);
    } catch {
      toast.error("Unable to load projects");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const createProject = async (e) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error("Project name is required");
      return;
    }

    try {
      await api.post("projects/", { name, description });
      toast.success("Project created successfully!");
      setName("");
      setDescription("");
      setShowForm(false);
      fetchProjects();
    } catch (error) {
      toast.error(
        error.response?.data?.detail || "Project creation failed"
      );
    }
  };

  const deleteProject = async (id) => {
    if (!window.confirm("Are you sure you want to delete this project?")) return;

    try {
      await api.delete(`projects/${id}/`);
      toast.success("Project deleted");
      fetchProjects();
    } catch {
      toast.error("Unable to delete project");
    }
  };

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Projects</h1>
          <p className="mt-2 text-sm text-gray-400">
            Manage all your DevOps projects.
          </p>
        </div>

        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-3 text-sm hover:bg-violet-500"
        >
          <Plus size={18} /> Create Project
        </button>
      </div>

      {showForm && (
        <form onSubmit={createProject} className="mb-8 max-w-xl space-y-4 rounded-2xl border border-white/10 bg-[#121b30] p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">New Project</h2>
            <button type="button" onClick={() => setShowForm(false)}>
              <X />
            </button>
          </div>

          <input
            className="w-full rounded-xl border border-white/10 bg-[#0b1020] p-3 outline-none focus:border-violet-500"
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <textarea
            className="w-full rounded-xl border border-white/10 bg-[#0b1020] p-3 outline-none focus:border-violet-500"
            placeholder="Project description"
            rows="4"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <button className="rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold hover:bg-violet-500">
            Create Project
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-gray-400">Loading projects...</p>
      ) : projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center">
          <FolderKanban className="mx-auto mb-4 text-violet-400" size={40} />
          <h3 className="font-semibold">No projects found</h3>
          <p className="mt-2 text-sm text-gray-400">
            Create your first project to get started.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <div key={project.id} className="relative">
              <ProjectCard project={project} />
              <button
                onClick={() => deleteProject(project.id)}
                className="absolute right-5 top-5 rounded-lg p-2 text-red-400 hover:bg-red-500/10"
                title="Delete project"
              >
                <Trash2 size={17} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
