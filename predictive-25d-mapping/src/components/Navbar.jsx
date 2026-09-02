import { Activity, Cpu, Gauge, RadioTower } from "lucide-react";
import { NAV_ITEMS } from "../data/simulationData.js";

export default function Navbar({ activePage, computeUsage, fps, frameNumber, onNavigate }) {
  return (
    <header className="grid gap-4 rounded-lg border border-line bg-black/45 px-4 py-3 shadow-panel backdrop-blur-xl xl:grid-cols-[1fr_auto_1fr] xl:items-center">
      <div>
        <h1 className="text-xl font-black tracking-wide text-slate-50">Predictive Adaptive 2.5D Mapping</h1>
        <p className="mt-1 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Adaptive Information Budgeting Engine</p>
      </div>

      <nav className="flex flex-wrap gap-2">
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

      <div className="flex flex-wrap items-center gap-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-300 xl:justify-end">
        <span className="flex items-center gap-2 text-emerald-300">
          <span className="h-2.5 w-2.5 rounded-full bg-stable shadow-[0_0_14px_rgba(34,197,94,0.85)]" />
          System Online
        </span>
        <span className="flex items-center gap-1"><Gauge size={14} /> {fps} FPS</span>
        <span className="flex items-center gap-1"><RadioTower size={14} /> Frame {frameNumber}</span>
        <span className="flex items-center gap-1"><Cpu size={14} /> {computeUsage}% Compute</span>
        <span className="flex items-center gap-1"><Activity size={14} /> Live</span>
      </div>
    </header>
  );
}
