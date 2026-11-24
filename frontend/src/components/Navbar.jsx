
import { Menu, Bell, Search } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function Navbar({ onMenuClick }) {
  const { user } = useAuth();

  return (
    <header className="sticky top-0 z-30 flex h-20 items-center justify-between border-b border-white/10 bg-[#0b1020]/90 px-5 backdrop-blur-xl lg:px-8">
      <div className="flex items-center gap-4">
        <button onClick={onMenuClick} className="rounded-lg p-2 hover:bg-white/10 lg:hidden">
          <Menu />
        </button>

        <div>
          <p className="text-xs text-gray-500">Workspace / Overview</p>
          <h2 className="font-semibold">DevOpsPilot</h2>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button className="hidden items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-gray-400 sm:flex">
          <Search size={17} />
          Search
        </button>

        <button className="relative rounded-xl p-2 hover:bg-white/10">
          <Bell size={20} />
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-violet-500" />
        </button>

        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-blue-500 font-bold">
          {user?.username?.[0]?.toUpperCase() || "U"}
        </div>
      </div>
    </header>
  );
}
