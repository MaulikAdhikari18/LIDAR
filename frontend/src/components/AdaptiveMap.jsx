import { motion } from "framer-motion";
import { Layers3 } from "lucide-react";
import { RESOLUTION_LEVELS } from "../data/simulationData.js";
import { resolutionLevelFor } from "../api/liveAdapter.js";

// Same trapezoid FOV frame the app has always used (sensor near y=100,
// widening away from y=0), just given a radar-cone paint job. Region
// positions are already calibrated to this 0-100 space, so none of the
// placement math below changes -- only how it's drawn.
const FUTURE_RADIUS = RESOLUTION_LEVELS.COARSEN.radius; // 9
const FUTURE_STEP = 4.8;
const SENSOR = { x: 44.5, y: 100 };

// Fixed, hand-placed rather than Math.random() so they don't reshuffle (and
// visually "flicker") on every re-render -- purely decorative background
// texture, matching the mockup's scattered dot field.
const AMBIENT_DOTS = [
  { id: 1, x: 30, y: 12, r: 0.5, color: "#22d3ee", opacity: 0.7 },
  { id: 2, x: 36, y: 18, r: 0.7, color: "#a855f7", opacity: 0.65 },
  { id: 3, x: 33, y: 15, r: 0.35, color: "#67e8f9", opacity: 0.55 },
  { id: 4, x: 41, y: 24, r: 0.5, color: "#f472b6", opacity: 0.7 },
  { id: 5, x: 38, y: 22, r: 0.5, color: "#93c5fd", opacity: 0.5 },
  { id: 6, x: 44, y: 28, r: 0.35, color: "#a5b4fc", opacity: 0.6 },
  { id: 7, x: 46, y: 45, r: 0.5, color: "#a855f7", opacity: 0.6 },
  { id: 8, x: 48, y: 50, r: 0.4, color: "#22d3ee", opacity: 0.7 },
  { id: 9, x: 52, y: 58, r: 0.5, color: "#67e8f9", opacity: 0.7 },
  { id: 10, x: 40, y: 62, r: 0.4, color: "#c084fc", opacity: 0.55 },
  { id: 11, x: 47, y: 40, r: 0.35, color: "#f9a8d4", opacity: 0.65 },
  { id: 12, x: 43, y: 34, r: 0.7, color: "#818cf8", opacity: 0.6 },
];

function baseCells() {
  const cells = [];
  for (let y = 0; y < 100; y += RESOLUTION_LEVELS.COARSEN.gridStep) {
    for (let x = 0; x < 100; x += RESOLUTION_LEVELS.COARSEN.gridStep) {
      cells.push({ id: `base-${x}-${y}`, x, y, size: RESOLUTION_LEVELS.COARSEN.gridStep, className: "stroke-slate-600/20 fill-transparent" });
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

  const cellClass =
    region.decision === "REFINE"
      ? "stroke-cyan-300/90 fill-cyan-400/20"
      : region.decision === "MAINTAIN"
        ? "stroke-emerald-400/70 fill-emerald-400/12"
        : "stroke-indigo-400/40 fill-indigo-500/10";

  // See mapping notes elsewhere in the app: COARSE's gridStep (20) exceeds
  // its radius (9), so the sampling loop below never places a point inside
  // the disc for coarse regions -- draw the one big cell explicitly instead.
  if (step >= radius) {
    cells.push({
      id: `${region.id}-coarse`,
      x: centerX - step / 2,
      y: centerY - step / 2,
      size: Math.max(2.4, step - 0.45),
      regionId: region.id,
      className: cellClass,
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
          className: cellClass,
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
            className: "stroke-amber-200/70 fill-amber-200/10",
          });
        }
      }
    }
  }

  return cells;
}

// Live region ids are `track-<n>` / `r-<i>-<j>`, and objectClass/semanticClass
// carry the real label -- branch on that rather than a hardcoded id.
function classifyDynamic(region) {
  const raw = String(region.objectClass ?? region.semanticClass ?? "").toLowerCase();
  const isVehicle = /vehicle|car|truck|bus|motorcycle|bicycle/.test(raw);
  const isPerson = /human|pedestrian|person|rider/.test(raw);
  const fallback = region.objectClass ? region.objectClass.charAt(0).toUpperCase() + region.objectClass.slice(1) : "Object";
  return { isVehicle, label: isVehicle ? "Vehicle" : isPerson ? "Pedestrian" : fallback };
}

const MAX_ARROW = 14;
function velocityArrow(region) {
  const dx = region.futurePosition.x - region.currentPosition.x;
  const dy = region.futurePosition.y - region.currentPosition.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-3) return { dx: 0, dy: 0 };
  const capped = Math.min(length, MAX_ARROW);
  return { dx: (dx / length) * capped, dy: (dy / length) * capped };
}

function DynamicObject({ isSelected, onSelect, region }) {
  const { isVehicle, label } = classifyDynamic(region);
  const position = region.currentPosition;
  const arrow = velocityArrow(region);
  // Labels default to the right of the marker, but that runs off the SVG's
  // right edge (viewBox clips overflow) for anything near x > 75 -- flip the
  // anchor and offset so the label stays inside the frame instead of
  // silently truncating mid-word.
  const flip = position.x > 75;
  const labelX = flip ? position.x - 5 : position.x + 5;
  const labelAnchor = flip ? "end" : "start";
  const badgeX = flip ? position.x - 5 - 19 : position.x + 5;

  return (
    <motion.g animate={{ opacity: 1 }} className="cursor-pointer" initial={{ opacity: 0 }} onClick={() => onSelect(region.id)}>
      <motion.circle
        animate={{ r: isVehicle ? [5.6, 6.4, 5.6] : [4.1, 4.9, 4.1], opacity: [0.95, 0.45, 0.95] }}
        className="fill-transparent stroke-cyan-300"
        cx={position.x}
        cy={position.y}
        strokeWidth={isSelected ? "0.8" : "0.45"}
        transition={{ duration: 1.5, repeat: Infinity }}
      />
      {isVehicle ? (
        <rect className="fill-sky-400 stroke-white/80" height="5.4" rx="1.1" width="9.6" x={position.x - 4.8} y={position.y - 2.7} />
      ) : (
        <circle className="fill-amber-300 stroke-white/80" cx={position.x} cy={position.y} r="2.35" />
      )}
      <path className="fill-none stroke-cyan-300" d={`M ${position.x} ${position.y} l ${arrow.dx} ${arrow.dy}`} strokeWidth="0.75" />
      <text className="fill-cyan-50 text-[3px] [paint-order:stroke] [stroke:rgba(0,0,0,0.6)] [stroke-width:0.45]" textAnchor={labelAnchor} x={labelX} y={position.y - 5}>
        {`${label} ${region.speedMps.toFixed(1)}m/s`}
      </text>
      {isSelected && (
        <rect
          className="fill-cyan-950/90 stroke-cyan-400/80"
          height="4.4"
          rx="1"
          strokeWidth="0.3"
          width="19"
          x={badgeX}
          y={position.y - 12}
        />
      )}
      {isSelected && (
        <text className="fill-cyan-300 text-[2.6px] font-bold uppercase tracking-wide" textAnchor={flip ? "end" : "start"} x={flip ? badgeX + 17.8 : badgeX + 1.2} y={position.y - 8.9}>
          {region.decision}
        </text>
      )}
    </motion.g>
  );
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
        className="fill-none stroke-amber-300/70 [stroke-dasharray:2_1.5]"
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

export default function AdaptiveMap({ onSelectRegion, predictionEnabled = true, regions, resolutionLevels, selectedRegionId }) {
  const cells = [...baseCells(), ...regions.flatMap((region) => regionCells(region, predictionEnabled))];
  const dynamicRegions = regions.filter((region) => region.kind === "dynamic");
  const [coarse, medium, fine] = resolutionLevels?.length === 3 ? resolutionLevels : [0.5, 0.2, 0.05];
  const cm = (metres) => `${Math.round(metres * 100)} cm`;

  return (
    <section className="relative flex flex-col justify-between overflow-hidden rounded-2xl border border-indigo-900/70 bg-[#090e24] p-4 shadow-2xl" data-purpose="radar-foveated-map">
      <div className="z-10 flex items-baseline space-x-2">
        <Layers3 className="text-cyan-400" size={14} />
        <h2 className="text-sm font-semibold tracking-wide text-white">Foveated map</h2>
        <span className="text-[11px] text-slate-400">Fine near the vehicle, coarse further out, budget-allocated by utility</span>
      </div>

      <svg className="my-2 aspect-[1/0.86] w-full rounded-md border border-line bg-slate-950" viewBox="0 0 100 100">
        <defs>
          <linearGradient id="futureCorridor" x1="0" x2="1">
            <stop stopColor="#22d3ee" stopOpacity="0.28" />
            <stop offset="1" stopColor="#f59e0b" stopOpacity="0.05" />
          </linearGradient>
          <radialGradient cx="50%" cy="100%" id="radarCone" r="85%">
            <stop offset="0%" stopColor="#00f2fe" stopOpacity="0.32" />
            <stop offset="45%" stopColor="#05d5b3" stopOpacity="0.14" />
            <stop offset="80%" stopColor="#0e142e" stopOpacity="0" />
          </radialGradient>
          <clipPath id="fovClip">
            <path d="M13 0 L43 0 L61 100 L28 100 Z" />
          </clipPath>
        </defs>

        <rect className="fill-[#081018]" height="100" width="100" />
        <path className="fill-slate-900/50 stroke-slate-400/10" d="M13 0 L43 0 L61 100 L28 100 Z" />

        <g clipPath="url(#fovClip)">
          <rect fill="url(#radarCone)" height="100" width="100" />
          {/* Ambient particle glow, matching the mockup's scattered background
              dots -- purely decorative, drawn once per mount rather than
              re-seeded every render so it doesn't flicker on each poll. */}
          {AMBIENT_DOTS.map((dot) => (
            <circle cx={dot.x} cy={dot.y} fill={dot.color} key={dot.id} opacity={dot.opacity} r={dot.r} />
          ))}
          {/* Spokes fanning from the sensor read as a perspective floor grid
              once clipped to the FOV wedge, echoing the mockup's 3D-tilted
              ground plane without an actual CSS 3D transform (which would be
              awkward to keep aligned with region coordinates in SVG space). */}
          {[-70, -52, -34, -17, 0, 17, 34, 52, 70].map((deg) => {
            const rad = ((deg - 90) * Math.PI) / 180;
            return (
              <line
                key={deg}
                stroke="#2a3b68"
                strokeOpacity="0.4"
                strokeWidth="0.25"
                x1={SENSOR.x}
                x2={SENSOR.x + Math.cos(rad) * 95}
                y1={SENSOR.y}
                y2={SENSOR.y + Math.sin(rad) * 95}
              />
            );
          })}
          {[25, 50, 75, 95].map((r) => (
            <circle cx={SENSOR.x} cy={SENSOR.y} fill="none" key={r} r={r} stroke="#2a3b68" strokeDasharray={r === 95 ? "0" : "1.4 1.4"} strokeOpacity="0.55" strokeWidth="0.3" />
          ))}
        </g>

        {cells.map((cell) => (
          <motion.rect
            animate={{ opacity: 1, scale: 1 }}
            className={`${cell.className} cursor-pointer transition-colors`}
            height={cell.size}
            initial={{ opacity: 0.35, scale: 0.92 }}
            key={cell.id}
            onClick={() => cell.regionId && onSelectRegion(cell.regionId)}
            rx={cell.regionId ? "0.6" : "0"}
            transition={{ duration: 0.38 }}
            width={cell.size}
            x={cell.x}
            y={cell.y}
          />
        ))}

        {predictionEnabled && dynamicRegions.map((region) => <PredictionCorridor key={`corridor-${region.id}`} region={region} />)}

        {regions
          .filter((region) => region.kind !== "dynamic")
          .map((region) => (
            <circle
              className={region.decision === "REFINE" ? "fill-cyan-300" : region.decision === "MAINTAIN" ? "fill-emerald-400" : "fill-indigo-300"}
              cx={region.currentPosition.x}
              cy={region.currentPosition.y}
              key={region.id}
              r={selectedRegionId === region.id ? 2.2 : 1.3}
            />
          ))}

        {dynamicRegions.map((region) => (
          <DynamicObject isSelected={selectedRegionId === region.id} key={region.id} onSelect={onSelectRegion} region={region} />
        ))}

        <g transform={`translate(${SENSOR.x},${SENSOR.y})`}>
          <path className="fill-cyan-400" d="M -3.2 0 L 0 -6 L 3.2 0 Z" style={{ filter: "drop-shadow(0 0 3px rgba(0,242,254,0.9))" }} />
          <text className="fill-slate-300 text-[2.4px] font-bold tracking-widest" textAnchor="middle" x="0" y="3.4">
            SENSOR
          </text>
        </g>
      </svg>

      <footer className="flex items-center justify-between border-t border-slate-800/80 px-2 pt-2 font-mono text-[11px] text-slate-400" data-purpose="map-legend">
        <div className="flex items-center space-x-4">
          <span className="flex items-center space-x-1.5"><span className="h-2 w-2 rounded-full bg-rose-500" />dynamic object</span>
          <span className="flex items-center space-x-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-dashed border-amber-300" />predicted position</span>
        </div>
        <div className="flex items-center gap-3">
          <span>{cm(coarse)} coarse</span>
          <span className="text-emerald-300">{cm(medium)} medium</span>
          <span className="text-cyan-300">{cm(fine)} fine</span>
        </div>
        <div className="cursor-pointer text-slate-400 hover:text-slate-200">click a cell to inspect</div>
      </footer>
    </section>
  );
}