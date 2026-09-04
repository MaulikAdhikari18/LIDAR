import { AlertTriangle, Building2, Car, CircleHelp, Crosshair, Minus, Mountain, User } from "lucide-react";
import { resolutionLevelFor } from "../api/liveAdapter.js";

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

const DECISION_BADGE = {
  REFINE: "border-cyan-500/70 bg-cyan-950/80 text-cyan-300",
  MAINTAIN: "border-emerald-500/70 bg-emerald-950/80 text-emerald-400",
  COARSEN: "border-slate-500/60 bg-slate-800/80 text-slate-300",
};

export default function RegionInspector({ region }) {
  const Icon = classIcon(region.semanticClass);
  const level = resolutionLevelFor(region.resolution);
  const badge = DECISION_BADGE[region.decision] ?? DECISION_BADGE.COARSEN;

  // Paired two-column rows, matching the mockup's layout exactly. The
  // mockup's second row-pair was labelled "Notion", which doesn't correspond
  // to anything in this app's data model -- swapped for Elevation, a real
  // field, rather than inventing a fake metric to fill the slot.
  const rows = [
    ["Semantic Class", region.semanticClass, "Resolution", `${level.size}`],
    ["Information gain", region.expectedInformationGain.toFixed(2), "Cost", region.computationalCost.toFixed(2)],
    ["Confidence", `${Math.round(region.confidence * 100)}%`, "Elevation", `${region.elevation.toFixed(2)} m`],
    ["Uncertainty", region.uncertainty.toFixed(2), "Distance value", region.distanceValue.toFixed(2)],
    ["Future probability", region.futureProbability.toFixed(2), "Speed", `${region.speedMps.toFixed(1)} m/s`],
  ];

  return (
    <section className="rounded-xl border border-indigo-900/70 bg-[#0c1024]/80 p-3.5 shadow-lg" data-purpose="selected-region-inspector">
      <div className="mb-2 flex items-center space-x-1.5 text-xs font-semibold uppercase tracking-wider text-slate-300">
        <Crosshair className="text-cyan-400" size={13} />
        <span>Selected region</span>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center space-x-1.5 text-sm font-semibold text-white">
          <Icon className="text-cyan-400" size={16} />
          <span className="text-xs">{region.name}</span>
        </div>
        <span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-bold tracking-wide ${badge}`}>{region.decision}</span>
      </div>

      <div className="space-y-1.5 border-t border-slate-800/80 pt-2.5 font-mono text-[11px]">
        {rows.map(([leftLabel, leftValue, rightLabel, rightValue], i) => (
          <div className={`grid grid-cols-2 gap-2 text-slate-300 ${i > 0 ? "border-t border-slate-900 pt-1.5" : ""}`} key={leftLabel}>
            <div>
              <span className="block text-[10px] text-slate-400">{leftLabel}</span>
              <span className="font-medium text-cyan-300">{leftValue}</span>
            </div>
            <div className="text-right">
              <span className="block text-[10px] text-slate-400">{rightLabel}</span>
              <span className="text-slate-200">{rightValue}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}