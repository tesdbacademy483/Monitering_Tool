import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import {
  UserRound,
  Save,
  GitBranch,
  CheckCircle2,
  Unplug,
} from "lucide-react";
import api from "../services/api";

export default function Profile() {
  const [profile, setProfile] = useState({
    username: "",
    email: "",
    phone: "",
  });

  const [github, setGithub] = useState({
    connected: false,
    github_username: null,
  });

  const [loading, setLoading] = useState(true);
  const [githubLoading, setGithubLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get("profile/me/")
      .then((res) => setProfile(res.data))
      .catch(() => toast.error("Unable to load profile"))
      .finally(() => setLoading(false));

    api
      .get("github/status/")
      .then((res) => setGithub(res.data))
      .catch((error) => {
        console.error("GitHub status check failed:", error);
      })
      .finally(() => setGithubLoading(false));
  }, []);

  // Connect GitHub
  const connectGitHub = async () => {
    try {
      const response = await api.get("github/login/");
      window.location.href = response.data.authorization_url;
    } catch (error) {
      console.error("GitHub connection failed:", error);
      toast.error("Could not connect to GitHub");
    }
  };

  // Disconnect GitHub
  const disconnectGitHub = async () => {
    const confirmed = window.confirm(
      "Are you sure you want to disconnect your GitHub account? Your repositories will no longer be available until you reconnect."
    );

    if (!confirmed) return;

    setDisconnecting(true);

    try {
      await api.post("github/disconnect/");

      setGithub({
        connected: false,
        github_username: null,
      });

      toast.success("GitHub disconnected successfully");
    } catch (error) {
      console.error("GitHub disconnect failed:", error);
      toast.error("Unable to disconnect GitHub");
    } finally {
      setDisconnecting(false);
    }
  };

  // Update profile
  const handleUpdate = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      const response = await api.patch("profile/me/", {
        phone: profile.phone,
      });

      setProfile(response.data);
      toast.success("Profile updated successfully!");
    } catch (error) {
      console.error("Profile update failed:", error);
      toast.error("Could not update profile");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-gray-400">Loading profile...</p>;
  }

  return (
    <div>
      <h1 className="text-3xl font-bold">My Profile</h1>
      <p className="mt-2 text-gray-400">
        Manage your account information.
      </p>

      <form
        onSubmit={handleUpdate}
        className="mt-8 max-w-2xl rounded-2xl border border-white/10 bg-[#121b30] p-8"
      >
        {/* User information */}
        <div className="mb-8 flex items-center gap-4">
          <div className="rounded-full bg-violet-600/20 p-5 text-violet-400">
            <UserRound size={35} />
          </div>

          <div>
            <h2 className="text-xl font-semibold">{profile.username}</h2>
            <p className="text-sm text-gray-400">{profile.email}</p>
          </div>
        </div>

        <label className="mb-2 block text-sm text-gray-400">
          Username
        </label>
        <input
          value={profile.username}
          readOnly
          className="mb-5 w-full rounded-xl border border-white/10 bg-[#0b1020] p-4 text-gray-400"
        />

        <label className="mb-2 block text-sm text-gray-400">
          Email
        </label>
        <input
          value={profile.email}
          readOnly
          className="mb-5 w-full rounded-xl border border-white/10 bg-[#0b1020] p-4 text-gray-400"
        />

        <label className="mb-2 block text-sm text-gray-400">
          Phone
        </label>
        <input
          value={profile.phone || ""}
          onChange={(e) =>
            setProfile({ ...profile, phone: e.target.value })
          }
          placeholder="Enter phone number"
          className="mb-6 w-full rounded-xl border border-white/10 bg-[#0b1020] p-4 outline-none focus:border-violet-500"
        />

        {/* GitHub Integration */}
        <div className="mb-6 rounded-xl border border-white/10 bg-[#0b1020] p-5">
          <h3 className="mb-3 flex items-center gap-2 font-semibold">
            <GitBranch size={20} />
            GitHub Integration
          </h3>

          {githubLoading ? (
            <p className="text-sm text-gray-400">
              Checking GitHub connection...
            </p>
          ) : github.connected ? (
            <div>
              <div className="mb-2 flex items-center gap-2 text-green-400">
                <CheckCircle2 size={18} />
                <span className="font-medium">Connected</span>
              </div>

              <p className="mb-4 text-sm text-gray-300">
                GitHub username:{" "}
                <span className="font-semibold text-white">
                  {github.github_username}
                </span>
              </p>

              <button
                type="button"
                onClick={disconnectGitHub}
                disabled={disconnecting}
                className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-red-400 transition hover:bg-red-500/20 disabled:opacity-50"
              >
                <Unplug size={18} />
                {disconnecting ? "Disconnecting..." : "Disconnect GitHub"}
              </button>
            </div>
          ) : (
            <div>
              <p className="mb-3 text-sm text-gray-400">
                Your GitHub account is not connected.
              </p>

              <button
                type="button"
                onClick={connectGitHub}
                className="flex items-center gap-2 rounded-lg bg-gray-800 px-4 py-2 text-white hover:bg-gray-700"
              >
                <GitBranch size={18} />
                Connect GitHub
              </button>
            </div>
          )}
        </div>

        {/* Save button */}
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-3 font-semibold hover:bg-violet-500 disabled:opacity-50"
        >
          <Save size={18} />
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </form>
    </div>
  );
}