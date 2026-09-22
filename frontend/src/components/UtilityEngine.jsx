import { BrainCircuit, Grid3x3 } from "lucide-react";
import { explainDecision, METRIC_HELP } from "../utils/explainDecision.js";

const factors = [
  ["Safety relevance", "safetyRelevance"],
  ["Motion", "motion"],
  ["Uncertainty", "uncertainty"],
  ["Geometric complexity", "geometricComplexity"],
  ["Distance value", "distanceValue"],
  ["Future occupancy", "futureProbability"],
];

const RESOLUTION_TIERS = [
  { key: "COARSEN", label: "COARSE", metresFallback: 0.5, colorClass: "border-slate-600 bg-slate-800/30 text-slate-300" },
  { key: "MAINTAIN", label: "MEDIUM", metresFallback: 0.2, colorClass: "border-emerald-500/50 bg-emerald-500/10 text-emerald-300" },
  { key: "REFINE", label: "FINE", metresFallback: 0.05, colorClass: "border-cyanSignal/60 bg-cyanSignal/10 text-cyanSignal" },
];

// Frame-level resolution tier counts, folded into the bottom of this same
// panel (rather than a separate card) so the Information Utility Engine box
// uses the vertical space it already occupies in the Live System 3-column
// row instead of sitting mostly empty next to the taller LiDAR/map panels.
// Not a separate data source -- same `regions` array every other panel uses.
function ResolutionAllocationSection({ regions, resolutionLevels }) {
  const counts = { COARSEN: 0, MAINTAIN: 0, REFINE: 0 };
  for (const r of regions) {
    if (counts[r.decision] !== undefined) counts[r.decision] += 1;
  }
  const metresFor = (tierKey, fallback) => {
    if (!resolutionLevels || resolutionLevels.length !== 3) return fallback;
    const idx = tierKey === "COARSEN" ? 0 : tierKey === "MAINTAIN" ? 1 : 2;
    return resolutionLevels[idx];
  };

  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">
        <Grid3x3 size={14} />
        Resolution Allocation
      </div>
      <p className="mb-3 text-[11px] leading-snug text-slate-500">
        Number of tracked objects/regions currently held at each resolution tier.
      </p>
      <div className="grid grid-cols-3 gap-2">
        {RESOLUTION_TIERS.map((tier) => (
          <div className={`rounded-lg border p-3 text-center ${tier.colorClass}`} key={tier.key}>
            <Grid3x3 className="mx-auto mb-1 opacity-70" size={16} />
            <div className="text-2xl font-black text-white">{counts[tier.key]}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-wider">{tier.label}</div>
            <div className="text-[10px] text-slate-500">{Math.round(metresFor(tier.key, tier.metresFallback) * 100)} cm</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// `regions` / `resolutionLevels` are optional: Prediction.jsx renders this
// panel without them and simply gets the utility breakdown on its own, same
// as before. Live System passes both so the Resolution Allocation section
// appears here too.
export default function UtilityEngine({ region, regions, resolutionLevels }) {
  const showResolution = Array.isArray(regions);

  if (!region) {
    return (
      <div className="panel">
        <div className="section-title">
          <BrainCircuit size={16} />
          Information Utility Engine
        </div>
        <p className="text-sm text-slate-500">No region selected. Click any cell, dot, or list item to see its utility breakdown.</p>
        {showResolution && <ResolutionAllocationSection regions={regions} resolutionLevels={resolutionLevels} />}
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="section-title">
        <BrainCircuit size={16} />
        Information Utility Engine
      </div>

      <div className="space-y-2">
        {factors.map(([label, key]) => (
          <div className="grid grid-cols-[1fr_110px_42px] items-center gap-2 text-xs" key={key}>
            <span className="cursor-help text-slate-400" title={METRIC_HELP[label]}>{label}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-slate-950">
              <span className="block h-full rounded-full bg-cyanSignal" style={{ width: `${region[key] * 100}%` }} />
            </span>
            <strong className="text-right text-slate-100">{region[key].toFixed(2)}</strong>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2">
        <Value label="Expected information gain" value={region.expectedInformationGain.toFixed(2)} />
        <span className="font-black text-slate-500">÷</span>
        <Value label="Computational cost" value={region.computationalCost.toFixed(2)} />
        <span className="font-black text-slate-500">=</span>
        <Value label="Utility" value={region.utility.toFixed(2)} />
      </div>

      <div className={`mt-4 rounded-md border px-3 py-3 text-center text-lg font-black tracking-[0.2em] ${
        region.decision === "REFINE"
          ? "border-cyanSignal/50 bg-cyanSignal/10 text-cyan-100"
          : region.decision === "MAINTAIN"
            ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100"
            : "border-slate-500/30 bg-slate-500/10 text-slate-200"
      }`}>
        {region.decision}
      </div>

      <p className="mt-3 text-xs leading-relaxed text-slate-400">
        {explainDecision(region)}
      </p>

      {showResolution && <ResolutionAllocationSection regions={regions} resolutionLevels={resolutionLevels} />}
    </div>
  );
}

function Value({ label, value }) {
  return (
    <div className="rounded-md border border-line bg-slate-950/70 p-2" title={METRIC_HELP[label]}>
      <p className="metric-label cursor-help">{label}</p>
      <b className="text-2xl font-black text-white">{value}</b>
    </div>
  );
}
