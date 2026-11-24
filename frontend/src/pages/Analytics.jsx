
import { ChartNoAxesCombined, TrendingUp } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

const data = [
  { day: "Mon", builds: 12 },
  { day: "Tue", builds: 18 },
  { day: "Wed", builds: 14 },
  { day: "Thu", builds: 22 },
  { day: "Fri", builds: 17 },
  { day: "Sat", builds: 25 },
  { day: "Sun", builds: 20 },
];

export default function Analytics() {
  return (
    <div>
      <h1 className="text-3xl font-bold">Analytics</h1>
      <p className="mt-2 text-gray-400">Understand your DevOps performance.</p>

      <div className="mt-8 rounded-2xl border border-white/10 bg-[#121b30] p-6">
        <div className="mb-6 flex items-center gap-3">
          <ChartNoAxesCombined className="text-violet-400" />
          <div>
            <h2 className="font-semibold">Weekly Build Activity</h2>
            <p className="text-xs text-gray-400">Illustrative sample data</p>
          </div>
        </div>

        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#293148" />
              <XAxis dataKey="day" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip contentStyle={{ background: "#121b30", border: "1px solid #ffffff22" }} />
              <Bar dataKey="builds" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-[#121b30] p-6">
        <TrendingUp className="mb-3 text-emerald-400" />
        <h2 className="font-semibold">Performance insights</h2>
        <p className="mt-2 text-sm text-gray-400">Real performance insights will be generated from your backend analytics.</p>
      </div>
    </div>
  );
}
