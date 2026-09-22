import { useState } from "react";
import { ServerCog } from "lucide-react";
import { setDatasetPath, updateConfig } from "../api/backendClient.js";

function ConfigField({ disabled, label, onSet, placeholder, setValue, value }) {
  return (
    <div className="flex flex-1 items-center gap-2">
      <span className="w-28 shrink-0 text-xs text-slate-400">{label}</span>
      <input
        className="w-full min-w-0 rounded-lg border border-slate-700/80 bg-slate-900/90 px-2.5 py-1.5 text-xs text-slate-200 focus:border-cyanSignal focus:outline-none disabled:opacity-40"
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        type="text"
        value={value}
      />
      <button
        className="shrink-0 rounded-lg border border-cyanSignal/60 bg-cyanSignal/10 px-3 py-1.5 text-xs font-semibold tracking-wide text-cyanSignal transition hover:bg-cyanSignal/25 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={disabled}
        onClick={onSet}
        type="button"
      >
        Set
      </button>
    </div>
  );
}

// Only meaningful in Live mode -- there is no backend process to configure
// while running the client-side simulation, so the fields are disabled
// (rather than silently doing nothing) when dataSource isn't "live".
export default function BackendConfigurationPanel({ dataSource }) {
  const isLive = dataSource === "live";
  const [path, setPath] = useState("");
  const [sequence, setSequence] = useState("00");
  const [budget, setBudget] = useState("");
  const [refineThreshold, setRefineThreshold] = useState("");
  const [status, setStatus] = useState(null);

  const run = async (label, fn) => {
    setStatus(`Setting ${label}\u2026`);
    try {
      await fn();
      setStatus(`${label} updated.`);
    } catch (err) {
      setStatus(`${label} failed: ${err.message}`);
    }
  };

  return (
    <div className="panel">
      <div className="section-title">
        <ServerCog size={16} />
        Backend Configuration
      </div>
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <ConfigField
          disabled={!isLive}
          label="Dataset path"
          onSet={() => path && run("Dataset path", () => setDatasetPath(path, sequence || "00"))}
          placeholder="/data (folder containing sequences/)"
          setValue={setPath}
          value={path}
        />
        <ConfigField
          disabled={!isLive}
          label="Sequence"
          onSet={() => path && run("Dataset path", () => setDatasetPath(path, sequence || "00"))}
          placeholder="00"
          setValue={setSequence}
          value={sequence}
        />
        <ConfigField
          disabled={!isLive}
          label="Compute budget"
          onSet={() => budget && run("Budget", () => updateConfig({ computational_budget: Number(budget) }))}
          placeholder="5000"
          setValue={setBudget}
          value={budget}
        />
        <ConfigField
          disabled={!isLive}
          label="Refine threshold"
          onSet={() => refineThreshold && run("Refine threshold", () => updateConfig({ refine_threshold: Number(refineThreshold) }))}
          placeholder="0.55"
          setValue={setRefineThreshold}
          value={refineThreshold}
        />
      </div>
      <p className="mt-3 text-[11px] text-slate-500">
        {isLive ? (status ?? "Applies to the running backend immediately.") : "Switch to Live Backend to edit these."}
      </p>
    </div>
  );
}