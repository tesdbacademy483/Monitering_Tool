
export default function StatCard({ title, value, change, icon: Icon, color = "violet" }) {
  const colors = {
    violet: "bg-violet-500/10 text-violet-400",
    green: "bg-emerald-500/10 text-emerald-400",
    blue: "bg-blue-500/10 text-blue-400",
    red: "bg-red-500/10 text-red-400",
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-[#121b30] p-6 transition hover:-translate-y-1 hover:border-violet-500/40">
      <div className="mb-5 flex items-center justify-between">
        <p className="text-sm text-gray-400">{title}</p>
        <div className={`rounded-xl p-3 ${colors[color] || colors.violet}`}>
          {Icon && <Icon size={21} />}
        </div>
      </div>

      <h2 className="text-3xl font-bold">{value}</h2>
      <p className="mt-2 text-xs text-gray-400">{change}</p>
    </div>
  );
}
