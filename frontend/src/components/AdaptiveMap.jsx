import { motion } from "framer-motion";
import { Grid3X3, Layers3 } from "lucide-react";
import { RESOLUTION_LEVELS } from "../data/simulationData.js";
import { resolutionLevelFor } from "../api/liveAdapter.js";

// Future-corridor drawing parameters. Same values as before so Simulated mode
// renders identically; named so they aren't unexplained literals.
const FUTURE_RADIUS = RESOLUTION_LEVELS.COARSEN.radius; // 9
const FUTURE_STEP = 4.8;

function baseCells() {
  const cells = [];
  for (let y = 0; y < 100; y += RESOLUTION_LEVELS.COARSEN.gridStep) {
    for (let x = 0; x < 100; x += RESOLUTION_LEVELS.COARSEN.gridStep) {
      cells.push({ id: `base-${x}-${y}`, x, y, size: RESOLUTION_LEVELS.COARSEN.gridStep, className: "stroke-slate-500/25 fill-transparent" });
    }
  }
  return cells;
}

function regionCells(region, predictionEnabled) {
  const cells = [];
  // resolutionLevelFor() tolerates both the RESOLUTION_LEVELS object the
  // simulation produces and a bare number of meters. Without it, a numeric
  // resolution makes step/radius undefined, the loop bounds become NaN, and
  // `NaN < NaN` is false -- so the grid renders zero cells and throws no
  // error. That silent failure is what blanked the whole map in Live mode.
  const level = resolutionLevelFor(region.resolution);
  const step = level.gridStep;
  const radius = level.radius;
  const { x: centerX, y: centerY } = region.currentPosition;

  const cellClass =
    region.decision === "REFINE"
      ? "stroke-cyanSignal/80 fill-cyanSignal/15"
      : region.decision === "MAINTAIN"
        ? "stroke-emerald-400/65 fill-emerald-400/10"
        : "stroke-slate-500/25 fill-slate-500/5";

  // COARSE has gridStep 20 against radius 9, so the sampling loop below can
  // never place a point inside the disc -- `hypot(-9,-9) = 12.7 > 9` on the
  // only iteration it runs. Every coarse region therefore drew exactly zero
  // cells and was indistinguishable from empty space. That was easy to miss in
  // Simulated mode (few regions sit at COARSE) but dominates Live mode, where
  // the real map is mostly coarse -- 4317 of 5098 active cells on KITTI
  // sequence 00 frame 25.
  //
  // One big square is also the honest picture: a coarse region IS being held as
  // a single large cell, so drawing one cell of gridStep size says exactly that,
  // and the coarse/medium/fine progression reads as one -> several -> many.
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
            className: "stroke-cyan-200/75 fill-cyan-200/12",
          });
        }
      }
    }
  }

  return cells;
}

export default function AdaptiveMap({ onSelectRegion, predictionEnabled = true, regions, resolutionLevels, selectedRegionId, title = "Adaptive 2.5D Map" }) {
  const cells = [...baseCells(), ...regions.flatMap((region) => regionCells(region, predictionEnabled))];

  // Legend reads the resolution ladder actually in force (backend config in
  // Live mode) rather than three hardcoded strings, so it can't claim "5 cm"
  // for a map that is no longer configured that way.
  const [coarse, medium, fine] = resolutionLevels?.length === 3 ? resolutionLevels : [0.5, 0.2, 0.05];
  const cm = (metres) => `${Math.round(metres * 100)} cm`;

  return (
    <div className="panel">
      <div className="section-title">
        <Layers3 size={16} />
        {title}
      </div>
      <svg className="aspect-[1/0.86] w-full rounded-md border border-line bg-slate-950" viewBox="0 0 100 100">
        <rect className="fill-[#081018]" height="100" width="100" />
        <path className="fill-slate-900/60 stroke-slate-400/10" d="M13 0 L43 0 L61 100 L28 100 Z" />

        {cells.map((cell) => (
          <motion.rect
            animate={{ opacity: 1, scale: 1 }}
            className={`${cell.className} cursor-pointer transition-colors`}
            height={cell.size}
            initial={{ opacity: 0.35, scale: 0.92 }}
            key={cell.id}
            onClick={() => cell.regionId && onSelectRegion(cell.regionId)}
            transition={{ duration: 0.38 }}
            width={cell.size}
            x={cell.x}
            y={cell.y}
          />
        ))}

        {regions.map((region) => (
          <g key={region.id}>
            <circle
              className={
                region.decision === "REFINE"
                  ? "fill-cyanSignal"
                  : region.decision === "MAINTAIN"
                    ? "fill-emerald-400"
                    : "fill-slate-400"
              }
              cx={region.currentPosition.x}
              cy={region.currentPosition.y}
              r={selectedRegionId === region.id ? 2.2 : 1.45}
            />
            <text
              className="fill-cyan-50 text-[2.6px] font-bold [paint-order:stroke] [stroke:rgba(0,0,0,0.6)] [stroke-width:0.4]"
              x={region.currentPosition.x + 2}
              y={region.currentPosition.y - 2}
            >
              {region.decision}
            </text>
          </g>
        ))}
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