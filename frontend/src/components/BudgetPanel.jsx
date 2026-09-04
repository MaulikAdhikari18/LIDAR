import { Database } from "lucide-react";
import { TOTAL_BUDGET } from "../data/simulationData.js";

function RadialGauge({ color, glow, label, percent, size = 64, sub }) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, Math.max(0, percent)) / 100) * c;
  return (
    <div className="relative flex flex-col items-center justify-center" style={{ width: size, height: size }}>
      <svg height={size} viewBox={`0 0 ${size} ${size}`} width={size}>
        <circle cx={size / 2} cy={size / 2} fill="none" opacity="0.18" r={r} stroke={color} strokeWidth="4" />
        <circle
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={r}
          stroke={color}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          strokeWidth="4"
          style={{ filter: `drop-shadow(0 0 ${glow}px ${color})`, transition: "stroke-dashoffset 0.4s" }}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="font-mono text-xs font-bold text-white">{Math.round(percent)}%</span>
        <span className="text-[8px] font-mono uppercase tracking-tighter" style={{ color }}>
          {sub}
        </span>
      </div>
    </div>
  );
}

export default function BudgetPanel({ budgetTotal, budgetUsed, isLive }) {
  // The budget in force, not a frontend constant: in Live mode this is
  // metrics.budget straight from the backend, a completely different
  // magnitude from the simulation's 100,000.
  const total = budgetTotal ?? TOTAL_BUDGET;
  const used = budgetUsed ?? 0;
  const available = Math.max(0, total - used);
  const utilization = Math.min(100, Math.round((used / Math.max(total, 1e-6)) * 100));
  const unit = isLive ? "Budget Units" : "Map Cells";
  const tone = utilization > 90 ? "#f43f5e" : utilization > 70 ? "#f59e0b" : "#00f2fe";

  return (
    <section className="glow-red-border rounded-xl border border-rose-500/40 bg-[#0c1024]/80 p-3.5 shadow-lg" data-purpose="compute-budget-gauge">
      <div className="mb-2 flex items-center space-x-1.5 text-xs font-semibold uppercase tracking-wider text-slate-300">
        <Database className="text-rose-400" size={13} />
        <span>Compute Budget</span>
      </div>

      <div className="relative flex items-center justify-between overflow-hidden rounded-xl border border-slate-800 bg-slate-950/70 p-3 shadow-inner">
        <RadialGauge color="#f43f5e" glow={6} percent={utilization} sub="USED" />
        <div className="flex-1 space-y-1 px-3 font-mono text-[11px]">
          <div className="flex items-center justify-between text-slate-300">
            <span className="text-slate-400">Used</span>
            <span className="font-bold text-white">{Math.round(used).toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between text-slate-300">
            <span className="text-slate-400">Remaining</span>
            <span className="font-bold text-cyan-400">{Math.round(available).toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between border-t border-slate-800 pt-0.5 text-slate-300">
            <span className="text-slate-400">Total</span>
            <span className="font-bold text-slate-200">{Math.round(total).toLocaleString()} {unit}</span>
          </div>
        </div>
        <RadialGauge color={tone} glow={5} percent={100 - utilization} size={56} sub="FREE" />
      </div>
    </section>
  );
}