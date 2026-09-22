import { List } from "lucide-react";

const DECISION_STYLE = {
  REFINE: "bg-cyanSignal/15 text-cyanSignal",
  MAINTAIN: "bg-fuchsia-500/15 text-fuchsia-300",
  COARSEN: "bg-slate-600/30 text-slate-300",
};

// "Risk" is a derived label, not a separate backend field -- computed
// transparently from the region's real safetyRelevance (which IS a
// genuine backend/simulation signal) so the table has something readable
// in that column without inventing a number nothing else produces.
function riskLabel(region) {
  if (region.safetyRelevance >= 0.7) return { label: "High", className: "text-rose-400" };
  if (region.safetyRelevance >= 0.4) return { label: "Medium", className: "text-amber-400" };
  return { label: "Low", className: "text-slate-500" };
}

export default function TrackedObjectsTable({ onSelectRegion, regions, selectedRegionId }) {
  const rows = [...regions].sort((a, b) => b.utility - a.utility);

  return (
    <div className="panel overflow-hidden">
      <div className="section-title">
        <List size={16} />
        Tracked Objects (Current Frame)
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {["ID / Label", "Type", "Dist (m)", "Velocity (m/s)", "Risk", "Decision", "Resolution", "Units"].map((h) => (
                <th className="whitespace-nowrap border-b border-line pb-2 text-left uppercase tracking-wide text-slate-500" key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const risk = riskLabel(r);
              return (
                <tr
                  className={`cursor-pointer transition ${selectedRegionId === r.id ? "bg-cyanSignal/5" : "hover:bg-white/5"}`}
                  key={r.id}
                  onClick={() => onSelectRegion(r.id)}
                >
                  <td className="whitespace-nowrap border-b border-slate-800/60 py-1.5 font-semibold text-slate-100">{r.name}</td>
                  <td className="whitespace-nowrap border-b border-slate-800/60 py-1.5 capitalize text-slate-400">{r.objectClass}</td>
                  <td className="whitespace-nowrap border-b border-slate-800/60 py-1.5 font-mono text-slate-300">{r.distance.toFixed(1)}</td>
                  <td className="whitespace-nowrap border-b border-slate-800/60 py-1.5 font-mono text-slate-300">
                    {r.kind === "dynamic" ? r.speedMps.toFixed(1) : "—"}
                  </td>
                  <td className={`whitespace-nowrap border-b border-slate-800/60 py-1.5 font-bold ${risk.className}`}>{risk.label}</td>
                  <td className="whitespace-nowrap border-b border-slate-800/60 py-1.5">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${DECISION_STYLE[r.decision] ?? DECISION_STYLE.MAINTAIN}`}>
                      {r.decision}
                    </span>
                  </td>
                  <td className="whitespace-nowrap border-b border-slate-800/60 py-1.5 font-mono text-slate-300">{r.resolution.label}</td>
                  <td className="whitespace-nowrap border-b border-slate-800/60 py-1.5 text-right font-mono text-slate-100">{r.cellsAllocated}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
