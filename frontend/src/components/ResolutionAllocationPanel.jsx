import { Grid3x3 } from "lucide-react";

const TIERS = [
  { key: "COARSEN", label: "COARSE", metresFallback: 0.5, colorClass: "border-slate-600 bg-slate-800/30 text-slate-300" },
  { key: "MAINTAIN", label: "MEDIUM", metresFallback: 0.2, colorClass: "border-emerald-500/50 bg-emerald-500/10 text-emerald-300" },
  { key: "REFINE", label: "FINE", metresFallback: 0.05, colorClass: "border-cyanSignal/60 bg-cyanSignal/10 text-cyanSignal" },
];

// Real counts derived from the same `regions` array every other panel uses
// -- how many currently-visible regions/objects sit at each resolution
// tier this frame. Not a separate data source from BudgetPanel or
// AdaptiveMap, just a different view of the same numbers.
export default function ResolutionAllocationPanel({ regions, resolutionLevels }) {
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
    <div className="panel">
      <div className="section-title">
        <Grid3x3 size={16} />
        Resolution Allocation
      </div>
      <p className="mb-3 text-[11px] leading-snug text-slate-500">
        Number of tracked objects/regions currently held at each resolution tier.
      </p>
      <div className="grid grid-cols-3 gap-2">
        {TIERS.map((tier) => (
          <div className={`rounded-lg border p-3 text-center ${tier.colorClass}`} key={tier.key}>
            <Grid3x3 className="mx-auto mb-1 opacity-70" size={16} />
            <div className="text-2xl font-black text-white">{counts[tier.key]}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-wider">{tier.label}</div>
            <div className="text-[10px] text-slate-500">{Math.round(metresFor(tier.key, tier.metresFallback) * 100)} cm</div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10px] text-slate-600">Number of tracked objects per resolution tier.</p>
    </div>
  );
}
