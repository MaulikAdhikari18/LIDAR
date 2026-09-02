import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import MetricCard from "../components/MetricCard.jsx";
import { buildBudgetHistory } from "../utils/utilityCalculation.js";

const COLORS = ["#22d3ee", "#22c55e", "#f59e0b", "#94a3b8", "#38bdf8", "#ef4444"];
const DEFAULT_LEVELS = [0.5, 0.2, 0.05];

const cm = (metres) => `${Math.round(metres * 100)} cm`;

// What it would cost to cover the same ground uniformly at the finest level:
// one 20 cm cell is (0.20/0.05)^2 = 16 fine cells, one 50 cm cell is 100. This
// is the actual saving the adaptive grid buys, computed from the backend's own
// per-level cell counts rather than the hardcoded "38%" the page used to show.
function memorySaved(metrics, levels) {
  const [coarse, medium, fine] = levels;
  const fineCells = metrics.fine_cells ?? 0;
  const mediumCells = metrics.medium_cells ?? 0;
  const coarseCells = metrics.coarse_cells ?? 0;
  const actual = fineCells + mediumCells + coarseCells;
  if (!actual) return null;

  const uniform =
    fineCells +
    mediumCells * Math.pow(medium / fine, 2) +
    coarseCells * Math.pow(coarse / fine, 2);
  if (uniform <= actual) return null;
  return Math.round((1 - actual / uniform) * 100);
}

export default function BudgetAnalytics({
  controls,
  isLive,
  liveHistory,
  liveMetrics,
  regions,
  resolutionLevels,
  thresholds,
  time,
}) {
  const levels = resolutionLevels?.length === 3 ? resolutionLevels : DEFAULT_LEVELS;
  const [coarseM, mediumM, fineM] = levels;
  const useLiveHistory = Boolean(liveHistory?.length);

  // buildBudgetHistory runs calculateFrame 16 times, so it was re-running 16
  // full frame computations on every render (~60/s) even when nothing it
  // depends on had changed. Memoized, and skipped entirely in Live mode.
  const simulatedHistory = useMemo(
    () => (useLiveHistory ? [] : buildBudgetHistory(time, { predictionEnabled: controls.showPrediction })),
    [useLiveHistory, time, controls.showPrediction],
  );

  const utilityData = useMemo(
    () => regions.map((region) => ({ name: region.name, utility: Number(region.utility.toFixed(2)) })),
    [regions],
  );
  const cellData = useMemo(
    () => regions.map((region) => ({ name: region.name, cells: region.cellsAllocated })),
    [regions],
  );

  // In Live mode the backend counts cells per resolution level across the whole
  // map, which is the real distribution. Falling back to bucketing the 8
  // displayed regions by their pending decision only makes sense for the
  // simulation, where those six regions ARE the whole map.
  const resolutionData = useMemo(() => {
    if (isLive && liveMetrics) {
      return [
        { name: `Fine ${cm(fineM)}`, value: liveMetrics.fine_cells ?? 0 },
        { name: `Medium ${cm(mediumM)}`, value: liveMetrics.medium_cells ?? 0 },
        { name: `Coarse ${cm(coarseM)}`, value: liveMetrics.coarse_cells ?? 0 },
      ];
    }
    return [
      { name: `Fine ${cm(fineM)}`, value: regions.filter((r) => r.decision === "REFINE").reduce((sum, r) => sum + r.cellsAllocated, 0) },
      { name: `Medium ${cm(mediumM)}`, value: regions.filter((r) => r.decision === "MAINTAIN").reduce((sum, r) => sum + r.cellsAllocated, 0) },
      { name: `Coarse ${cm(coarseM)}`, value: regions.filter((r) => r.decision === "COARSEN").reduce((sum, r) => sum + r.cellsAllocated, 0) },
    ];
  }, [isLive, liveMetrics, regions, coarseM, mediumM, fineM]);

  const savedPercent = isLive && liveMetrics ? memorySaved(liveMetrics, levels) : null;
  const refineThreshold = thresholds?.refine ?? 1.8;

  return (
    <section className="grid gap-4 xl:grid-cols-4">
      <div className="panel xl:col-span-2">
        <div className="section-title">
          {useLiveHistory ? "Live Cell Count Per Resolution Level" : "Computational Budget Allocation Over Time"}
        </div>
        <p className="mb-2 text-xs text-slate-500">
          {useLiveHistory
            ? `Real backend metrics, one point per processed frame. Fine cells rising while coarse cells fall is the foveation actually happening.`
            : "Simulated allocation across the six demo regions."}
        </p>
        <div className="h-[300px]">
          <ResponsiveContainer height="100%" width="100%">
            {useLiveHistory ? (
              <AreaChart data={liveHistory}>
                <CartesianGrid stroke="rgba(148,163,184,0.12)" />
                <XAxis dataKey="label" stroke="#64748b" />
                <YAxis stroke="#64748b" />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.25)", color: "#e5eef7" }}
                  labelFormatter={(label) => `Frame ${label}`}
                />
                <Area dataKey="Coarse" fill="#94a3b8" fillOpacity={0.16} stackId="1" stroke="#94a3b8" />
                <Area dataKey="Medium" fill="#22c55e" fillOpacity={0.2} stackId="1" stroke="#22c55e" />
                <Area dataKey="Fine" fill="#22d3ee" fillOpacity={0.28} stackId="1" stroke="#22d3ee" />
              </AreaChart>
            ) : (
              <AreaChart data={simulatedHistory}>
                <CartesianGrid stroke="rgba(148,163,184,0.12)" />
                <XAxis dataKey="label" stroke="#64748b" />
                <YAxis stroke="#64748b" />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.25)", color: "#e5eef7" }} />
                <Area dataKey="Pedestrian" fill="#22d3ee" fillOpacity={0.25} stroke="#22d3ee" />
                <Area dataKey="Vehicle" fill="#22c55e" fillOpacity={0.2} stroke="#22c55e" />
                <Area dataKey="Terrain" fill="#f59e0b" fillOpacity={0.18} stroke="#f59e0b" />
                <Area dataKey="RoadEdge" fill="#94a3b8" fillOpacity={0.16} stroke="#94a3b8" />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
        {isLive && !useLiveHistory && (
          <p className="text-xs text-amber-300">Collecting live frames — the timeline fills as frames are processed.</p>
        )}
      </div>

      <div className="panel">
        <div className="section-title">Utility Score Per Region</div>
        <div className="h-[300px]">
          <ResponsiveContainer height="100%" width="100%">
            <BarChart data={utilityData} layout="vertical">
              <XAxis hide type="number" />
              <YAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 11 }} type="category" width={92} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.25)" }} />
              <Bar dataKey="utility" fill="#22d3ee" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel">
        <div className="section-title">{isLive ? "Budget Share Per Region" : "Cells Allocated Per Region"}</div>
        <div className="h-[300px]">
          <ResponsiveContainer height="100%" width="100%">
            <BarChart data={cellData} layout="vertical">
              <XAxis hide type="number" />
              <YAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 11 }} type="category" width={92} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.25)" }} />
              <Bar dataKey="cells" fill="#22c55e" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel">
        <div className="section-title">Resolution Distribution</div>
        <p className="mb-1 text-xs text-slate-500">
          {isLive ? "Every active cell in the map, counted by the backend." : "The six demo regions, bucketed by pending decision."}
        </p>
        <div className="h-[260px]">
          <ResponsiveContainer height="100%" width="100%">
            <PieChart>
              <Pie data={resolutionData} dataKey="value" innerRadius={58} outerRadius={88} paddingAngle={3}>
                {resolutionData.map((entry, index) => (
                  <Cell fill={COLORS[index]} key={entry.name} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.25)" }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <MetricCard
        label={savedPercent === null ? "Estimated memory saved" : `Memory saved vs uniform ${cm(fineM)} grid`}
        tone="green"
        value={savedPercent === null ? "38%" : `${savedPercent}%`}
      />
      <MetricCard label="Refined regions" tone="cyan" value={regions.filter((region) => region.decision === "REFINE").length} />
      <MetricCard label="Coarsened regions" tone="slate" value={regions.filter((region) => region.decision === "COARSEN").length} />
      {/* The simulated and live utility scales differ by roughly 3x, so a single
          hardcoded 1.8 marked every live region as high-utility (or none). */}
      <MetricCard
        label={`Regions above refine threshold (${refineThreshold})`}
        tone="amber"
        value={regions.filter((region) => region.utility > refineThreshold).length}
      />
    </section>
  );
}