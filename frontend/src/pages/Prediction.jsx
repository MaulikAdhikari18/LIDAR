import { Route } from "lucide-react";
import AdaptiveMap from "../components/AdaptiveMap.jsx";
import { PREDICTION_HORIZONS } from "../api/liveAdapter.js";
import { getFutureOccupancyProbability, getRegionPosition } from "../utils/utilityCalculation.js";

// Where each ring on the map comes from.
//
// This page used to run EVERY region through the client-side simulation model
// (getRegionPosition / getFutureOccupancyProbability) regardless of data source.
// That model expects region.position in 0-100 canvas space and multiplies
// velocity by a motionScale of 16; live regions carry raw sensor metres (often
// negative) and real m/s, so live objects saturated the model's clamp and pinned
// themselves to the top-left edge -- while the backend's actual predictions sat
// unused in the payload.
//
// Live regions now arrive with a `futureTrack`: the backend's own
// constant-velocity prediction (prediction/future_occupancy.py) resampled at the
// horizons drawn below, plus the Gaussian sigma it used. Simulated regions keep
// the simulation model, so both modes render through one code path.
function horizonSamples(region, time) {
  if (region.futureTrack?.length) {
    return region.futureTrack.map((sample) => ({
      sec: sample.sec,
      position: sample.position,
      value: sample.confidence,
      sigma: sample.sigma,
      extrapolated: sample.extrapolatedBeyondBackend,
    }));
  }

  return PREDICTION_HORIZONS.map((sec) => ({
    sec,
    position: getRegionPosition(region, time, sec),
    value: getFutureOccupancyProbability(region, time, sec, true),
    sigma: null,
    extrapolated: false,
  }));
}

export default function Prediction({
  isLive,
  predictionMode,
  regions,
  resolutionLevels,
  selectedRegionId,
  setPredictionMode,
  setSelectedRegionId,
  time,
}) {
  const dynamicRegions = regions.filter((region) => region.kind === "dynamic");
  const predictive = predictionMode === "predictive";
  const hasBackendTracks = dynamicRegions.some((region) => region.futureTrack?.length);

  return (
    <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
      <div className="panel">
        <div className="section-title">
          <Route size={16} />
          {hasBackendTracks ? "Predicted Position & Confidence" : "Future Occupancy Probability"}
        </div>
        <p className="mb-2 text-xs leading-relaxed text-slate-500">
          {hasBackendTracks
            ? "Rings are the backend's own constant-velocity prediction. The percentage is how tightly it still localizes the object relative to the current frame, derived from the predictor's growing Gaussian sigma."
            : "Rings are the client-side simulation's motion model; the percentage is its modelled future occupancy probability."}
        </p>
        <svg className="aspect-[1.7/1] w-full rounded-md border border-line bg-slate-950" viewBox="0 0 100 100">
          <rect className="fill-[#081018]" height="100" width="100" />
          <path className="fill-slate-900/60 stroke-slate-400/10" d="M13 0 L43 0 L61 100 L28 100 Z" />
          {dynamicRegions.map((region) => {
            const samples = horizonSamples(region, time);
            return (
              <g key={region.id}>
                {/* Straight-line predicted path, drawn only when we have real
                    per-horizon samples to connect. */}
                {samples.length > 1 && (
                  <path
                    className="fill-none stroke-amber-300/35 [stroke-dasharray:1.5_1.5]"
                    d={`M ${samples.map((s) => `${s.position.x} ${s.position.y}`).join(" L ")}`}
                    strokeWidth="0.5"
                  />
                )}
                {samples.map((sample) => (
                  <g key={`${region.id}-${sample.sec}`}>
                    <circle
                      className={
                        sample.sec === 0
                          ? "fill-cyanSignal/25 stroke-cyanSignal/70"
                          : sample.extrapolated
                            ? "fill-amber-400/5 stroke-amber-300/35 [stroke-dasharray:1_1]"
                            : "fill-amber-400/10 stroke-amber-300/55"
                      }
                      cx={sample.position.x}
                      cy={sample.position.y}
                      r={11 - sample.sec * 1.35}
                    />
                    <text
                      className="fill-cyan-50 text-[3px] font-bold [paint-order:stroke] [stroke:rgba(0,0,0,0.7)] [stroke-width:0.45]"
                      x={sample.position.x - 3}
                      y={sample.position.y + 1}
                    >
                      {Math.round(sample.value * 100)}%
                    </text>
                  </g>
                ))}
              </g>
            );
          })}
        </svg>

        <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs font-black uppercase tracking-[0.14em] text-slate-500">
          {PREDICTION_HORIZONS.map((sec) => (
            <span key={sec}>{sec === 0 ? "NOW" : `+${sec} SEC`}</span>
          ))}
        </div>

        {hasBackendTracks && (
          <>
            <p className="mt-2 text-xs text-slate-500">
              Dashed rings extend the same constant-velocity model past{" "}
              <b className="text-slate-400">config.prediction_horizon</b>, which is as far as the backend itself predicts.
            </p>
            <div className="mt-3 space-y-1 text-xs">
              {dynamicRegions
                .filter((region) => region.futureTrack?.length)
                .map((region) => {
                  const last = region.futureTrack[region.futureTrack.length - 1];
                  return (
                    <div className="flex justify-between gap-3 border-b border-slate-700/30 pb-1" key={region.id}>
                      <span className="text-slate-500">{region.name}</span>
                      <span className="text-slate-300">
                        {region.speedMps.toFixed(1)} m/s · sigma {region.futureTrack[0].sigma.toFixed(2)} m &rarr;{" "}
                        {last.sigma.toFixed(2)} m
                      </span>
                    </div>
                  );
                })}
            </div>
          </>
        )}

        {!dynamicRegions.length && (
          <p className="mt-3 text-xs text-amber-300">
            No dynamic objects in this frame — the tracker returned no moving instances, so there is nothing to predict.
          </p>
        )}
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
          {isLive && (
            <p className="mt-2 text-xs text-slate-500">
              This toggle controls the visualization only. The backend always folds its future-occupancy signal into
              information gain via the <b className="text-slate-400">aF</b> weight.
            </p>
          )}
        </div>

        <AdaptiveMap
          onSelectRegion={setSelectedRegionId}
          predictionEnabled={predictive}
          regions={regions}
          resolutionLevels={resolutionLevels}
          selectedRegionId={selectedRegionId}
          title={predictive ? "Predictive Adaptive Resolution" : "Current-only Resolution"}
        />
      </div>
    </section>
  );
}