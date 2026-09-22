import { FastForward, Pause, Play, Rewind, RotateCcw, SkipForward } from "lucide-react";

export default function PlaybackControlsPanel({
  autoPlay,
  controls,
  dataSource = "simulated",
  isAdvancingFrame,
  onStep,
  resetSimulation,
  setAutoPlay,
  setControls,
}) {
  const isLive = dataSource === "live";

  return (
    <div className="panel">
      <div className="section-title">
        <Play size={16} />
        Playback &amp; Prediction
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {isLive ? (
          <div className="flex items-center gap-2">
            <button
              aria-label="Next frame"
              className="flex items-center gap-2 rounded-full border border-cyanSignal bg-cyanSignal/10 px-4 py-2.5 text-sm font-bold text-cyanSignal transition hover:bg-cyanSignal/20 disabled:cursor-wait disabled:opacity-60"
              disabled={isAdvancingFrame}
              onClick={onStep}
              title="Advance exactly one frame from the backend"
              type="button"
            >
              <SkipForward size={16} />
              {isAdvancingFrame ? "Advancing…" : "Next Frame"}
            </button>
            <button
              aria-label={autoPlay ? "Pause auto play" : "Enable auto play"}
              aria-pressed={autoPlay}
              className={`flex h-10 w-10 items-center justify-center rounded-full border transition ${
                autoPlay
                  ? "border-cyanSignal bg-cyanSignal/15 text-cyanSignal"
                  : "border-line bg-slate-950/70 text-slate-400 hover:border-cyanSignal/60"
              }`}
              onClick={() => setAutoPlay((v) => !v)}
              title="Auto Play resumes continuous polling. Off by default."
              type="button"
            >
              {autoPlay ? <Pause size={16} /> : <Play className="translate-x-0.5" size={16} />}
            </button>
            <button
              aria-label="Reset"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-slate-950/70 text-slate-400 transition hover:border-risk/60 hover:text-risk"
              onClick={resetSimulation}
              type="button"
            >
              <RotateCcw size={16} />
            </button>
          </div>
        ) : (
        <div className="flex items-center gap-2">
          <button
            aria-label="Rewind"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-slate-950/70 text-slate-400 transition hover:border-cyanSignal/60 hover:text-cyanSignal"
            onClick={() => setControls((c) => ({ ...c, speed: Math.max(0.4, c.speed - 0.4) }))}
            type="button"
          >
            <Rewind size={16} />
          </button>
          <button
            aria-label={controls.running ? "Pause" : "Play"}
            className="flex h-12 w-12 items-center justify-center rounded-full border border-cyanSignal bg-cyanSignal/10 text-cyanSignal transition hover:bg-cyanSignal/20"
            onClick={() => setControls((c) => ({ ...c, running: !c.running }))}
            type="button"
          >
            {controls.running ? <Pause size={20} /> : <Play className="translate-x-0.5" size={20} />}
          </button>
          <button
            aria-label="Toggle 2x speed"
            aria-pressed={controls.speed > 1}
            className={`flex h-10 w-10 items-center justify-center rounded-full border transition ${
              controls.speed > 1 ? "border-cyanSignal bg-cyanSignal/15 text-cyanSignal" : "border-line bg-slate-950/70 text-slate-400 hover:border-cyanSignal/60"
            }`}
            onClick={() => setControls((c) => ({ ...c, speed: c.speed > 1 ? 1 : 2 }))}
            type="button"
          >
            <FastForward size={16} />
          </button>
          <button
            aria-label="Reset"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-slate-950/70 text-slate-400 transition hover:border-risk/60 hover:text-risk"
            onClick={resetSimulation}
            type="button"
          >
            <RotateCcw size={16} />
          </button>
        </div>
        )}

        {!isLive && (
          <div className="flex flex-1 items-center gap-3">
            <span className="text-xs font-semibold text-slate-400">Speed</span>
            <input
              className="h-1.5 flex-1 accent-cyanSignal"
              max="2.4"
              min="0.4"
              onChange={(e) => setControls((c) => ({ ...c, speed: Number(e.target.value) }))}
              step="0.2"
              type="range"
              value={controls.speed}
            />
            <span className="font-mono text-sm font-bold text-cyanSignal">{controls.speed.toFixed(1)}x</span>
          </div>
        )}

        <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-slate-300 transition hover:text-white">
          <input
            checked={controls.showPrediction}
            className="h-4 w-4 cursor-pointer rounded border-slate-700 bg-slate-900 text-cyanSignal focus:ring-0 focus:ring-offset-0"
            onChange={(e) => setControls((c) => ({ ...c, showPrediction: e.target.checked }))}
            type="checkbox"
          />
          Show predicted future positions
        </label>
      </div>

      {isLive && (
        <p className="mt-2 text-[11px] text-slate-500">
          {autoPlay
            ? "Auto Play is on — frames advance automatically every 350ms."
            : "Click \"Next Frame\" (or the map itself) to step through the dataset one frame at a time."}
        </p>
      )}
    </div>
  );
}