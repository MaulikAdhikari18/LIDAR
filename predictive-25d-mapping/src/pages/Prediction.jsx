import { Route } from "lucide-react";
import AdaptiveMap from "../components/AdaptiveMap.jsx";
import { getFutureOccupancyProbability, getRegionPosition } from "../utils/utilityCalculation.js";

export default function Prediction({
  predictionMode,
  regions,
  selectedRegionId,
  setPredictionMode,
  setSelectedRegionId,
  time,
}) {
  const dynamicRegions = regions.filter((region) => region.kind === "dynamic");
  const predictive = predictionMode === "predictive";

  return (
    <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
      <div className="panel">
        <div className="section-title">
          <Route size={16} />
          Future Occupancy Probability
        </div>
        <svg className="aspect-[1.7/1] w-full rounded-md border border-line bg-slate-950" viewBox="0 0 100 100">
          <rect className="fill-[#081018]" height="100" width="100" />
          <path className="fill-slate-900/60 stroke-slate-400/10" d="M13 0 L43 0 L61 100 L28 100 Z" />
          {dynamicRegions.map((region) =>
            [0, 1, 2, 3].map((horizon) => {
              const position = getRegionPosition(region, time, horizon);
              const probability = getFutureOccupancyProbability(region, time, horizon, true);
              return (
                <g key={`${region.id}-${horizon}`}>
                  <circle
                    className={horizon === 0 ? "fill-cyanSignal/25 stroke-cyanSignal/70" : "fill-amber-400/10 stroke-amber-300/55"}
                    cx={position.x}
                    cy={position.y}
                    r={11 - horizon * 1.35}
                  />
                  <text className="fill-cyan-50 text-[3px] font-bold [paint-order:stroke] [stroke:rgba(0,0,0,0.7)] [stroke-width:0.45]" x={position.x - 3} y={position.y + 1}>
                    {Math.round(probability * 100)}%
                  </text>
                </g>
              );
            }),
          )}
        </svg>

        <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs font-black uppercase tracking-[0.14em] text-slate-500">
          <span>NOW</span>
          <span>+1 SEC</span>
          <span>+2 SEC</span>
          <span>+3 SEC</span>
        </div>
      </div>

      <div className="space-y-4">
        <div className="panel">
          <div className="section-title">Adaptation Mode</div>
          <div className="flex flex-wrap gap-2">
            <button
              className={`control-button ${!predictive ? "control-button-active" : ""}`}
              onClick={() => setPredictionMode("current")}
              type="button"
            >
              Current-only Adaptation
            </button>
            <button
              className={`control-button ${predictive ? "control-button-active" : ""}`}
              onClick={() => setPredictionMode("predictive")}
              type="button"
            >
              Predictive Adaptation
            </button>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            {predictive
              ? "Predictive adaptation refines both the current object position and the high-probability future corridor."
              : "Current-only adaptation refines the object now, but does not pre-allocate cells where it is likely to be next."}
          </p>
        </div>

        <AdaptiveMap
          onSelectRegion={setSelectedRegionId}
          predictionEnabled={predictive}
          regions={regions}
          selectedRegionId={selectedRegionId}
          title={predictive ? "Predictive Adaptive Resolution" : "Current-only Resolution"}
        />
      </div>
    </section>
  );
}
