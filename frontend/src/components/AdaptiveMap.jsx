import { memo, useMemo } from "react";
import { motion } from "framer-motion";
import { Grid3X3, Layers3 } from "lucide-react";
import { RESOLUTION_LEVELS } from "../data/simulationData.js";
import { resolutionLevelFor } from "../api/liveAdapter.js";

// FOVEAMAP-style TOP VIEW: the ego sits at the bottom center, the road runs
// up the frame toward the horizon, and every tracked region is drawn as a
// cluster of resolution cells colored by what it IS (semantic class), with a
// FOVEAMAP-style callout showing this frame's decision. Same props, same data,
// same click-to-inspect behavior as before -- only the presentation changed.

const FUTURE_RADIUS = RESOLUTION_LEVELS.COARSEN.radius; // 9
const FUTURE_STEP = 4.8;

// Deterministic RNG so the roadside greenery point clouds don't shimmer.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Per-region palette keyed on the same semantic class the sidebar uses, so the
// top view color-matches the ego perspective view.
function palette(region) {
  const raw = String(region.semanticClass ?? region.objectClass ?? "").toLowerCase();
  if (region.kind === "dynamic") {
    if (/vehicle|car|truck|bus|motorcycle|bicycle/.test(raw)) return "#f472b6"; // pink vehicle
    return "#fb923c"; // orange pedestrian
  }
  if (region.kind === "uncertain") return "#f59e0b"; // amber
  if (region.kind === "static") {
    if (/obstacle|barrier/.test(raw)) return "#ef4444"; // red road barrier / hazard
    if (/structure|building|facade/.test(raw)) return "#38bdf8"; // blue building
    return "#2dd4bf"; // teal boundary / curb
  }
  return "#64748b"; // low value / empty road
}

// Fill opacity scales with the decision so REFINE reads brightest.
function decisionAlpha(decision) {
  if (decision === "REFINE") return { fill: 0.26, stroke: 1 };
  if (decision === "MAINTAIN") return { fill: 0.13, stroke: 0.72 };
  return { fill: 0.05, stroke: 0.4 };
}

function baseCells() {
  const cells = [];
  for (let y = 0; y < 100; y += RESOLUTION_LEVELS.COARSEN.gridStep) {
    for (let x = 0; x < 100; x += RESOLUTION_LEVELS.COARSEN.gridStep) {
      cells.push({ id: `base-${x}-${y}`, x, y, size: RESOLUTION_LEVELS.COARSEN.gridStep });
    }
  }
  return cells;
}

function regionCells(region, predictionEnabled) {
  const cells = [];
  const level = resolutionLevelFor(region.resolution);
  const step = level.gridStep;
  const radius = level.radius;
  const { x: centerX, y: centerY } = region.currentPosition;
  const color = palette(region);
  const alpha = decisionAlpha(region.decision);

  if (step >= radius) {
    cells.push({
      id: `${region.id}-coarse`,
      x: centerX - step / 2,
      y: centerY - step / 2,
      size: Math.max(2.4, step - 0.45),
      regionId: region.id,
      color,
      alpha,
    });
  }

  for (let y = centerY - radius; y < centerY + radius; y += step) {
    for (let x = centerX - radius; x < centerX + radius; x += step) {
      if (Math.hypot(x - centerX, y - centerY) < radius) {
        cells.push({
          id: `${region.id}-${x.toFixed(1)}-${y.toFixed(1)}`,
          x,
          y,
          size: Math.max(2.4, step - 0.45),
          regionId: region.id,
          color,
          alpha,
        });
      }
    }
  }

  if (predictionEnabled && region.kind === "dynamic") {
    const { x: futureX, y: futureY } = region.futurePosition;
    for (let y = futureY - FUTURE_RADIUS; y < futureY + FUTURE_RADIUS; y += FUTURE_STEP) {
      for (let x = futureX - FUTURE_RADIUS; x < futureX + FUTURE_RADIUS; x += FUTURE_STEP) {
        if (Math.hypot(x - futureX, y - futureY) < FUTURE_RADIUS) {
          cells.push({
            id: `${region.id}-future-${x.toFixed(1)}-${y.toFixed(1)}`,
            x,
            y,
            size: 4.25,
            regionId: region.id,
            color: "#67e8f9",
            alpha: { fill: 0.12, stroke: 0.6 },
            future: true,
          });
        }
      }
    }
  }

  return cells;
}

// Roadside greenery point clouds -- ambient, deterministic, memoized so they
// don't rebuild on every simulation frame.
function buildGreenery() {
  const rng = mulberry32(770411);
  const clusters = [
    { cx: 14, cy: 26 }, { cx: 86, cy: 30 }, { cx: 12, cy: 58 },
    { cx: 88, cy: 62 }, { cx: 16, cy: 84 }, { cx: 84, cy: 88 },
  ];
  const pts = [];
  clusters.forEach((c, ci) => {
    for (let i = 0; i < 46; i += 1) {
      const ang = rng() * Math.PI * 2;
      const rad = Math.pow(rng(), 0.6) * 5.5;
      pts.push({
        id: `g-${ci}-${i}`,
        x: c.cx + Math.cos(ang) * rad,
        y: c.cy + Math.sin(ang) * rad * 0.8,
        r: 0.55 + rng() * 0.5,
      });
    }
  });
  return pts;
}

const Greenery = memo(function Greenery() {
  const pts = useMemo(buildGreenery, []);
  return (
    <g>
      {pts.map((p) => (
        <circle cx={p.x} cy={p.y} fill="#22c55e" fillOpacity="0.5" key={p.id} r={p.r} />
      ))}
    </g>
  );
});

export default function AdaptiveMap({ onSelectRegion, predictionEnabled = true, regions, resolutionLevels, selectedRegionId, title = "Adaptive 2.5D Map (Top View)" }) {
  const grid = baseCells();
  const objectCells = regions.flatMap((region) => regionCells(region, predictionEnabled));

  const [coarse, medium, fine] = resolutionLevels?.length === 3 ? resolutionLevels : [0.5, 0.2, 0.05];
  const cm = (metres) => `${Math.round(metres * 100)} cm`;

  return (
    <div className="panel">
      <div className="section-title">
        <Layers3 size={16} />
        {title}
      </div>

      {/* top legend row, FOVEAMAP style */}
      <div className="mb-2 flex flex-wrap gap-3 text-[11px] font-semibold text-slate-400">
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-slate-500" />Coarse (50 cm)</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-sky-400" />Static</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-red-500" />Obstacle</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-fuchsia-400" />Dynamic</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-uncertain" />Uncertain</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-cyanSignal" />Fine / ROI</span>
      </div>

      <p className="mb-2 text-[11px] leading-snug text-slate-500">
        Top-down view from above the ego. Each box is one grid cell at its allocated resolution — bigger box = coarser
        = cheaper. Colored clusters are tracked objects; the label is that region&apos;s decision{" "}
        <span className="text-slate-400">this frame</span>. Click any cell or dot to inspect it on the right.
      </p>

      <svg className="aspect-[1/0.86] w-full rounded-md border border-line bg-slate-950" viewBox="0 0 100 100">
        <defs>
          <marker id="predArrow" markerHeight="4" markerWidth="4" orient="auto" refX="2" refY="2">
            <path d="M0 0 L4 2 L0 4 Z" fill="#67e8f9" />
          </marker>
        </defs>

        <rect className="fill-[#060f18]" height="100" width="100" x="0" y="0" />

        {/* road corridor running up the frame toward the horizon */}
        <path d="M40 2 L60 2 L74 100 L26 100 Z" fill="#0a1826" stroke="#334155" strokeOpacity="0.35" strokeWidth="0.4" />
        {/* dashed center lane */}
        <line className="stroke-slate-200/30 [stroke-dasharray:2.6_3.4]" strokeWidth="0.6" x1="50" x2="50" y1="4" y2="100" />

        {/* faint base grid */}
        {grid.map((cell) => (
          <rect className="fill-transparent stroke-slate-500/15" height={cell.size} key={cell.id} width={cell.size} x={cell.x} y={cell.y} />
        ))}

        {/* ambient roadside greenery */}
        <Greenery />

        {/* resolution cells per region */}
        {objectCells.map((cell) => (
          <motion.rect
            animate={{ opacity: 1, scale: 1 }}
            className="cursor-pointer transition-colors"
            fill={cell.color}
            fillOpacity={cell.alpha.fill}
            height={cell.size}
            initial={{ opacity: 0.35, scale: 0.92 }}
            key={cell.id}
            onClick={() => cell.regionId && onSelectRegion(cell.regionId)}
            rx={cell.future ? 0.6 : 0}
            stroke={cell.color}
            strokeDasharray={cell.future ? "1.2 1" : undefined}
            strokeOpacity={cell.alpha.stroke}
            strokeWidth={cell.future ? 0.3 : 0.4}
            transition={{ duration: 0.38 }}
            width={cell.size}
            x={cell.x}
            y={cell.y}
          />
        ))}

        {/* prediction corridor arrows */}
        {predictionEnabled &&
          regions
            .filter((region) => region.kind === "dynamic")
            .map((region) => (
              <line
                key={`arrow-${region.id}`}
                markerEnd="url(#predArrow)"
                stroke="#67e8f9"
                strokeDasharray="2 1.6"
                strokeOpacity="0.75"
                strokeWidth="0.6"
                x1={region.currentPosition.x}
                x2={region.futurePosition.x}
                y1={region.currentPosition.y}
                y2={region.futurePosition.y}
              />
            ))}

        {/* region centers + FOVEAMAP-style callout labels */}
        {regions.map((region) => {
          const color = palette(region);
          const { x, y } = region.currentPosition;
          const selected = selectedRegionId === region.id;
          const labelW = Math.max(16, region.name.length * 1.2);
          const labelX = Math.min(88, Math.max(labelW / 2 + 1, x));
          const labelY = Math.max(9, y - 6.5);
          return (
            <g className="cursor-pointer" key={region.id} onClick={() => onSelectRegion(region.id)}>
              <line stroke={color} strokeOpacity="0.5" strokeWidth="0.3" x1={x} x2={labelX} y1={y} y2={labelY + 3} />
              <rect fill="#060f18" height="5" rx="0.8" stroke={color} strokeOpacity="0.8" strokeWidth="0.35" width={labelW} x={labelX - labelW / 2} y={labelY - 2} />
              <text className="font-bold [paint-order:stroke] [stroke:rgba(0,0,0,0.6)] [stroke-width:0.35]" fill="#e6f6ff" fontSize="2.1" textAnchor="middle" x={labelX} y={labelY}>
                {region.name}
              </text>
              <text fill={color} fontSize="1.9" fontWeight="700" textAnchor="middle" x={labelX} y={labelY + 2.1}>
                {region.decision}
              </text>
              <circle cx={x} cy={y} fill={color} r={selected ? 2.2 : 1.5} stroke="#e6f6ff" strokeOpacity={selected ? 0.9 : 0.4} strokeWidth={selected ? 0.5 : 0.25} />
            </g>
          );
        })}

        {/* our vehicle at bottom center (top-down) */}
        <g>
          {/* forward sensor / heading cone toward the horizon */}
          <path d="M50 92 L44 80 A 7 7 0 0 1 56 80 Z" fill="#22d3ee" fillOpacity="0.08" stroke="#22d3ee" strokeOpacity="0.4" strokeWidth="0.3" />
          {/* car body top-down */}
          <rect x="46.6" y="91.5" width="6.8" height="7.5" rx="1.4" fill="#22d3ee" fillOpacity="0.9" stroke="#e0f2fe" strokeWidth="0.4" />
          {/* windshield (front) */}
          <rect x="47.4" y="92.3" width="5.2" height="1.7" rx="0.4" fill="#07131b" fillOpacity="0.85" />
          {/* roof */}
          <rect x="47.7" y="94.4" width="4.6" height="2.4" rx="0.4" fill="#0a1a24" fillOpacity="0.7" />
          <text fill="#cffafe" fontSize="2.2" fontWeight="800" textAnchor="middle" x="50" y="90.4">
            OUR VEHICLE
          </text>
        </g>
      </svg>

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-md border border-line bg-slate-950/60 p-2">
          <Grid3X3 className="mb-1 text-slate-400" size={14} />
          <b>{cm(coarse)}</b>
          <span className="block text-slate-500">COARSE</span>
        </div>
        <div className="rounded-md border border-emerald-400/30 bg-emerald-400/10 p-2">
          <Grid3X3 className="mb-1 text-emerald-300" size={14} />
          <b>{cm(medium)}</b>
          <span className="block text-slate-500">MEDIUM</span>
        </div>
        <div className="rounded-md border border-cyanSignal/40 bg-cyanSignal/10 p-2">
          <Grid3X3 className="mb-1 text-cyanSignal" size={14} />
          <b>{cm(fine)}</b>
          <span className="block text-slate-500">FINE</span>
        </div>
      </div>
    </div>
  );
}