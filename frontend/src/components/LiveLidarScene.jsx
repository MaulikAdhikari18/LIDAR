import { memo, useMemo } from "react";
import { motion } from "framer-motion";
import { Pause, Play, RotateCcw, Route, ScanLine } from "lucide-react";
import DemoController from "./DemoController.jsx";

// ---------------------------------------------------------------------------
// EGO-VEHICLE PERSPECTIVE PROJECTION
// ---------------------------------------------------------------------------
// The rest of the app works in a top-down canvas: x = lateral position
// (0..100, 50 = straight ahead), y = distance from the ego (0 = far / horizon,
// 100 = right in front of the sensor). This view re-projects that same data
// into a first-person driving perspective so the Live panel reads like the
// FOVEAMAP simulation view. Every marker still comes from the SAME `regions`
// array the sidebar and 2.5D map use.
const HORIZON = 30; // screen-Y of the vanishing line
const GROUND_Y = 99; // screen-Y directly in front of the ego
const HEIGHT_K = 1.08; // world-elevation -> screen-height gain

function project(wx, wy) {
  const t = Math.max(0, Math.min(1, wy / 100));
  const depth = Math.pow(t, 0.82); // non-linear so far things bunch up
  const sy = HORIZON + (GROUND_Y - HORIZON) * depth;
  const spread = 0.26 + 1.02 * depth; // lateral fan-out grows toward viewer
  const sx = 50 + (wx - 50) * spread;
  const scale = 0.2 + 1.0 * depth; // point / object size grows toward viewer
  return { sx, sy, scale, depth };
}

const pt = (wx, wy) => {
  const p = project(wx, wy);
  return `${p.sx.toFixed(2)},${p.sy.toFixed(2)}`;
};

// Small, fast, deterministic RNG so the point cloud is stable across renders
// (a Math.random() cloud would shimmer every frame).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = (rng, a, b) => a + (b - a) * rng();

// Fill a world-space box with points and project each into screen space.
// Depth fog: far points fade out so the cloud reads as receding 3D volume.
function fillVolume(rng, out, { x0, x1, y0, y1, eMin = 0, eMax, count, color, rBase = 0.5, opacity = 0.7 }) {
  for (let i = 0; i < count; i += 1) {
    const wx = rnd(rng, x0, x1);
    const wy = rnd(rng, y0, y1);
    const e = rnd(rng, eMin, eMax);
    const p = project(wx, wy);
    const fog = 0.28 + 0.72 * p.depth;
    out.push({
      x: p.sx,
      y: p.sy - e * p.scale * HEIGHT_K,
      r: Math.max(0.12, rBase * p.scale),
      color,
      opacity: Math.min(0.95, opacity * fog),
    });
  }
}

// Decorative environment point cloud: roadside buildings + tree canopies +
// ground carpet. Dense enough to read as a real scanned scene; atmospheric
// only (no labels, not selectable) so the tracked regions read on top of it.
const STRUCTURES = [
  // left building facades (multiple depth bands)
  { x0: -34, x1: 4, y0: 8, y1: 30, eMax: 30, count: 240, color: "#38bdf8", rBase: 0.46 },
  { x0: -30, x1: 6, y0: 30, y1: 58, eMax: 34, count: 300, color: "#38bdf8", rBase: 0.5 },
  { x0: -26, x1: 8, y0: 58, y1: 86, eMax: 26, count: 220, color: "#38bdf8", rBase: 0.55 },
  // right building facades
  { x0: 96, x1: 134, y0: 10, y1: 32, eMax: 28, count: 240, color: "#38bdf8", rBase: 0.46 },
  { x0: 94, x1: 132, y0: 32, y1: 60, eMax: 32, count: 300, color: "#38bdf8", rBase: 0.5 },
  { x0: 92, x1: 128, y0: 60, y1: 88, eMax: 24, count: 220, color: "#38bdf8", rBase: 0.55 },
  // far skyline blocks straight ahead
  { x0: 12, x1: 30, y0: 4, y1: 16, eMax: 20, count: 120, color: "#38bdf8", rBase: 0.4 },
  { x0: 70, x1: 88, y0: 4, y1: 16, eMax: 22, count: 120, color: "#38bdf8", rBase: 0.4 },
  // roadside tree canopies (green)
  { x0: 9, x1: 24, y0: 22, y1: 34, eMin: 4, eMax: 12, count: 150, color: "#34d399", rBase: 0.62 },
  { x0: 76, x1: 91, y0: 20, y1: 32, eMin: 4, eMax: 12, count: 150, color: "#34d399", rBase: 0.62 },
  { x0: 8, x1: 25, y0: 52, y1: 68, eMin: 4, eMax: 14, count: 180, color: "#22c55e", rBase: 0.7 },
  { x0: 75, x1: 92, y0: 54, y1: 72, eMin: 4, eMax: 14, count: 180, color: "#22c55e", rBase: 0.7 },
];

// Ambient environment (terrain + static infrastructure) is context, not the
// subject, so it is drawn faint. Tracked-object clouds keep full opacity.
const ENV_STRUCTURE_OPACITY = 0.3;
const ENV_TERRAIN_OPACITY = 0.16;

function buildStaticCloud() {
  const rng = mulberry32(20260906);
  const out = [];
  STRUCTURES.forEach((s) => fillVolume(rng, out, { ...s, opacity: ENV_STRUCTURE_OPACITY }));
  // dense ground terrain carpet -- kept very faint so it reads as ground haze
  fillVolume(rng, out, { x0: -28, x1: 128, y0: 6, y1: 100, eMin: 0, eMax: 0.5, count: 1200, color: "#34d399", rBase: 0.4, opacity: ENV_TERRAIN_OPACITY });
  return out;
}

// The environment cloud is expensive (~3k points) and never changes frame to
// frame, so memo it out of the per-frame re-render the parent triggers.
const EnvironmentCloud = memo(function EnvironmentCloud() {
  const cloud = useMemo(buildStaticCloud, []);
  return (
    <g>
      {cloud.map((c, i) => (
        <circle cx={c.x} cy={c.y} fill={c.color} fillOpacity={c.opacity} key={i} r={c.r} />
      ))}
    </g>
  );
});

// Per-region visual profile driven by the same semantic class the sidebar uses.
function objProfile(region) {
  const raw = String(region.semanticClass ?? region.objectClass ?? "").toLowerCase();
  if (region.kind === "dynamic") {
    if (/vehicle|car|truck|bus|motorcycle|bicycle/.test(raw)) {
      return { color: "#f472b6", h: 3.2, w: 8, d: 7, count: 90, dashed: false };
    }
    return { color: "#fb923c", h: 4.4, w: 3, d: 3, count: 60, dashed: false }; // pedestrian / rider
  }
  if (region.kind === "uncertain") return { color: "#f59e0b", h: 1.6, w: 11, d: 9, count: 70, dashed: true };
  if (region.kind === "static") {
    if (/obstacle|barrier/.test(raw)) {
      return { color: "#ef4444", h: 1.1, w: 9, d: 5, count: 90, dashed: false }; // road barrier / hazard
    }
    if (/structure|building|facade/.test(raw)) return { color: "#38bdf8", h: 22, w: 15, d: 13, count: 200, dashed: false };
    return { color: "#38bdf8", h: 1.8, w: 13, d: 6, count: 70, dashed: false }; // curb / boundary
  }
  return { color: "#64748b", h: 0.4, w: 14, d: 14, count: 30, dashed: false }; // empty road / low value
}

// Always show the utility engine's REAL decision for this frame. This used to
// hardcode "MAINTAIN" for every static region and "REFINE" for every dynamic
// vehicle regardless of what was actually computed, which is why the same
// object could show one decision here and a different one in AdaptiveMap /
// BudgetPanel / RegionInspector at the same moment. Resolution is allocated,
// not predetermined -- the label has to agree with that everywhere.
function labelFor(region) {
  return region.decision ?? "TRACK";
}

function hashId(id) {
  let h = 2166136261;
  const str = String(id);
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function regionCloud(region) {
  const profile = objProfile(region);
  const { x: cx, y: cy } = region.currentPosition;
  const rng = mulberry32(hashId(region.id));
  const out = [];
  fillVolume(rng, out, {
    x0: cx - profile.w / 2,
    x1: cx + profile.w / 2,
    y0: cy - profile.d / 2,
    y1: cy + profile.d / 2,
    eMax: profile.h,
    count: profile.count,
    color: profile.color,
    rBase: 0.58,
    opacity: 0.9,
  });
  return out;
}

// Prediction corridor: dashed arrow from current -> predicted future position.
function PredictionCorridor({ region }) {
  const a = project(region.currentPosition.x, region.currentPosition.y);
  const b = project(region.futurePosition.x, region.futurePosition.y);
  return (
    <g>
      <line className="stroke-fuchsia-300/70 [stroke-dasharray:2_1.6]" strokeWidth="0.7" x1={a.sx} x2={b.sx} y1={a.sy} y2={b.sy} />
      <circle className="fill-fuchsia-300/80" cx={b.sx} cy={b.sy} r="0.9" />
    </g>
  );
}

// A tracked object: point cloud + wireframe box + FOVEAMAP-style callout label.
function RegionMarker({ region, onSelect, selected }) {
  const profile = objProfile(region);
  const cloud = regionCloud(region);
  const p = project(region.currentPosition.x, region.currentPosition.y);
  const bw = Math.max(3.5, profile.w * p.scale * 1.5);
  const bh = Math.max(2.5, profile.h * p.scale * HEIGHT_K);
  const boxX = p.sx - bw / 2;
  const boxTop = p.sy - bh;
  const labelText = labelFor(region);
  const labelW = Math.max(18, region.name.length * 1.15);
  // Keep the callout box inside the 0-100 viewBox even when the object's true
  // screen position is near an edge (this is what was cutting "Moving
  // Vehicle" down to "oving Vehicle"). The point cloud and wireframe box stay
  // at the real position -- only the label is pulled back into frame, same
  // approach AdaptiveMap.jsx already uses for its callouts.
  const labelCx = Math.min(100 - labelW / 2 - 1, Math.max(labelW / 2 + 1, p.sx));

  return (
    <g className="cursor-pointer" onClick={() => onSelect(region.id)}>
      {cloud.map((c, i) => (
        <circle cx={c.x} cy={c.y} fill={c.color} fillOpacity={c.opacity} key={i} r={c.r} />
      ))}

      <rect
        fill={profile.color}
        fillOpacity={selected ? 0.18 : 0.08}
        height={bh}
        rx="1"
        stroke={profile.color}
        strokeOpacity={selected ? 1 : 0.8}
        strokeWidth={selected ? 0.75 : 0.5}
        strokeDasharray={profile.dashed ? "1.4 1.2" : undefined}
        width={bw}
        x={boxX}
        y={boxTop}
      />

      {/* connector + callout box */}
      <line stroke={profile.color} strokeOpacity="0.6" strokeWidth="0.3" x1={p.sx} x2={labelCx} y1={boxTop} y2={boxTop - 3} />
      <rect fill="#060d15" height="5.4" rx="0.8" stroke={profile.color} strokeOpacity="0.75" strokeWidth="0.35" width={labelW} x={labelCx - labelW / 2} y={boxTop - 8.4} />
      <text className="font-bold [paint-order:stroke] [stroke:rgba(0,0,0,0.6)] [stroke-width:0.35]" fill="#e2f5ff" fontSize="2.5" textAnchor="middle" x={labelCx} y={boxTop - 5.9}>
        {region.name}
      </text>
      <text fill={profile.color} fontSize="2.1" fontWeight="700" textAnchor="middle" x={labelCx} y={boxTop - 3.6}>
        {labelText}
      </text>
    </g>
  );
}

export default function LiveLidarScene({ controls, regions, resetSimulation, setControls, setSelectedRegionId, time }) {
  const dynamicRegions = regions.filter((region) => region.kind === "dynamic");
  const selectableRegions = regions.filter((region) => region.kind !== "low");

  const gridLines = [10, 20, 32, 46, 62, 80, 98];
  const roadPath = `M ${pt(26, 100)} L ${pt(46, 0)} L ${pt(54, 0)} L ${pt(74, 100)} Z`;

  return (
    <div className="panel">
      <div className="section-title">
        <ScanLine size={16} />
        Live LiDAR / Our Vehicle Perspective View
      </div>

      <svg className="aspect-[1/0.86] w-full rounded-md border border-line bg-slate-950" viewBox="0 0 100 100">
        <defs>
          <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
            <stop stopColor="#02060b" />
            <stop offset="1" stopColor="#06131f" />
          </linearGradient>
          <linearGradient id="ground" x1="0" x2="0" y1="0" y2="1">
            <stop stopColor="#050d16" />
            <stop offset="1" stopColor="#08202b" />
          </linearGradient>
          <radialGradient id="horizonGlow" cx="0.5" cy="0" r="0.7">
            <stop stopColor="#0e3a4d" stopOpacity="0.55" />
            <stop offset="1" stopColor="#0e3a4d" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* sky + ground + atmospheric horizon glow */}
        <rect fill="url(#sky)" height={HORIZON} width="100" x="0" y="0" />
        <rect fill="url(#ground)" height={100 - HORIZON} width="100" x="0" y={HORIZON} />
        <rect fill="url(#horizonGlow)" height="46" width="100" x="0" y={HORIZON - 20} />
        <line className="stroke-cyanSignal/25" strokeWidth="0.4" x1="0" x2="100" y1={HORIZON} y2={HORIZON} />

        {/* receding ground grid */}
        {gridLines.map((wy) => (
          <line className="stroke-slate-300/12" key={`h-${wy}`} strokeWidth="0.35" x1={project(-20, wy).sx} x2={project(120, wy).sx} y1={project(0, wy).sy} y2={project(0, wy).sy} />
        ))}
        {[20, 35, 50, 65, 80].map((wx) => (
          <line className="stroke-slate-300/10" key={`v-${wx}`} strokeWidth="0.3" x1={project(wx, 0).sx} x2={project(wx, 100).sx} y1={project(wx, 0).sy} y2={project(wx, 100).sy} />
        ))}

        {/* road surface + structured lane markings for spatial reference */}
        <path d={roadPath} fill="#0b1a28" stroke="none" />
        {/* solid road edges (curb lines) */}
        <line className="stroke-slate-300/60" strokeWidth="0.6" x1={project(26, 100).sx} x2={project(46, 0).sx} y1={project(26, 100).sy} y2={project(46, 0).sy} />
        <line className="stroke-slate-300/60" strokeWidth="0.6" x1={project(74, 100).sx} x2={project(54, 0).sx} y1={project(74, 100).sy} y2={project(54, 0).sy} />
        {/* outer shoulder / lane-divider lines */}
        <line className="stroke-slate-400/25 [stroke-dasharray:1.5_3]" strokeWidth="0.4" x1={project(38, 100).sx} x2={project(48.5, 0).sx} y1={project(38, 100).sy} y2={project(48.5, 0).sy} />
        <line className="stroke-slate-400/25 [stroke-dasharray:1.5_3]" strokeWidth="0.4" x1={project(62, 100).sx} x2={project(51.5, 0).sx} y1={project(62, 100).sy} y2={project(51.5, 0).sy} />
        {/* center dashed lane */}
        <line className="stroke-slate-100/45 [stroke-dasharray:2.4_3]" strokeWidth="0.6" x1={project(50, 0).sx} x2={project(50, 100).sx} y1={project(50, 0).sy} y2={project(50, 100).sy} />

        {/* dense environment point cloud (memoized) */}
        {controls.showLidar && <EnvironmentCloud />}

        {/* predicted motion corridors */}
        {controls.showPrediction && dynamicRegions.map((region) => <PredictionCorridor key={`pred-${region.id}`} region={region} />)}

        {/* tracked objects (data-driven) */}
        {selectableRegions.map((region) => (
          <RegionMarker key={region.id} onSelect={setSelectedRegionId} region={region} selected={controls.selectedRegionId === region.id} />
        ))}

        {/* our vehicle -- "you are here" (rear view) */}
        <g>
          <motion.g animate={{ opacity: [1, 0.82, 1] }} transition={{ duration: 2, repeat: Infinity }}>
            {/* forward sensor / heading cone */}
            <path d="M 50 90 L 41 78 A 11 11 0 0 1 59 78 Z" fill="#22d3ee" fillOpacity="0.08" stroke="#22d3ee" strokeOpacity="0.35" strokeWidth="0.3" />
            {/* car body */}
            <rect x="43" y="90" width="14" height="8.6" rx="2" fill="#22d3ee" fillOpacity="0.9" stroke="#e0f2fe" strokeWidth="0.5" />
            {/* cabin / roof */}
            <path d="M45.2 92.2 L54.8 92.2 L53 95.2 L47 95.2 Z" fill="#07131b" fillOpacity="0.92" />
            {/* rear window */}
            <rect x="46.4" y="90.8" width="7.2" height="1.3" rx="0.4" fill="#cffafe" fillOpacity="0.5" />
            {/* tail lights */}
            <rect x="43.6" y="96.8" width="2" height="1.1" rx="0.3" fill="#f87171" />
            <rect x="54.4" y="96.8" width="2" height="1.1" rx="0.3" fill="#f87171" />
          </motion.g>
          <text fill="#cffafe" fontSize="2.6" fontWeight="800" textAnchor="middle" x="50" y="99.7">
            OUR VEHICLE
          </text>
        </g>
      </svg>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className="control-button flex items-center gap-2"
          onClick={() => setControls((current) => ({ ...current, running: !current.running }))}
          title="Play or pause the perception frame stream"
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
          <span className="font-mono text-cyanSignal">{controls.speed.toFixed(1)}x</span>
        </label>
        <button
          className={`control-button ${controls.showLidar ? "control-button-active" : ""}`}
          onClick={() => setControls((current) => ({ ...current, showLidar: !current.showLidar }))}
          title="Toggle the LiDAR point cloud"
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
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-400" />Terrain</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-sky-400" />Static Infrastructure</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-red-500" />Road Obstacle</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-fuchsia-400" />Dynamic Vehicle</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-uncertain" />Uncertain / Predicted</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-cyanSignal" />Our Vehicle</span>
      </div>
    </div>
  );
}