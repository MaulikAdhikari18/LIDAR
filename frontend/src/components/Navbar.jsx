import { Cpu, RadioTower } from "lucide-react";
import { NAV_ITEMS } from "../data/simulationData.js";

// Mirrors the status states LiveStatusPanel and the top-bar pill already use,
// so the navbar can't say something different from the rest of the page.
const STATUS_COPY = {
  simulated: { label: "Simulated Demo", dotClass: "bg-sky-400 shadow-[0_0_14px_rgba(56,189,248,0.85)]", textClass: "text-sky-300" },
  live: { label: "Live", dotClass: "bg-stable shadow-[0_0_14px_rgba(34,197,94,0.85)]", textClass: "text-emerald-300" },
  connecting: { label: "Connecting…", dotClass: "bg-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.85)]", textClass: "text-amber-300" },
  empty: { label: "No Regions", dotClass: "bg-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.85)]", textClass: "text-amber-300" },
  error: { label: "Unreachable", dotClass: "bg-rose-500 shadow-[0_0_14px_rgba(244,63,94,0.85)]", textClass: "text-rose-400" },
};

function MetricChip({ label, value, extra }) {
  return (
    <div className="rounded-md border border-line bg-slate-950/60 px-3 py-1.5 text-center">
      <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-0.5 flex items-center justify-center gap-1.5 text-sm font-black text-white">{value}{extra}</div>
    </div>
  );
}

export default function Navbar({
  activePage, computeUsage, fps, frameNumber, objectsCount, datasetTotalFrames,
  onNavigate, dataSource = "simulated", liveStatus = "idle",
}) {
  const statusKey = dataSource === "simulated" ? "simulated" : liveStatus === "idle" ? "connecting" : liveStatus;
  const { label, dotClass, textClass } = STATUS_COPY[statusKey] ?? STATUS_COPY.connecting;
  const showMetrics = statusKey === "live" || statusKey === "simulated";
  const frameLabel = dataSource === "live" && datasetTotalFrames ? `${frameNumber}/${datasetTotalFrames}` : frameNumber;

  return (
    <header className="rounded-lg border border-line bg-black/45 px-4 py-3 shadow-panel backdrop-blur-xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black tracking-wide text-slate-50">
            Adaptive <span className="text-cyanSignal">LiDAR</span> Perception
          </h1>
          <p className="mt-0.5 text-xs font-semibold text-slate-500">
            Real-time spatial resolution allocation &amp; trajectory prediction
          </p>
        </div>

        {showMetrics ? (
          <div className="flex flex-wrap items-center gap-2">
            <MetricChip label="Frame" value={frameLabel} />
            <MetricChip label="FPS" value={fps} />
            <MetricChip label="Objects" value={objectsCount ?? 0} />
            <div className="rounded-md border border-line bg-slate-950/60 px-3 py-1.5 text-center">
              <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Compute Used</div>
              <div className="mt-0.5 flex items-center justify-center gap-1.5">
                <Cpu className="text-emerald-400" size={12} />
                <span className="text-sm font-black text-emerald-400">{computeUsage}%</span>
                <span className="h-1.5 w-10 overflow-hidden rounded-full bg-slate-800">
                  <span className="block h-full rounded-full bg-emerald-400" style={{ width: `${computeUsage}%` }} />
                </span>
              </div>
            </div>
            <MetricChip value={dataSource === "live" ? "Adaptive" : "Simulated"} label="Mode" />
          </div>
        ) : (
          <span className="flex items-center gap-1 text-xs font-semibold text-slate-500"><RadioTower size={14} /> No telemetry</span>
        )}

        <div className="flex items-center gap-2 rounded-md border border-line bg-slate-950/60 px-3 py-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
          <span className={`text-xs font-black uppercase tracking-wide ${textClass}`}>{label}</span>
        </div>
      </div>

      <nav className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
        {NAV_ITEMS.map((item) => (
          <button
            className={`control-button ${activePage === item.id ? "control-button-active" : ""}`}
            key={item.id}
            onClick={() => onNavigate(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </nav>
    </header>
  );
}
