
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { Workflow } from "lucide-react";
import api from "../services/api";

export default function Register() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    password2: "",
  });

  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (form.password !== form.password2) {
      toast.error("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      await api.post("register/", {
        username: form.username,
        email: form.email,
        password: form.password,
      });

      toast.success("Registration successful! Please log in.");
      navigate("/login");
    } catch (error) {
      const data = error.response?.data;
      toast.error(
        data?.username?.[0] ||
        data?.email?.[0] ||
        data?.detail ||
        "Registration failed"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b1020] p-5">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#121b30] p-8">
        <div className="mb-8 text-center">
          <Workflow className="mx-auto mb-4 text-violet-400" size={42} />
          <h1 className="text-3xl font-bold">Create Account</h1>
          <p className="mt-2 text-sm text-gray-400">Join DevOpsPilot today</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {[
            ["username", "Username", "text"],
            ["email", "Email address", "email"],
            ["password", "Password", "password"],
            ["password2", "Confirm password", "password"],
          ].map(([field, placeholder, type]) => (
            <input
              key={field}
              type={type}
              placeholder={placeholder}
              required
              className="w-full rounded-xl border border-white/10 bg-[#0b1020] p-4 outline-none focus:border-violet-500"
              value={form[field]}
              onChange={(e) => setForm({ ...form, [field]: e.target.value })}
            />
          ))}

          <button disabled={loading} className="w-full rounded-xl bg-violet-600 p-4 font-semibold hover:bg-violet-500">
            {loading ? "Creating account..." : "Register"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-400">
          Already registered?{" "}
          <Link to="/login" className="text-violet-400">Login</Link>
        </p>
      </div>
    </div>
  );
}
