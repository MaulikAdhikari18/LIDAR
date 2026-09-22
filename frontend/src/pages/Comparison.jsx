import { useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronsDown, Database, Grid3x3, Layers, Lightbulb, Sparkles,
} from "lucide-react";
import {
  getBaseline,
  getRegionDecisions,
  getSameDistanceDemo,
  getWhy25D,
} from "../api/backendClient.js";
import {
  BuildingSprite, BulletCard, CarSprite, CellImportanceLegend, EgoCar, PedestrianSprite,
  PerspectiveCells, ResourceUsageBar, SceneBox, SceneMedia, SignSprite, TruckSprite, linspace,
} from "../components/SceneShowcase.jsx";

// ---------------------------------------------------------------------------
// Static showcase: Conventional distance-based mapping vs. this project's
// predictive adaptive mapping. Both cards reuse the SAME photoreal night
// highway plate (from SceneShowcase.jsx), so the ONLY visible difference is
// the overlay:
//   - Conventional: a uniform perspective grid, color-banded purely by depth.
//   - Predictive:   sparse cell clusters allocated only around what matters.
// ---------------------------------------------------------------------------

// Uniform distance-banded grid: red near, amber mid, green far. Resolution
// changes only with depth (fine near, coarse far) -- never with what's there.
function ConventionalGridOverlay() {
  return (
    <>
      {/* Near band (< 20 m) — HIGH resolution: many small cells */}
      <PerspectiveCells color="#f87171" cols={linspace(0, 1, 10)} fillOpacity={0.16} rows={linspace(0, 0.48, 5)} strokeOpacity={0.5} strokeWidth={0.14} />
      {/* Mid band (20–50 m) — MEDIUM resolution */}
      <PerspectiveCells color="#fbbf24" cols={linspace(0, 1, 6)} fillOpacity={0.18} rows={linspace(0.48, 0.7, 2)} strokeOpacity={0.55} strokeWidth={0.16} />
      {/* Far band (> 50 m) — LOW resolution: a few large cells */}
      <PerspectiveCells color="#34d399" cols={linspace(0, 1, 3)} fillOpacity={0.2} rows={linspace(0.7, 0.93, 1)} strokeOpacity={0.6} strokeWidth={0.2} />
    </>
  );
}

// Draws a rows x cols lattice of fine cells directly over an object's screen
// rectangle (all values in the shared 0..100 space). More rows/cols = higher
// allocated resolution, so a critical (dynamic) object gets a denser grid than
// a low-importance (static) one -- exactly what "adaptive allocation" means.
// (Page-specific: unlike the sprites/backdrop, this one isn't shared with
// Prediction.jsx, so it stays local to this file.)
function ObjectCellGrid({ x, y, w, h, rows, cols, color, fillOpacity = 0.16, strokeOpacity = 0.9, strokeWidth = 0.16 }) {
  const cw = w / cols;
  const ch = h / rows;
  const cells = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      cells.push({ x: x + c * cw, y: y + r * ch });
    }
  }
  return cells.map((cell, i) => (
    <rect
      fill={color}
      fillOpacity={fillOpacity}
      height={ch}
      key={i}
      stroke={color}
      strokeOpacity={strokeOpacity}
      strokeWidth={strokeWidth}
      width={cw}
      x={cell.x}
      y={cell.y}
    />
  ));
}

// Adaptive allocation: almost nothing on empty road (a barely-there coarse
// scatter = "unallocated"), then cell lattices placed ON each detected object.
// Cell density encodes resolution/importance:
//   Pedestrian (near) / Truck -> HIGH   (red, dense fine grid)  [dynamic / critical]
//   Car                       -> MEDIUM (amber, moderate grid)  [relevant object]
//   Building / Sign           -> LOW    (blue, coarse cells)    [static / background]
function AdaptiveGridOverlay() {
  return (
    <>
      {/* unallocated empty regions — barely-there coarse grid on the road */}
      <PerspectiveCells color="#64748b" cols={[0, 0.25, 0.5, 0.75, 1]} fillOpacity={0.03} rows={[0, 0.4, 0.7, 0.9]} strokeOpacity={0.1} strokeWidth={0.08} />

      {/* --- DYNAMIC (high resolution, dense red cells) --- */}
      {/* Truck — high importance, dense fine grid */}
      <ObjectCellGrid color="#f87171" cols={4} h={7} rows={5} w={6.5} x={42.5} y={44} />
      {/* Pedestrian (near) — high importance, dense fine grid */}
      <ObjectCellGrid color="#f87171" cols={2} h={13} rows={6} w={4} x={15} y={60} />

      {/* --- MEDIUM (relevant object, moderate amber cells) --- */}
      {/* Car — relevant, medium-density grid */}
      <ObjectCellGrid color="#fbbf24" cols={3} h={8.5} rows={3} w={8} x={50.5} y={57} />

      {/* --- STATIC (low resolution, coarse blue cells) --- */}
      {/* Building — static, a single coarse cell */}
      <ObjectCellGrid color="#38bdf8" cols={1} h={26} rows={1} w={15} x={78} y={26} />
      {/* Roadside sign — near but static, still gets coarse cells */}
      <ObjectCellGrid color="#38bdf8" cols={1} h={16} rows={2} w={6} x={82} y={63} />
    </>
  );
}

// The Conventional card's equivalent of CellImportanceLegend (used on the
// Predictive card below): explains what the distance-band colors mean here
// -- near/mid/far by fixed thresholds, plus static, rather than by
// importance. Was previously referenced (<ZoneLegendOverlay />) without
// ever being defined, which crashed the whole page the moment this route
// mounted (no error boundary in this app).
function ZoneLegendOverlay() {
  const rows = [
    { color: "#f87171", label: "Near (< 20 m) — high res" },
    { color: "#fbbf24", label: "Mid (20–50 m) — medium res" },
    { color: "#34d399", label: "Far (> 50 m) — low res" },
    { color: "#38bdf8", label: "Static (any distance)" },
  ];
  return (
    <div className="absolute right-2 top-2 rounded-lg border border-line/60 bg-slate-950/85 p-2.5 backdrop-blur-sm">
      <div className="mb-1.5 text-[11px] font-bold text-white">Distance Zone</div>
      <div className="space-y-1">
        {rows.map((r) => (
          <div className="flex items-center gap-1.5 text-[10px] text-slate-300" key={r.label}>
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: r.color }} />
            {r.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function ConventionalCard() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border-2 border-rose-500/40 bg-slate-950">
      <div className="flex items-center justify-between border-b border-rose-500/20 bg-rose-500/5 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-rose-500/15 text-rose-300"><Grid3x3 size={16} /></span>
          <div>
            <div className="text-sm font-bold text-white">Conventional Distance-Based Mapping</div>
            <div className="text-xs text-slate-400">Fixed resolution allocation by distance thresholds</div>
          </div>
        </div>
        <span className="hidden shrink-0 items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[11px] font-bold text-rose-300 sm:flex">
          <Grid3x3 size={12} /> Static Zones
        </span>
      </div>

      <SceneMedia overlay={<ConventionalGridOverlay />}>
        <ZoneLegendOverlay />
        <BuildingSprite cx={85.5} cy={40} w={16} />
        <SignSprite cx={85} cy={71} w={5} />
        <EgoCar />
        <TruckSprite cx={45.75} cy={47.5} w={5.5} />
        <CarSprite cx={54.5} cy={61} w={7} />
        <PedestrianSprite cx={17} cy={66.5} w={3.4} />
        {/* distance-band coloring: far=green, mid=amber, near=red */}
        <SceneBox color="#34d399" h={7} label="Truck" sub="70 m" w={6.5} x={42.5} y={44} />
        <SceneBox color="#fbbf24" h={8.5} label="Car" sub="40 m" w={8} x={50.5} y={57} />
        <SceneBox color="#f87171" h={13} label="Pedestrian" sub="15 m" w={4} x={15} y={60} />
        {/* near static sign — pure distance rule still forces HIGH res */}
        <SceneBox color="#f87171" h={16} label="Sign" sub="8 m" w={6} x={82} y={63} />
        {/* building shown as static (blue) in both views */}
        <SceneBox color="#38bdf8" h={26} label="Building" sub="static" w={15} x={78} y={26} />
      </SceneMedia>

      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <BulletCard
          icon={<AlertTriangle size={14} />}
          items={[
            "Uniform allocation within distance bands",
            "Wastes computation on empty regions",
            "Misses important distant objects",
            "Cannot adapt to scene complexity",
          ]}
          title="Limitations"
          tone="red"
        />
        <ResourceUsageBar note="Higher compute, lower efficiency" pct={88} tone="red" />
      </div>
    </div>
  );
}

function PredictiveCard() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border-2 border-cyanSignal/40 bg-slate-950">
      <div className="flex items-center justify-between border-b border-cyanSignal/20 bg-cyanSignal/5 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-cyanSignal/15 text-cyanSignal"><Layers size={16} /></span>
          <div>
            <div className="text-sm font-bold text-white">Predictive Adaptive 2.5D Mapping</div>
            <div className="text-xs text-slate-400">Adaptive allocation based on scene understanding</div>
          </div>
        </div>
        <span className="hidden shrink-0 items-center gap-1 rounded-full border border-cyanSignal/40 bg-cyanSignal/10 px-2.5 py-1 text-[11px] font-bold text-cyanSignal sm:flex">
          <Sparkles size={12} /> Adaptive Allocation
        </span>
      </div>

      <SceneMedia overlay={<AdaptiveGridOverlay />}>
        <BuildingSprite cx={85.5} cy={40} w={16} />
        <SignSprite cx={85} cy={71} w={5} />
        <EgoCar />
        <TruckSprite cx={45.75} cy={47.5} w={5.5} />
        <CarSprite cx={54.5} cy={61} w={7} />
        <PedestrianSprite cx={17} cy={66.5} w={3.4} />
        {/* dynamic = red / high res */}
        <SceneBox color="#f87171" h={7} label="Truck" sub="70 m" w={6.5} x={42.5} y={44} />
        {/* pedestrian near = red / high res */}
        <SceneBox color="#f87171" h={13} label="Pedestrian" sub="15 m" w={4} x={15} y={60} />
        {/* relevant vehicle = amber / medium res */}
        <SceneBox color="#fbbf24" h={8.5} label="Car" sub="40 m" w={8} x={50.5} y={57} />
        {/* static = blue / low res (building + near roadside sign) */}
        <SceneBox color="#38bdf8" h={26} label="Building" sub="static" w={15} x={78} y={26} />
        <SceneBox color="#38bdf8" h={16} label="Sign" sub="static" w={6} x={82} y={63} />
        <CellImportanceLegend />
      </SceneMedia>

      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <BulletCard
          icon={<CheckCircle2 size={14} />}
          items={[
            "Allocates more cells to important objects",
            "Fewer cells in empty / unimportant areas",
            "Captures distant objects using prediction",
            "Adapts in real-time to scene changes",
            "Better perception with lower compute cost",
          ]}
          title="Key Improvements"
          tone="green"
        />
        <ResourceUsageBar note="Lower compute, higher efficiency" pct={38} tone="cyan" />
      </div>
    </div>
  );
}

function StatChip({ icon, label, tone, value }) {
  const toneClass = tone === "red" ? "bg-rose-500/15 text-rose-300" : "bg-cyanSignal/15 text-cyanSignal";
  const valueClass = tone === "red" ? "text-rose-300" : "text-cyanSignal";
  return (
    <div className="flex items-center gap-2.5">
      <span className={`flex h-9 w-9 items-center justify-center rounded-md ${toneClass}`}>{icon}</span>
      <div>
        <div className="text-xs text-slate-400">{label}</div>
        <div className={`font-mono text-xl font-black ${valueClass}`}>{value}</div>
      </div>
    </div>
  );
}

function ComparisonStatsFooter() {
  return (
    <div className="grid gap-4 rounded-xl border border-line bg-black/20 p-4 md:grid-cols-[1fr_auto_1fr]">
      <div className="flex flex-wrap items-center gap-6">
        <StatChip icon={<Grid3x3 size={16} />} label="Total Grid Cells" tone="red" value="24,000" />
        <StatChip icon={<Database size={16} />} label="Estimated Memory" tone="red" value="120 MB" />
      </div>
      <div className="flex items-center justify-center">
        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-slate-900 text-xs font-black text-slate-400">VS</span>
      </div>
      <div className="flex flex-wrap items-center gap-6 md:justify-end">
        <StatChip icon={<Grid3x3 size={16} />} label="Total Grid Cells" tone="cyan" value="8,400" />
        <StatChip icon={<Database size={16} />} label="Estimated Memory" tone="cyan" value="46 MB" />
        <span className="flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-sm font-black text-emerald-400">
          <ChevronsDown size={14} /> 62%
        </span>
      </div>
    </div>
  );
}

function MappingComparisonShowcase() {
  return (
    <div className="grid gap-4">
      <div className="grid items-stretch gap-4 xl:grid-cols-2">
        <ConventionalCard />
        <PredictiveCard />
      </div>
      <ComparisonStatsFooter />
      <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
        <Lightbulb className="mt-0.5 shrink-0 text-amber-300" size={18} />
        <p className="text-sm text-amber-100">
          <span className="font-bold">Key Insight:</span>{" "}
          Our predictive adaptive mapping focuses computational resources only where they are
          needed, enabling better scene understanding with fewer cells and lower compute cost.
        </p>
      </div>
    </div>
  );
}

// Shared horizontal-bar primitive used by the chart views below (A3, D1, D5,
// D7). Bar width is proportional to `value / max`; `display` is the exact
// number shown at the end of the bar so precision is never lost to the
// visual.
function HBarRow({ color = "#22d3ee", display, label, max, sub, value }) {
  const pct = max > 0 ? Math.min(100, Math.max(3, (value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-44 shrink-0 truncate text-right text-xs text-slate-400" title={label}>{label}</div>
      <div className="relative h-6 flex-1 overflow-hidden rounded bg-slate-900">
        <div className="h-full rounded transition-all" style={{ background: color, width: `${pct}%` }} />
      </div>
      <div className="w-24 shrink-0 font-mono text-xs font-bold text-slate-100">{display}</div>
      {sub && <div className="w-28 shrink-0 text-[10px] uppercase tracking-wide text-slate-500">{sub}</div>}
    </div>
  );
}

const METHOD_COLOR = { distance_based: "#38bdf8", proposed: "#22d3ee", uniform: "#f87171" };
const DECISION_COLOR = { COARSEN: "#f87171", MAINTAIN: "#94a3b8", REFINE: "#34d399" };

// Ring gauge: a single utility value (0..1) as a filled arc, used where two
// or three values need to sit side-by-side as compact dials rather than a
// full-width bar (D1's same-distance probe).
function UtilityGauge({ color = "#22d3ee", label, sub, value }) {
  const r = 32;
  const circumference = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  const dash = pct * circumference;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg height={84} viewBox="0 0 84 84" width={84}>
        <circle cx="42" cy="42" fill="none" r={r} stroke="#1e293b" strokeWidth="9" />
        <circle
          cx="42"
          cy="42"
          fill="none"
          r={r}
          stroke={color}
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeLinecap="round"
          strokeWidth="9"
          transform="rotate(-90 42 42)"
        />
        <text fill="#f1f5f9" fontSize="15" fontWeight="700" textAnchor="middle" x="42" y="47">
          {value.toFixed(3)}
        </text>
      </svg>
      <div className="max-w-[8rem] text-center text-xs text-slate-400" title={label}>{label}</div>
      {sub && <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color }}>{sub}</div>}
    </div>
  );
}

// Area-proportional bubble pair: makes an order-of-magnitude gap (e.g.
// 7,787 vs 43M) *look* like one, instead of a log-scaled bar where both
// ends still read as similar-length rectangles (D5's why-2.5D panel).
function SizeCompareBubbles({ items }) {
  const maxVal = Math.max(...items.map((it) => it.value), 1);
  const maxR = 50;
  const box = maxR * 2 + 16;
  return (
    <div className="flex items-end justify-center gap-10 py-2">
      {items.map((it) => {
        const r = Math.max(8, Math.sqrt(it.value / maxVal) * maxR);
        const cy = box - r - 6;
        return (
          <div className="flex flex-col items-center gap-2" key={it.label}>
            <svg height={box} viewBox={`0 0 ${box} ${box}`} width={box}>
              <line stroke="#1e293b" strokeWidth="1" x1="0" x2={box} y1={box - 3} y2={box - 3} />
              <circle cx={box / 2} cy={cy} fill={it.color} fillOpacity="0.14" r={r} stroke={it.color} strokeWidth="2" />
            </svg>
            <div className="text-center">
              <div className="font-mono text-sm font-bold text-slate-100">{it.display}</div>
              <div className="text-xs text-slate-400">{it.label}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Lollipop row: a thin stem from 0 to value with a dot at the tip, instead
// of a filled bar -- reads as a scatter of five points along one axis
// rather than five stacked rectangles (D7's region-by-region panel).
function LollipopRow({ color = "#22d3ee", display, label, sub, value }) {
  const pct = Math.max(1, Math.min(100, value * 100));
  return (
    <div className="flex items-center gap-3">
      <div className="w-40 shrink-0 truncate text-right text-xs text-slate-400" title={label}>{label}</div>
      <div className="relative h-6 flex-1">
        <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-slate-800" />
        <div className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2" style={{ background: color, opacity: 0.5, width: `${pct}%` }} />
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-950"
          style={{ background: color, left: `${pct}%` }}
        />
      </div>
      <div className="w-16 shrink-0 font-mono text-xs font-bold text-slate-100">{display}</div>
      {sub && <div className="w-24 shrink-0 text-[10px] uppercase tracking-wide text-slate-500">{sub}</div>}
    </div>
  );
}

// A3: Baseline Benchmark Mode -- real measured proposed/uniform/distance-based
// comparison for whatever frame the backend last processed. Polls
// GET /api/baseline (cheap, no side effects) while this page is open and the
// backend is live.
function LiveBaselineComparison({ isLive }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isLive) { setData(null); setError(null); return; }
    let cancelled = false;
    const poll = () => {
      getBaseline()
        .then((payload) => { if (!cancelled) { setData(payload); setError(null); } })
        .catch((err) => { if (!cancelled) setError(err.message); });
    };
    poll();
    const interval = window.setInterval(poll, 2000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [isLive]);

  if (!isLive) {
    return (
      <p className="text-sm text-slate-500">
        Switch to Live Backend to see this computed for real from the current frame's actual regions.
      </p>
    );
  }
  if (error) return <p className="text-sm text-rose-400">Backend unreachable: {error}</p>;
  if (!data || !data.proposed || Object.keys(data.proposed).length === 0) {
    return <p className="text-sm text-slate-500">{data?.note ?? "Waiting for a processed frame..."}</p>;
  }

  const columns = [
    { key: "proposed", label: "Proposed" },
    { key: "uniform", label: "Uniform (finest)" },
    { key: "distance_based", label: "Distance-based" },
  ];
  // Only the resolution fields actually vary by method on a given frame --
  // active cells / estimated objects / important-region count are the same
  // regardless of allocation strategy, so they're reported as text, not bars.
  const resolutionGroups = [
    { field: "avg_resolution_m", title: "Avg resolution, all regions (m)" },
    { field: "avg_resolution_important_regions_m", title: "Avg resolution, important regions (m)" },
  ];

  return (
    <div>
      <p className="mb-4 text-xs leading-5 text-slate-500">
        Lower = finer resolution = more compute per region. All three methods see the same{" "}
        <strong className="text-slate-300">{data.proposed.active_cells}</strong> active regions, of which{" "}
        <strong className="text-slate-300">{data.proposed.important_region_count}</strong> are important
        (importance &ge; 0.5) &mdash; only how finely each is resolved differs.
      </p>
      <div className="space-y-5">
        {resolutionGroups.map((g) => (
          <div key={g.field}>
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">{g.title}</div>
            <div className="space-y-1.5">
              {columns.map((c) => {
                const v = data[c.key]?.[g.field];
                const max = Math.max(...columns.map((cc) => data[cc.key]?.[g.field] ?? 0), 0.0001);
                return (
                  <HBarRow
                    color={METHOD_COLOR[c.key]}
                    display={v == null ? "\u2014" : v.toFixed(3)}
                    key={c.key}
                    label={c.label}
                    max={max}
                    value={v ?? 0}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs leading-5 text-slate-500">{data.note}</p>
    </div>
  );
}

// D1: Same-Distance, Different-Resolution demonstration. On-demand probe
// (GET /api/demo/same_distance) -- doesn't need a live frame first, it
// builds its own two synthetic regions on the backend.
function SameDistanceProbe({ isLive }) {
  const [distance, setDistance] = useState(15);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = () => {
    setLoading(true);
    setError(null);
    getSameDistanceDemo(distance)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (isLive) run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isLive]);

  if (!isLive) {
    return (
      <p className="text-sm text-slate-500">
        Switch to Live Backend to run this probe against the real allocator.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <label className="text-xs text-slate-500" htmlFor="probe-distance">Shared distance (m)</label>
        <input
          className="w-20 rounded border border-line bg-slate-900 px-2 py-1 text-sm text-slate-100"
          id="probe-distance"
          onChange={(e) => setDistance(Number(e.target.value))}
          type="number"
          value={distance}
        />
        <button className="control-button" disabled={loading} onClick={run} type="button">
          {loading ? "Running\u2026" : "Run probe"}
        </button>
      </div>
      {error && <p className="text-sm text-rose-400">Backend unreachable: {error}</p>}
      {data && (
        <>
          <div className="flex items-center justify-center gap-8">
            {[data.pedestrian, data.static].map((r) => (
              <UtilityGauge
                color={DECISION_COLOR[r.decision] ?? "#94a3b8"}
                key={r.semantic_class}
                label={`${r.semantic_class} \u00b7 ${r.distance_from_sensor.toFixed(1)}m`}
                sub={`${r.decision} \u2192 ${r.resolution_after}m`}
                value={r.utility}
              />
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            Both regions sit at the exact same distance ({distance.toFixed(1)} m) from
            the sensor, yet the decisions differ: <strong className="text-slate-300">{String(data.decisions_differ)}</strong>.
            Resolution follows expected information value, not distance alone.
          </p>
        </>
      )}
    </div>
  );
}

// D5: Why 2.5D -- contrasts this project's actual active-cell
// representation (elevation + occupancy/semantic/motion/uncertainty
// attached to one object per footprint) against what a dense 3D voxel
// grid would need at the same (x, y) resolution. Polls
// GET /api/demo/why_2_5d against whatever regions are active right now.
function Why25DPanel({ isLive }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isLive) { setData(null); setError(null); return; }
    let cancelled = false;
    const poll = () => {
      getWhy25D()
        .then((payload) => { if (!cancelled) { setData(payload); setError(null); } })
        .catch((err) => { if (!cancelled) setError(err.message); });
    };
    poll();
    const interval = window.setInterval(poll, 3000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [isLive]);

  if (!isLive) {
    return (
      <p className="text-sm text-slate-500">
        Switch to Live Backend to compute this from the map's real active regions.
      </p>
    );
  }
  if (error) return <p className="text-sm text-rose-400">Backend unreachable: {error}</p>;
  if (!data || !data.active_cell_count) {
    return <p className="text-sm text-slate-500">Waiting for active regions...</p>;
  }

  // Values span several orders of magnitude. Bubble area is proportional to
  // the real value (sqrt-scaled radius), so the gap between them is felt
  // visually, not flattened onto a log axis where both ends look similar.
  return (
    <div>
      <SizeCompareBubbles
        items={[
          { color: "#22d3ee", display: data.active_cell_count.toLocaleString(), label: "2.5D active cells (real)", value: data.active_cell_count },
          { color: "#fbbf24", display: data.dense_3d_equivalent_voxel_count.toLocaleString(), label: "Dense 3D voxel equivalent", value: data.dense_3d_equivalent_voxel_count },
        ]}
      />
      {data.voxel_to_cell_ratio != null && (
        <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-300">
          {data.voxel_to_cell_ratio.toFixed(1)}&times; fewer values stored per active cell
        </div>
      )}
      <p className="mt-3 text-xs leading-5 text-slate-500">{data.explanation}</p>
    </div>
  );
}

// D7: Region-by-Region Decision Explanation -- five archetypal regions
// (empty road, building, road edge/obstacle, moving vehicle, pedestrian)
// run through the real allocation pipeline in one call. A self-contained
// probe (like D1's), so it re-runs on demand rather than needing live
// frames to be advancing. Rendered as a single sorted utility chart -- the
// point (utility drives the refine/coarsen/maintain decision, in this
// specific order) reads clearly as bars and doesn't need the raw
// per-signal numbers or the uniform/distance-based comparison columns.

function RegionDecisionExplanationPanel({ isLive }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = () => {
    setLoading(true);
    getRegionDecisions()
      .then((payload) => { setData(payload); setError(null); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (isLive) run();
    else { setData(null); setError(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive]);

  if (!isLive) {
    return <p className="text-sm text-slate-500">Switch to Live Backend to run this probe against the real pipeline.</p>;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          Five archetypal regions, scored the way Proposed, Uniform, and Distance-based each would.
        </p>
        <button className="control-button shrink-0 whitespace-nowrap" disabled={loading} onClick={run} type="button">
          {loading ? "Running\u2026" : "Re-run probe"}
        </button>
      </div>
      {error && <p className="text-sm text-rose-400">Backend unreachable: {error}</p>}
      {data && (
        <>
          <div className="space-y-2.5">
            {[...data.regions]
              .sort((a, b) => a.utility - b.utility)
              .map((r) => (
                <LollipopRow
                  color={DECISION_COLOR[r.decision] ?? "#94a3b8"}
                  display={r.utility.toFixed(3)}
                  key={r.key}
                  label={`${r.label} \u00b7 ${r.semantic_class}`}
                  sub={`${r.decision} \u2192 ${r.resolution_after}m`}
                  value={r.utility}
                />
              ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">{data.claim}</p>
        </>
      )}
    </div>
  );
}

export default function Comparison({ isLive }) {
  return (
    <section className="grid gap-4">
      <MappingComparisonShowcase />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel">
          <div className="section-title">A3 · Baseline Benchmark Mode</div>
          <LiveBaselineComparison isLive={isLive} />
        </div>

        <div className="panel">
          <div className="section-title">D1 · Same-Distance, Different-Resolution Probe</div>
          <SameDistanceProbe isLive={isLive} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel">
          <div className="section-title">D5 · Why 2.5D</div>
          <Why25DPanel isLive={isLive} />
        </div>

        <div className="panel">
          <div className="section-title">D7 · Region-by-Region Decision Explanation</div>
          <RegionDecisionExplanationPanel isLive={isLive} />
        </div>
      </div>
    </section>
  );
}