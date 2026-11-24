
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { Workflow } from "lucide-react";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [form, setForm] = useState({
    username: "",
    password: "",
  });

  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await api.post("token/", form);

      login(
        { username: form.username },
        response.data.access,
        response.data.refresh
      );

      toast.success("Login successful!");
      navigate("/dashboard");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b1020] p-5">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#121b30] p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <Workflow className="mx-auto mb-4 text-violet-400" size={42} />
          <h1 className="text-3xl font-bold">Welcome Back</h1>
          <p className="mt-2 text-sm text-gray-400">Sign in to DevOpsPilot</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <input
            className="w-full rounded-xl border border-white/10 bg-[#0b1020] p-4 outline-none focus:border-violet-500"
            placeholder="Username"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            required
          />

          <input
            type="password"
            className="w-full rounded-xl border border-white/10 bg-[#0b1020] p-4 outline-none focus:border-violet-500"
            placeholder="Password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />

          <button
            disabled={loading}
            className="w-full rounded-xl bg-violet-600 p-4 font-semibold hover:bg-violet-500 disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Login"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-400">
          Don't have an account?{" "}
          <Link to="/register" className="text-violet-400">Register</Link>
        </p>
      </div>
    </div>
  );
}
