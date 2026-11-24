import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  FolderKanban,
  GitBranch,
  Workflow,
  Rocket,
  Activity,
  ScrollText,
  Bell,
  ChartNoAxesCombined,
  UserRound,
  Settings,
  Workflow as Logo,
  X,
  LogOut,
} from "lucide-react";

import { useAuth } from "../context/AuthContext";

const links = [
  { name: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { name: "Projects", path: "/projects", icon: FolderKanban },
  { name: "Repositories", path: "/repositories", icon: GitBranch },
  { name: "Pipelines", path: "/pipelines", icon: Workflow },
  { name: "Deployments", path: "/deployments", icon: Rocket },
  { name: "Monitoring", path: "/monitoring", icon: Activity },
  { name: "Logs", path: "/logs", icon: ScrollText },
  { name: "Incidents", path: "/incidents", icon: Bell },
  { name: "Analytics", path: "/analytics", icon: ChartNoAxesCombined },
];

export default function Sidebar({ open, onClose }) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    onClose?.();
    navigate("/login", { replace: true });
  };

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-screen w-64 flex-col overflow-hidden border-r border-white/10 bg-[#10172a] p-5 transition-transform duration-300 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Sidebar Header */}
        <div className="mb-8 flex shrink-0 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-violet-600 p-3">
              <Logo size={24} />
            </div>

            <div>
              <h1 className="text-xl font-bold">DevOpsPilot</h1>
              <p className="text-xs text-gray-400">DevOps Automation</p>
            </div>
          </div>

          <button onClick={onClose} className="lg:hidden">
            <X />
          </button>
        </div>

        {/* Navigation - independently scrollable */}
        <p className="mb-4 shrink-0 text-xs font-semibold uppercase tracking-widest text-gray-500">
          Workspace
        </p>

        <nav className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {links.map(({ name, path, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition ${
                  isActive
                    ? "bg-violet-600 text-white shadow-lg shadow-violet-600/20"
                    : "text-gray-400 hover:bg-white/5 hover:text-white"
                }`
              }
            >
              <Icon size={19} />
              {name}
            </NavLink>
          ))}
        </nav>

        {/* Bottom Section - pinned to bottom */}
        <div className="mt-4 shrink-0 border-t border-white/10 pt-4">
          <NavLink
            to="/profile"
            onClick={onClose}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl p-3 transition ${
                isActive
                  ? "bg-violet-600 text-white"
                  : "text-gray-400 hover:bg-white/5 hover:text-white"
              }`
            }
          >
            <UserRound size={20} />
            My Profile
          </NavLink>

          <NavLink
            to="/settings"
            onClick={onClose}
            className={({ isActive }) =>
              `mt-2 flex items-center gap-3 rounded-xl p-3 transition ${
                isActive
                  ? "bg-violet-600 text-white"
                  : "text-gray-400 hover:bg-white/5 hover:text-white"
              }`
            }
          >
            <Settings size={20} />
            Settings
          </NavLink>

          {/* Logout Button */}
          <button
            onClick={handleLogout}
            className="mt-2 flex w-full items-center gap-3 rounded-xl p-3 text-red-400 transition hover:bg-red-500/10 hover:text-red-300"
          >
            <LogOut size={20} />
            Logout
          </button>
        </div>
      </aside>
    </>
  );
}