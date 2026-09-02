import { Database } from "lucide-react";
import { TOTAL_BUDGET } from "../data/simulationData.js";

export default function BudgetPanel({ onSelectRegion, regions, selectedRegionId }) {
  const allocated = regions.reduce((sum, region) => sum + region.cellsAllocated, 0);
  const available = TOTAL_BUDGET - allocated;
  const utilization = Math.round((allocated / TOTAL_BUDGET) * 100);

  return (
    <div className="panel">
      <div className="section-title">
        <Database size={16} />
        Computational Budget
      </div>

      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="metric-label">Fixed budget</p>
          <h2 className="text-4xl font-black text-white">100,000</h2>
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Map Cells</span>
        </div>
        <Database className="text-cyanSignal" size={36} />
      </div>

      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-950">
        <div className="h-full rounded-full bg-gradient-to-r from-cyanSignal to-stable" style={{ width: `${utilization}%` }} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div>
          <p className="metric-label">Allocated</p>
          <b className="text-lg text-white">{allocated.toLocaleString()}</b>
        </div>
        <div>
          <p className="metric-label">Available</p>
          <b className="text-lg text-white">{available.toLocaleString()}</b>
        </div>
        <div>
          <p className="metric-label">Utilization</p>
          <b className="text-lg text-white">{utilization}%</b>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {regions.map((region) => (
          <button
            className={`relative grid w-full grid-cols-[1fr_auto] overflow-hidden rounded-md border bg-slate-950/70 p-2 text-left text-sm transition ${
              selectedRegionId === region.id ? "border-cyanSignal/70" : "border-line hover:border-cyanSignal/50"
            }`}
            key={region.id}
            onClick={() => onSelectRegion(region.id)}
            type="button"
          >
            <span className="z-10 text-slate-200">{region.name}</span>
            <b className="z-10 text-slate-100">{region.cellsAllocated.toLocaleString()}</b>
            <span className="absolute bottom-0 left-0 h-[2px] bg-cyanSignal shadow-glow" style={{ width: `${(region.cellsAllocated / 36000) * 100}%` }} />
          </button>
        ))}
      </div>

      <blockquote className="mt-4 border-l-2 border-cyanSignal pl-3 text-sm font-bold text-cyan-100">
        Resolution is allocated, not predetermined.
      </blockquote>
    </div>
  );
}
