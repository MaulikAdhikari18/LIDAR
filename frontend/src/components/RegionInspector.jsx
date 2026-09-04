import { Crosshair } from "lucide-react";
import { resolutionLevelFor } from "../api/liveAdapter.js";

export default function RegionInspector({ region }) {
  // Tolerates a bare number of meters as well as the RESOLUTION_LEVELS object;
  // previously a numeric resolution rendered the literal text "undefined undefined".
  const level = resolutionLevelFor(region.resolution);
  const rows = [
    ["Region", region.name],
    ["Semantic class", region.semanticClass],
    ["Elevation", `${region.elevation.toFixed(2)} m`],
    ["Occupancy", `${Math.round(region.occupancy * 100)}%`],
    ["Confidence", `${Math.round(region.confidence * 100)}%`],
    ["Velocity", `${region.speedMps.toFixed(1)} m/s`],
    // Live distance is a raw float (many decimal places); round for display.
    ["Distance", `${Number(region.distance).toFixed(1)} m`],
    ["Expected information gain", region.expectedInformationGain.toFixed(2)],
    ["Computational cost", region.computationalCost.toFixed(2)],
    ["Utility", region.utility.toFixed(2)],
    ["Resolution", `${level.size} ${level.label}`],
    ["Current decision", region.decision],
  ];

  return (
    <div className="panel">
      <div className="section-title">
        <Crosshair size={16} />
        Region Inspector
      </div>
      <div className="space-y-2">
        {rows.map(([label, value]) => (
          <div className="flex items-center justify-between gap-4 border-b border-slate-700/30 pb-2 text-sm" key={label}>
            <span className="text-slate-500">{label}</span>
            <strong className="text-right text-slate-100">{value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}