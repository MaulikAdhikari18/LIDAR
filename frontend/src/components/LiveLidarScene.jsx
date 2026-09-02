import { motion } from "framer-motion";
import { Pause, Play, RotateCcw, Route, ScanLine } from "lucide-react";
import DemoController from "./DemoController.jsx";

// NOTE: these points are a decorative synthetic sweep, not real LiDAR returns.
// The backend reports only a `points_processed` count, never the point cloud
// itself, so there is nothing real to draw here in either mode. Labelled
// explicitly in the UI below so it can't be mistaken for sensor data.
function lidarPoints(time) {
  return Array.from({ length: 160 }, (_, index) => ({
    id: index,
    x: (index * 37 + Math.sin(time + index) * 4 + 100) % 100,
    y: (index * 61 + Math.cos(time * 0.7 + index) * 5 + 100) % 100,
    r: index % 8 === 0 ? 0.65 : 0.36,
  }));
}

// Live region ids are `track-<n>` and `r-<i>-<j>`, so the old
// `region.id === "vehicle"` test was never true in Live mode: every real car
// was drawn as a small amber dot and labelled "Pedestrian". Branch on the
// semantic class instead, which both modes carry -- "Dynamic vehicle" from the
// simulation, `vehicle` straight from the backend's SemanticKITTI mapping.
function classifyDynamic(region) {
  const raw = String(region.objectClass ?? region.semanticClass ?? "").toLowerCase();
  const isVehicle = /vehicle|car|truck|bus|motorcycle|bicycle/.test(raw);
  const isPerson = /human|pedestrian|person|rider/.test(raw);
  const fallback = region.objectClass
    ? region.objectClass.charAt(0).toUpperCase() + region.objectClass.slice(1)
    : "Object";
  return { isVehicle, label: isVehicle ? "Vehicle" : isPerson ? "Pedestrian" : fallback };
}

// Velocity arrow direction and length. This used to be `velocity.x * 80`, which
// is calibrated for the simulation's canvas-space velocities (~0.1 units): live
// velocities are real m/s, so a 3 m/s car drew a 240-unit line across a
// 100-unit viewBox. Both modes already expose futurePosition in canvas space,
// so point the arrow along the predicted displacement and cap the length.
const MAX_ARROW = 14;
function velocityArrow(region) {
  const dx = region.futurePosition.x - region.currentPosition.x;
  const dy = region.futurePosition.y - region.currentPosition.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-3) return { dx: 0, dy: 0 };
  const capped = Math.min(length, MAX_ARROW);
  return { dx: (dx / length) * capped, dy: (dy / length) * capped };
}

function PredictionCorridor({ region }) {
  const current = region.currentPosition;
  const future = region.futurePosition;
  const midX = (current.x + future.x) / 2;
  const midY = (current.y + future.y) / 2;
  const { isVehicle } = classifyDynamic(region);

  return (
    <g>
      <path
        className="fill-none stroke-cyanSignal/70 [stroke-dasharray:2_1.5]"
        d={`M ${current.x} ${current.y} C ${midX} ${current.y - 9}, ${midX} ${future.y + 9}, ${future.x} ${future.y}`}
        strokeWidth="0.75"
      />
      <ellipse
        cx={midX}
        cy={midY}
        fill="url(#futureCorridor)"
        rx="14"
        ry="6"
        transform={`rotate(${isVehicle ? -24 : -35} ${midX} ${midY})`}
      />
    </g>
  );
}

function DynamicObject({ region, onSelect }) {
  const { isVehicle, label } = classifyDynamic(region);
  const position = region.currentPosition;
  const arrow = velocityArrow(region);

  return (
    <motion.g
      animate={{ opacity: 1 }}
      className="cursor-pointer"
      initial={{ opacity: 0 }}
      onClick={() => onSelect(region.id)}
    >
      <motion.circle
        animate={{ r: isVehicle ? [5.6, 6.4, 5.6] : [4.1, 4.9, 4.1], opacity: [0.95, 0.45, 0.95] }}
        className="fill-transparent stroke-cyanSignal"
        cx={position.x}
        cy={position.y}
        strokeWidth="0.45"
        transition={{ duration: 1.5, repeat: Infinity }}
      />
      {isVehicle ? (
        <rect className="fill-sky-400 stroke-white/80" height="5.4" rx="1.1" width="9.6" x={position.x - 4.8} y={position.y - 2.7} />
      ) : (
        <circle className="fill-amber-300 stroke-white/80" cx={position.x} cy={position.y} r="2.35" />
      )}
      <path
        className="fill-none stroke-cyanSignal"
        d={`M ${position.x} ${position.y} l ${arrow.dx} ${arrow.dy}`}
        strokeWidth="0.75"
      />
      <text className="fill-cyan-50 text-[3px] [paint-order:stroke] [stroke:rgba(0,0,0,0.55)] [stroke-width:0.45]" x={position.x + 5} y={position.y - 5}>
        {`${label} ${region.speedMps.toFixed(1)}m/s`}
      </text>
    </motion.g>
  );
}

export default function LiveLidarScene({ controls, regions, resetSimulation, setControls, setSelectedRegionId, time }) {
  const dynamicRegions = regions.filter((region) => region.kind === "dynamic");
  const dots = lidarPoints(time);

  return (
    <div className="panel">
      <div className="section-title">
        <ScanLine size={16} />
        Live LiDAR / Environment View
      </div>

      <svg className="aspect-[1/0.86] w-full rounded-md border border-line bg-slate-950" viewBox="0 0 100 100">
        <defs>
          <linearGradient id="futureCorridor" x1="0" x2="1">
            <stop stopColor="#22d3ee" stopOpacity="0.28" />
            <stop offset="1" stopColor="#f59e0b" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <rect className="fill-[#081017]" height="100" width="100" />
        <path className="fill-slate-800/70 stroke-slate-300/15" d="M13 0 L43 0 L61 100 L28 100 Z" />
        <path className="fill-none stroke-slate-200/25 [stroke-dasharray:3_4]" d="M45 0 L63 100" strokeWidth="0.55" />
        <path className="fill-none stroke-emerald-400/70" d="M21 0 L37 100" strokeWidth="0.55" />
        <rect className="fill-slate-900 stroke-slate-500/70" height="30" rx="1.5" width="21" x="72" y="16" />
        <rect className="fill-red-500/25 stroke-red-400/80" height="9" rx="1" width="18" x="12" y="72" />
        <ellipse className="fill-amber-500/10 stroke-amber-400/70 [stroke-dasharray:1.5_1.2]" cx="51" cy="74" rx="13" ry="8" />

        {controls.showPrediction && dynamicRegions.map((region) => <PredictionCorridor key={region.id} region={region} />)}

        {controls.showLidar &&
          dots.map((dot) => (
            <motion.circle
              animate={{ opacity: [0.25, 0.9, 0.25] }}
              className="fill-cyanSignal"
              cx={dot.x}
              cy={dot.y}
              key={dot.id}
              r={dot.r}
              transition={{ delay: dot.id * 0.01, duration: 1.7, repeat: Infinity }}
            />
          ))}

        {dynamicRegions.map((region) => (
          <DynamicObject key={region.id} onSelect={setSelectedRegionId} region={region} />
        ))}
      </svg>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className="control-button flex items-center gap-2"
          onClick={() => setControls((current) => ({ ...current, running: !current.running }))}
          title="Play or pause the simulated perception frame stream"
          type="button"
        >
          {controls.running ? <Pause size={16} /> : <Play size={16} />}
          {controls.running ? "Pause" : "Play"}
        </button>
        <button
          className="control-button flex items-center gap-2"
          onClick={resetSimulation}
          title="Reset the demo progression while keeping the live simulation active"
          type="button"
        >
          <RotateCcw size={16} />
          Reset
        </button>
        <label className="flex items-center gap-2 rounded-md border border-line bg-slate-950/70 px-3 py-2 text-sm font-semibold text-slate-400" title="Simulation speed">
          Speed
          <input
            max="2.4"
            min="0.4"
            onChange={(event) => setControls((current) => ({ ...current, speed: Number(event.target.value) }))}
            step="0.2"
            type="range"
            value={controls.speed}
          />
        </label>
        <button
          className={`control-button ${controls.showLidar ? "control-button-active" : ""}`}
          onClick={() => setControls((current) => ({ ...current, showLidar: !current.showLidar }))}
          title="Toggle the decorative LiDAR sweep (synthetic in both modes -- the backend returns a point count, not points)"
          type="button"
        >
          LiDAR
        </button>
        <button
          className={`control-button ${controls.showPrediction ? "control-button-active" : ""}`}
          onClick={() => setControls((current) => ({ ...current, showPrediction: !current.showPrediction }))}
          title="Toggle probabilistic future occupancy corridors"
          type="button"
        >
          <Route className="mr-2 inline" size={16} />
          Prediction
        </button>
        <DemoController controls={controls} setControls={setControls} />
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold text-slate-400">
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-slate-500" />Static</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-cyanSignal" />Dynamic</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-uncertain" />Uncertain</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-cyan-200/40" />Predicted</span>
      </div>
    </div>
  );
}