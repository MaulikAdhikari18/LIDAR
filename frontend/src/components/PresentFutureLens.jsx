import { Eye, ScanEye } from "lucide-react";

// D4: Dual present/future evaluation lenses. Splits the SAME region's
// already-computed factors (from utils/utilityCalculation.js and
// api/liveAdapter.js, both live and simulated) into "what we know right now"
// vs "what the future-occupancy signal alone adds" -- it doesn't invent new
// numbers, it just re-groups the factors that already drive region.utility.
//
// presentOnlyIG uses the exact same weights the app's own IG formula uses
// for every non-future factor (0.27/0.18/0.20/0.15/0.08); it deliberately
// does NOT try to reconstruct the backend's exact per-region ig when a real
// candidate was used, since that number can come from measured perception
// rather than this formula. It's an illustrative breakdown, labeled as such.
const PRESENT_WEIGHTS = {
  safetyRelevance: 0.27,
  motion: 0.18,
  uncertainty: 0.2,
  geometricComplexity: 0.15,
  distanceValue: 0.08,
};
const FUTURE_WEIGHT = 0.12;

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export default function PresentFutureLens({ region }) {
  if (!region) {
    return (
      <div className="panel">
        <div className="section-title">
          <ScanEye size={16} />
          Present / Future Lens
        </div>
        <p className="text-sm text-slate-500">No region selected. Click any cell, dot, or list item to compare its present and future evaluation.</p>
      </div>
    );
  }

  const presentOnlyIG = clamp(
    Object.entries(PRESENT_WEIGHTS).reduce((sum, [key, weight]) => sum + (region[key] ?? 0) * weight, 0),
    0,
    1,
  );
  const futureContribution = clamp((region.futureProbability ?? 0) * FUTURE_WEIGHT, 0, FUTURE_WEIGHT);
  const totalIG = presentOnlyIG + futureContribution;
  const futureShare = totalIG > 0 ? Math.round((futureContribution / totalIG) * 100) : 0;

  return (
    <div className="panel">
      <div className="section-title">
        <ScanEye size={16} />
        Present / Future Lens
      </div>
      <p className="mb-3 text-[11px] leading-snug text-slate-500">
        The same region evaluated through two lenses at once -- not two separate maps, one
        probabilistic future-occupancy signal layered onto the present read.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-line bg-black/20 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
            <Eye size={13} /> Present
          </div>
          <p className="mb-2 text-[10px] text-slate-500">What's directly observed this frame.</p>
          <div className="text-2xl font-black text-white">{presentOnlyIG.toFixed(2)}</div>
          <p className="mt-1 text-[10px] text-slate-600">safety · motion · uncertainty · geometry · distance</p>
        </div>
        <div className="rounded-lg border border-cyanSignal/30 bg-cyanSignal/5 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-cyanSignal">
            <ScanEye size={13} /> Future
          </div>
          <p className="mb-2 text-[10px] text-slate-500">Predicted occupancy, ~1.5s ahead.</p>
          <div className="text-2xl font-black text-cyan-100">+{futureContribution.toFixed(2)}</div>
          <p className="mt-1 text-[10px] text-slate-600">P(occupied) = {(region.futureProbability ?? 0).toFixed(2)}</p>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-line bg-slate-950/60 p-3">
        <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500">
          <span>Combined information gain</span>
          <span>{futureShare}% from future signal</span>
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-900">
          <div className="h-full bg-slate-400" style={{ width: `${100 - futureShare}%` }} />
          <div className="h-full bg-cyanSignal" style={{ width: `${futureShare}%` }} />
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-600">
          Illustrative breakdown using the app's own IG weights -- the actual per-region
          number ({region.expectedInformationGain.toFixed(2)}) may come from a measured backend
          candidate rather than this formula.
        </p>
      </div>
    </div>
  );
}