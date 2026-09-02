import { motion } from "framer-motion";
import { Grid3X3, Layers3 } from "lucide-react";
import { RESOLUTION_LEVELS } from "../data/simulationData.js";

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
  const step = region.resolution.gridStep;
  const radius = region.resolution.radius;
  const { x: centerX, y: centerY } = region.currentPosition;

  for (let y = centerY - radius; y < centerY + radius; y += step) {
    for (let x = centerX - radius; x < centerX + radius; x += step) {
      if (Math.hypot(x - centerX, y - centerY) < radius) {
        cells.push({
          id: `${region.id}-${x.toFixed(1)}-${y.toFixed(1)}`,
          x,
          y,
          size: Math.max(2.4, step - 0.45),
          regionId: region.id,
          className:
            region.decision === "REFINE"
              ? "stroke-cyanSignal/80 fill-cyanSignal/15"
              : region.decision === "MAINTAIN"
                ? "stroke-emerald-400/65 fill-emerald-400/10"
                : "stroke-slate-500/25 fill-slate-500/5",
        });
      }
    }
  }

  if (predictionEnabled && region.kind === "dynamic") {
    const { x: futureX, y: futureY } = region.futurePosition;
    for (let y = futureY - 9; y < futureY + 9; y += 4.8) {
      for (let x = futureX - 9; x < futureX + 9; x += 4.8) {
        if (Math.hypot(x - futureX, y - futureY) < 9) {
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

export default function AdaptiveMap({ onSelectRegion, predictionEnabled = true, regions, selectedRegionId, title = "Adaptive 2.5D Map" }) {
  const cells = [...baseCells(), ...regions.flatMap((region) => regionCells(region, predictionEnabled))];

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
          <b>50 cm</b>
          <span className="block text-slate-500">COARSE</span>
        </div>
        <div className="rounded-md border border-emerald-400/30 bg-emerald-400/10 p-2">
          <Grid3X3 className="mb-1 text-emerald-300" size={14} />
          <b>20 cm</b>
          <span className="block text-slate-500">MEDIUM</span>
        </div>
        <div className="rounded-md border border-cyanSignal/40 bg-cyanSignal/10 p-2">
          <Grid3X3 className="mb-1 text-cyanSignal" size={14} />
          <b>5 cm</b>
          <span className="block text-slate-500">FINE</span>
        </div>
      </div>
    </div>
  );
}
