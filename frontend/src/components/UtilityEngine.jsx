import { AlertTriangle, Building2, BrainCircuit, Car, CircleHelp, Minus, Mountain, User } from "lucide-react";

function classIcon(semanticClass = "") {
  const s = semanticClass.toLowerCase();
  if (s.includes("human") || s.includes("pedestrian")) return User;
  if (s.includes("vehicle") || s.includes("car")) return Car;
  if (s.includes("obstacle")) return AlertTriangle;
  if (s.includes("structure") || s.includes("building")) return Building2;
  if (s.includes("terrain")) return Mountain;
  if (s.includes("boundary") || s.includes("edge") || s.includes("curb") || s.includes("road")) return Minus;
  return CircleHelp;
}

export default function UtilityEngine({ onSelectRegion, regions, selectedRegionId }) {
  const ranked = [...regions].sort((a, b) => b.utility - a.utility);
  const maxUtility = Math.max(0.01, ...ranked.map((r) => r.utility));

  return (
    <section className="glow-cyan-border rounded-xl border border-cyan-500/40 bg-[#0c1024]/80 p-3.5 shadow-lg" data-purpose="utility-engine-rankings">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex items-center space-x-1.5 text-xs font-semibold uppercase tracking-wider text-slate-200">
          <BrainCircuit className="text-cyan-400" size={13} />
          <span>Utility engine</span>
        </div>
        <span className="font-mono text-[9.5px] text-slate-400">Utility = Gain / Cost</span>
      </div>

      <div className="space-y-1.5 text-xs">
        {ranked.map((region, index) => {
          const Icon = classIcon(region.semanticClass);
          const isSelected = region.id === selectedRegionId;
          const barWidth = Math.max(8, (region.utility / maxUtility) * 100);
          return (
            <button
              className={`flex w-full items-center justify-between rounded-lg border p-1.5 text-left transition ${
                isSelected ? "border-cyan-500/40 bg-slate-900/80 text-slate-200" : "border-slate-800 bg-slate-900/50 text-slate-300 hover:bg-slate-800"
              }`}
              key={region.id}
              onClick={() => onSelectRegion(region.id)}
              type="button"
            >
              <div className="flex items-center space-x-2">
                <span className="w-3 font-mono text-[10px] text-slate-400">{index + 1}</span>
                <Icon className={isSelected ? "text-cyan-400" : "text-slate-400"} size={14} />
                <span className={`text-[11.5px] ${isSelected ? "font-medium" : ""}`}>{region.name}</span>
              </div>
              <div className="flex items-center space-x-2">
                <span
                  className={`h-1.5 rounded-full ${isSelected ? "bg-cyan-400 shadow-[0_0_6px_#22d3ee]" : "bg-cyan-500/50"}`}
                  style={{ width: `${barWidth * 0.4}px` }}
                />
                <span className={`font-mono text-[11px] ${isSelected ? "font-semibold text-cyan-300" : "text-slate-300"}`}>{region.utility.toFixed(2)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}