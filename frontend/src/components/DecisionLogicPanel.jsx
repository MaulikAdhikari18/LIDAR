import { ArrowDown, BrainCircuit, GitBranch } from "lucide-react";

// This panel is deliberately static/illustrative -- it explains the SHAPE
// of the decision pipeline (the same one RegionInspector/UtilityEngine
// compute real numbers through), not a second live computation. Showing
// per-object numbers here would just duplicate UtilityEngine with a
// different layout; this panel's job is the "how it works" explainer the
// reference design calls for.
export default function DecisionLogicPanel() {
  return (
    <div className="panel flex flex-col">
      <div className="section-title">
        <BrainCircuit size={16} />
        Decision Logic
      </div>
      <p className="mb-3 text-[11px] leading-snug text-slate-500">Resolution decision for each object</p>

      <div className="rounded-lg border border-line bg-black/20 p-3">
        <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Input: Object Features</div>
        <ul className="mt-2 space-y-1 text-[11px] text-slate-400">
          <li>• Distance (d)</li>
          <li>• Relative velocity (v)</li>
          <li>• Predicted trajectory risk (r)</li>
          <li>• Object class (c)</li>
          <li>• Current resolution (res)</li>
          <li>• Available compute budget (B)</li>
        </ul>
      </div>

      <div className="my-2 flex justify-center"><ArrowDown className="text-slate-600" size={16} /></div>

      <div className="rounded-lg border border-line bg-black/20 p-3">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-slate-400">
          <GitBranch size={13} /> Decision Model
        </div>
        <p className="mt-1 text-[11px] text-slate-400">Risk &amp; uncertainty analysis: utility = R(d, v, r, c, res, B)</p>
      </div>

      <div className="my-2 flex justify-center"><ArrowDown className="text-slate-600" size={16} /></div>

      <div className="rounded-lg border border-cyanSignal/30 bg-cyanSignal/5 p-3 text-center">
        <div className="text-[10px] font-black uppercase tracking-wider text-cyan-200">Decision: What To Do?</div>
      </div>

      <div className="my-2 flex justify-center"><ArrowDown className="text-slate-600" size={16} /></div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2 text-center">
          <div className="text-[11px] font-black text-emerald-300">MAINTAIN</div>
          <div className="mt-1 text-[10px] text-slate-500">Keep current resolution</div>
        </div>
        <div className="rounded-lg border border-cyanSignal/40 bg-cyanSignal/10 p-2 text-center">
          <div className="text-[11px] font-black text-cyanSignal">REFINE</div>
          <div className="mt-1 text-[10px] text-slate-500">Increase resolution</div>
        </div>
        <div className="rounded-lg border border-line bg-slate-800/30 p-2 text-center">
          <div className="text-[11px] font-black text-slate-300">COARSEN</div>
          <div className="mt-1 text-[10px] text-slate-500">Decrease resolution</div>
        </div>
      </div>

      <p className="mt-3 text-center text-[10px] text-slate-600">
        Goal: maximize perception accuracy under fixed compute budget constraints.
      </p>
    </div>
  );
}
