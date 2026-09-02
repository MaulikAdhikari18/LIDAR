import { useEffect, useMemo, useState } from "react";
import Navbar from "./components/Navbar.jsx";
import LiveSystem from "./pages/LiveSystem.jsx";
import Prediction from "./pages/Prediction.jsx";
import BudgetAnalytics from "./pages/BudgetAnalytics.jsx";
import Comparison from "./pages/Comparison.jsx";
import { BASE_REGIONS, DEMO_STEPS } from "./data/simulationData.js";
import { calculateFrame } from "./utils/utilityCalculation.js";
import { advanceFrame } from "./api/backendClient.js";
import { adaptBackendFrame } from "./api/liveAdapter.js";

const initialControls = {
  running: true,
  speed: 1,
  showLidar: true,
  showPrediction: true,
  demoActive: false,
  demoStep: 0,
};

// Backend map_dimensions default from config.py; update here if you change it there.
const BACKEND_CONFIG = { map_dimensions: [40, 30], computational_budget: 5000 };
const LIVE_POLL_MS = 350;

export default function App() {
  const [activePage, setActivePage] = useState("live");
  const [time, setTime] = useState(0);
  const [frameNumber, setFrameNumber] = useState(4128);
  const [selectedRegionId, setSelectedRegionId] = useState("pedestrian");
  const [controls, setControls] = useState(initialControls);
  const [predictionMode, setPredictionMode] = useState("predictive");

  const [dataSource, setDataSource] = useState("simulated"); // "simulated" | "live"
  const [liveRegions, setLiveRegions] = useState([]);
  const [liveMetrics, setLiveMetrics] = useState(null);
  const [liveError, setLiveError] = useState(null);

  useEffect(() => {
    let animationId;
    let last = performance.now();

    const tick = (now) => {
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (controls.running) {
        setTime((current) => current + delta * controls.speed);
        setFrameNumber((current) => current + Math.max(1, Math.round(delta * 28 * controls.speed)));
      }

      animationId = requestAnimationFrame(tick);
    };

    animationId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationId);
  }, [controls.running, controls.speed]);

  useEffect(() => {
    if (!controls.demoActive) return;
    const interval = window.setInterval(() => {
      setControls((current) => ({
        ...current,
        running: true,
        showPrediction: true,
        demoStep: (current.demoStep + 1) % DEMO_STEPS.length,
      }));
    }, 1700);

    return () => window.clearInterval(interval);
  }, [controls.demoActive]);

  // Poll the real backend for one frame at a time while "live" is selected.
  // Falls back to the last good frame (and surfaces an error) if a request
  // fails, so a dropped connection during a demo doesn't blank the screen.
  useEffect(() => {
    if (dataSource !== "live" || !controls.running) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const result = await advanceFrame();
        if (cancelled) return;
        const { regions, metrics } = adaptBackendFrame(result, BACKEND_CONFIG);
        setLiveRegions(regions);
        setLiveMetrics(metrics);
        setFrameNumber(result.frame_id);
        setLiveError(null);
      } catch (err) {
        if (!cancelled) setLiveError(err.message);
      }
    };

    poll();
    const interval = window.setInterval(poll, LIVE_POLL_MS);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [dataSource, controls.running]);

  const demoIntensity = controls.demoActive ? Math.min(1, controls.demoStep / 5) : 0;
  const predictionEnabled = controls.showPrediction && predictionMode === "predictive";

  const simulatedRegions = useMemo(
    () => calculateFrame(time, { predictionEnabled, demoIntensity }),
    [time, predictionEnabled, demoIntensity],
  );

  const regions = dataSource === "live" && liveRegions.length ? liveRegions : simulatedRegions;

  const selectedRegion = regions.find((region) => region.id === selectedRegionId) ?? regions[0];
  const totalAllocated = regions.reduce((sum, region) => sum + region.cellsAllocated, 0);
  const fps = dataSource === "live" && liveMetrics ? Math.round(liveMetrics.fps) : Math.round(58 + Math.sin(time * 1.3) * 4);
  const computeUsage =
    dataSource === "live" && liveMetrics
      ? Math.round((liveMetrics.used_budget / Math.max(liveMetrics.budget, 1e-6)) * 100)
      : Math.round(78 + (totalAllocated / 100000) * 18 + Math.sin(time * 0.8) * 3);

  const resetSimulation = () => {
    setTime(0);
    setFrameNumber(4128);
    setControls((current) => ({ ...current, running: true, demoStep: 0 }));
  };

  const sharedProps = {
    time,
    frameNumber,
    fps,
    computeUsage,
    regions,
    selectedRegion,
    selectedRegionId,
    setSelectedRegionId,
    controls,
    setControls,
    resetSimulation,
    predictionMode,
    setPredictionMode,
  };

  return (
    <div className="min-h-screen px-4 py-4 lg:px-6">
      <div className="mb-3 flex items-center justify-end gap-2">
        {liveError && dataSource === "live" && (
          <span className="text-xs font-bold text-rose-400">Live backend error: {liveError}</span>
        )}
        <button
          type="button"
          className={`control-button ${dataSource === "simulated" ? "control-button-active" : ""}`}
          onClick={() => setDataSource("simulated")}
        >
          Simulated Demo
        </button>
        <button
          type="button"
          className={`control-button ${dataSource === "live" ? "control-button-active" : ""}`}
          onClick={() => setDataSource("live")}
        >
          Live Backend
        </button>
      </div>

      <Navbar
        activePage={activePage}
        computeUsage={computeUsage}
        fps={fps}
        frameNumber={frameNumber}
        onNavigate={setActivePage}
      />

      <main className="pt-4">
        {activePage === "live" && <LiveSystem {...sharedProps} />}
        {activePage === "prediction" && <Prediction {...sharedProps} />}
        {activePage === "budget" && <BudgetAnalytics {...sharedProps} />}
        {activePage === "comparison" && <Comparison {...sharedProps} />}
      </main>

      <div className="sr-only">
        Source regions loaded: {BASE_REGIONS.length}. Utility, budget, resolution and prediction state are{" "}
        {dataSource === "live" ? "read from the live backend" : "simulated client-side"}.
      </div>
    </div>
  );
}