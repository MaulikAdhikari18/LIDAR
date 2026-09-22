import { useMemo } from "react";
import { ArrowRightLeft } from "lucide-react";

// D6: Dynamic budget reclamation and reallocation. Every donor/receiver
// listed here, and every reclaimed/allocated cell count, comes straight from
// the real `regions` array (cellsAllocated + decision) -- this is not a
// separate simulated ledger, it's the same per-frame decisions every other
// panel already reads, just re-grouped to show the flow between them.
function flowFor(regions) {
  const donors = (regions ?? [])
    .filter((r) => r.decision === "COARSEN")
    .sort((a, b) => b.cellsAllocated - a.cellsAllocated)
    .slice(0, 4);
  const receivers = (regions ?? [])
    .filter((r) => r.decision === "REFINE")
    .sort((a, b) => b.cellsAllocated - a.cellsAllocated)
    .slice(0, 4);
  const reclaimed = donors.reduce((sum, r) => sum + r.cellsAllocated, 0);
  const allocated = receivers.reduce((sum, r) => sum + r.cellsAllocated, 0);
  return { donors, receivers, reclaimed, allocated };
}

function Node({ region, align }) {
  return (
    <div className={`rounded-md border border-line bg-slate-950/70 px-2.5 py-1.5 text-xs ${align === "right" ? "text-right" : ""}`}>
      <div className="font-bold text-slate-200">{region.name}</div>
      <div className="font-mono text-[10px] text-slate-500">{region.cellsAllocated.toLocaleString()} cells</div>
    </div>
  );
}

export default function BudgetReallocationFlow({ regions }) {
  const { donors, receivers, reclaimed, allocated } = useMemo(() => flowFor(regions), [regions]);
  const rows = Math.max(donors.length, receivers.length, 1);
  const poolHeight = rows * 46;

  return (
    <div className="panel">
      <div className="section-title">
        <ArrowRightLeft size={16} />
        Budget Reallocation Flow
      </div>
      <p className="mb-3 text-[11px] leading-snug text-slate-500">
        Budget follows information, not location -- cells coarsened here are reclaimed into
        a shared pool and re-spent wherever utility is currently highest this frame.
      </p>

      {donors.length === 0 && receivers.length === 0 ? (
        <p className="text-sm text-slate-500">No reallocation this frame -- every region is holding its current resolution.</p>
      ) : (
        <div className="grid grid-cols-[1fr_90px_1fr] items-center gap-2">
          <div className="space-y-2">
            {donors.length === 0 && <p className="text-[10px] text-slate-600">No donors this frame.</p>}
            {donors.map((r) => (
              <Node key={r.id} region={r} />
            ))}
          </div>

          <svg className="h-full w-full" style={{ minHeight: poolHeight }} viewBox={`0 0 90 ${poolHeight}`}>
            {donors.map((r, i) => {
              const y0 = (i + 0.5) * (poolHeight / donors.length);
              const yMid = poolHeight / 2;
              return (
                <path
                  d={`M0 ${y0} C 30 ${y0}, 30 ${yMid}, 45 ${yMid}`}
                  fill="none"
                  key={r.id}
                  stroke="#64748b"
                  strokeOpacity="0.55"
                  strokeWidth={Math.max(1, Math.min(6, r.cellsAllocated / Math.max(reclaimed, 1) * 14))}
                />
              );
            })}
            {receivers.map((r, i) => {
              const y1 = (i + 0.5) * (poolHeight / receivers.length);
              const yMid = poolHeight / 2;
              return (
                <path
                  d={`M45 ${yMid} C 60 ${yMid}, 60 ${y1}, 90 ${y1}`}
                  fill="none"
                  key={r.id}
                  stroke="#22d3ee"
                  strokeOpacity="0.7"
                  strokeWidth={Math.max(1, Math.min(6, r.cellsAllocated / Math.max(allocated, 1) * 14))}
                />
              );
            })}
            <circle cx="45" cy={poolHeight / 2} fill="#0f172a" r="9" stroke="#22d3ee" strokeOpacity="0.6" strokeWidth="0.8" />
            <text fill="#67e8f9" fontSize="4" fontWeight="800" textAnchor="middle" x="45" y={poolHeight / 2 + 1.4}>
              POOL
            </text>
          </svg>

          <div className="space-y-2">
            {receivers.length === 0 && <p className="text-right text-[10px] text-slate-600">No receivers this frame.</p>}
            {receivers.map((r) => (
              <Node align="right" key={r.id} region={r} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-md border border-line bg-slate-950/60 p-2 text-center">
          <p className="metric-label">Reclaimed this frame</p>
          <b className="text-lg text-slate-300">{reclaimed.toLocaleString()}</b>
        </div>
        <div className="rounded-md border border-line bg-slate-950/60 p-2 text-center">
          <p className="metric-label">Reallocated this frame</p>
          <b className="text-lg text-cyanSignal">{allocated.toLocaleString()}</b>
        </div>
      </div>
    </div>
  );
}