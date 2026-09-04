import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Navbar from "./components/Navbar.jsx";
import LiveStatusPanel from "./components/LiveStatusPanel.jsx";
import SimpleDashboard from "./pages/SimpleDashboard.jsx";
import LiveSystem from "./pages/LiveSystem.jsx";
import Prediction from "./pages/Prediction.jsx";
import BudgetAnalytics from "./pages/BudgetAnalytics.jsx";
import Comparison from "./pages/Comparison.jsx";
import { BASE_REGIONS, DEMO_STEPS, TOTAL_BUDGET } from "./data/simulationData.js";
import { calculateFrame } from "./utils/utilityCalculation.js";
import { advanceFrame, getConfig, resetBackend } from "./api/backendClient.js";
import { adaptBackendFrame } from "./api/liveAdapter.js";

const initialControls = {
  running: true,
  speed: 1,
  showLidar: true,
  showPrediction: true,
  demoActive: false,
  demoStep: 0,
};

// Last-resort defaults, used only if GET /api/config is unreachable. The real
// values are fetched from the backend on entering Live mode -- the UI no longer
// keeps its own authoritative copy of the budget, which used to drift out of
// sync with config.py and silently rescale every per-region figure on screen.
const FALLBACK_CONFIG = { map_dimensions: [40, 30], computational_budget: 5000 };
const LIVE_POLL_MS = 350;
// How many frames of live metrics to keep for the Budget Analytics timeline.
const LIVE_HISTORY_LENGTH = 40;

// Thresholds for classifying a utility score. The simulated and live utility
// scales are genuinely different (the simulation's calculateFrame produces
// ~1.0-2.5; the backend's ig/cost ratio is compared against
// refine_threshold=0.55 / coarsen_threshold=0.25), so a single hardcoded number
// cannot be correct for both. Pages that need to say "high utility" read these.
const SIMULATED_THRESHOLDS = { refine: 1.8, coarsen: 1.08 };

export default function App() {
  // Opens on the simplified demo view -- the one built for narrating the
  // pitch out loud -- rather than the dense Live System page. The detailed
  // pages are one nav click away for follow-up questions.
  const [activePage, setActivePage] = useState("demo");
  const [time, setTime] = useState(0);
  const [frameNumber, setFrameNumber] = useState(4128);
  const [selectedRegionId, setSelectedRegionId] = useState("pedestrian");
  const [controls, setControls] = useState(initialControls);
  const [predictionMode, setPredictionMode] = useState("predictive");

  const [dataSource, setDataSource] = useState("simulated"); // "simulated" | "live"
  const [liveRegions, setLiveRegions] = useState([]);
  const [liveMetrics, setLiveMetrics] = useState(null);
  const [liveHistory, setLiveHistory] = useState([]);
  const [liveConfig, setLiveConfig] = useState(null);
  const [liveError, setLiveError] = useState(null);
  // "idle" | "connecting" | "live" | "empty" | "error"
  const [liveStatus, setLiveStatus] = useState("idle");

  // Read inside the poll so it always sees the freshest config without making
  // the polling effect tear down and restart every time config arrives.
  const liveConfigRef = useRef(null);
  useEffect(() => { liveConfigRef.current = liveConfig; }, [liveConfig]);

  useEffect(() => {
    let animationId;
    let last = performance.now();

    const tick = (now) => {
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (controls.running) {
        setTime((current) => current + delta * controls.speed);
        // Only the simulation invents its own frame numbers. In Live mode the
        // authoritative frame id comes from the backend response; letting the
        // animation loop also drive this counter at ~28/s meant it raced ahead
        // and then snapped back on every poll, so the Navbar counter visibly
        // jittered instead of counting real processed frames.
        if (dataSource !== "live") {
          setFrameNumber((current) => current + Math.max(1, Math.round(delta * 28 * controls.speed)));
        }
      }

      animationId = requestAnimationFrame(tick);
    };

    animationId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationId);
  }, [controls.running, controls.speed, dataSource]);

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

  // Fetch the backend's real config once, on entering Live mode.
  useEffect(() => {
    if (dataSource !== "live") return;
    let cancelled = false;
    setLiveStatus((current) => (current === "live" ? current : "connecting"));

    getConfig()
      .then((payload) => {
        if (!cancelled) setLiveConfig(payload.config ?? payload);
      })
      .catch(() => {
        // Not fatal on its own -- fall back to the defaults and let the frame
        // poll below decide whether the backend is actually reachable.
        if (!cancelled) setLiveConfig(FALLBACK_CONFIG);
      });

    return () => { cancelled = true; };
  }, [dataSource]);

  // Poll the real backend, one frame at a time, while Live is selected.
  //
  // Chained setTimeout rather than setInterval: /api/frame MUTATES server state
  // (it advances the dataset cursor and mutates the quadtree), so overlapping
  // requests on a slow frame consumed dataset frames two at a time and could
  // apply responses out of order. Waiting for each response before scheduling
  // the next makes the frame sequence match what the backend actually processed.
  useEffect(() => {
    if (dataSource !== "live") return;
    let cancelled = false;
    let timer = null;

    const poll = async () => {
      try {
        const result = await advanceFrame();
        if (cancelled) return;
        const { regions, metrics } = adaptBackendFrame(result, liveConfigRef.current ?? FALLBACK_CONFIG);
        setLiveRegions(regions);
        setLiveMetrics(metrics);
        setFrameNumber(result.frame_id);
        setLiveError(null);
        setLiveStatus(regions.length ? "live" : "empty");

        if (metrics) {
          setLiveHistory((current) => {
            const next = [...current, {
              label: `${metrics.frame_id}`,
              frameId: metrics.frame_id,
              Fine: metrics.fine_cells ?? 0,
              Medium: metrics.medium_cells ?? 0,
              Coarse: metrics.coarse_cells ?? 0,
              activeCells: metrics.active_cells ?? 0,
              used: Number((metrics.used_budget ?? 0).toFixed(2)),
              budget: metrics.budget ?? 0,
            }];
            return next.slice(-LIVE_HISTORY_LENGTH);
          });
        }
      } catch (err) {
        if (cancelled) return;
        setLiveError(err.message);
        // Only escalate to a blocking error state if we never had a good frame.
        // Mid-demo blips shouldn't tear down a working screen.
        setLiveStatus((current) => (current === "live" ? current : "error"));
      } finally {
        // Always fetch once on entry, even while paused, so selecting Live
        // shows real data instead of an indefinite "connecting" state. Only
        // keep polling while the simulation is running.
        if (!cancelled && controls.running) {
          timer = window.setTimeout(poll, LIVE_POLL_MS);
        }
      }
    };

    poll();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [dataSource, controls.running]);

  // Switching modes invalidates the selection (live ids are `track-<n>` /
  // `r-<i>-<j>`; simulated ids are names like "pedestrian") and any live
  // history collected under different config.
  useEffect(() => {
    setSelectedRegionId(null);
    if (dataSource === "simulated") {
      setLiveStatus("idle");
    } else {
      setLiveHistory([]);
    }
  }, [dataSource]);

  const demoIntensity = controls.demoActive ? Math.min(1, controls.demoStep / 5) : 0;
  const predictionEnabled = controls.showPrediction && predictionMode === "predictive";

  const simulatedRegions = useMemo(
    () => calculateFrame(time, { predictionEnabled, demoIntensity }),
    [time, predictionEnabled, demoIntensity],
  );

  // Live mode shows live data or an explicit status panel -- never a silent
  // swap back to the simulation. Previously an empty live response fell through
  // to simulated regions while the "Live Backend" button stayed highlighted,
  // which meant a dead backend on stage looked exactly like a working one.
  const isLive = dataSource === "live" && liveStatus === "live" && liveRegions.length > 0;
  const regions = isLive ? liveRegions : simulatedRegions;

  const selectedRegion = regions.find((region) => region.id === selectedRegionId) ?? regions[0];
  const totalAllocated = regions.reduce((sum, region) => sum + region.cellsAllocated, 0);
  const fps = isLive && liveMetrics ? Math.round(liveMetrics.fps) : Math.round(58 + Math.sin(time * 1.3) * 4);
  const computeUsage =
    isLive && liveMetrics
      ? Math.round((liveMetrics.used_budget / Math.max(liveMetrics.budget, 1e-6)) * 100)
      : Math.round(78 + (totalAllocated / TOTAL_BUDGET) * 18 + Math.sin(time * 0.8) * 3);

  // The real budget in force, not a hardcoded frontend constant.
  const budgetTotal = isLive && liveMetrics ? liveMetrics.budget : TOTAL_BUDGET;
  const budgetUsed = isLive && liveMetrics ? liveMetrics.used_budget : totalAllocated;
  const thresholds = isLive
    ? {
      refine: liveConfig?.refine_threshold ?? 0.55,
      coarsen: liveConfig?.coarsen_threshold ?? 0.25,
    }
    : SIMULATED_THRESHOLDS;
  const resolutionLevels = isLive ? liveConfig?.resolution_levels : undefined;

  const resetSimulation = useCallback(() => {
    setTime(0);
    setControls((current) => ({ ...current, running: true, demoStep: 0 }));

    if (dataSource === "live") {
      // Reset used to be simulation-only, so in Live mode it left the backend's
      // frame cursor and quadtree exactly where they were -- the map never
      // actually went back to a clean state. /api/reset rebuilds the map,
      // tracker and allocator while keeping the posted config, so the budget
      // does not need re-sending.
      setLiveRegions([]);
      setLiveMetrics(null);
      setLiveHistory([]);
      setLiveStatus("connecting");
      resetBackend()
        .then(() => setFrameNumber(0))
        .catch((err) => { setLiveError(err.message); setLiveStatus("error"); });
    } else {
      setFrameNumber(4128);
    }
  }, [dataSource]);

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
    // Live-awareness. Pages that reach for simulated data by a path other than
    // the `regions` array (Prediction's motion model, Budget Analytics'
    // headline chart) need these to respect Live mode.
    isLive,
    liveMetrics: isLive ? liveMetrics : null,
    liveHistory: isLive ? liveHistory : null,
    budgetTotal,
    budgetUsed,
    thresholds,
    resolutionLevels,
    // The demo dashboard has its own header (mode pill, frame, budget, and a
    // toggle switch) so it needs the raw mode state, not just the derived
    // `isLive` boolean the other pages use.
    dataSource,
    setDataSource,
    liveStatus,
  };

  const showLiveGate = dataSource === "live" && !isLive;
  // The demo dashboard's own header already shows an equivalent status pill,
  // frame counter, and backend toggle switch -- rendering the generic ones
  // here too would put two toggles and two status readouts on screen at once.
  const showGlobalToggleRow = activePage !== "demo";

  return (
    <div className="min-h-screen px-4 py-4 lg:px-6">
      {showGlobalToggleRow && (
        <div className="mb-3 flex items-center justify-end gap-2">
          {dataSource === "live" && (
            <span className="mr-auto flex items-center gap-2 text-xs font-bold">
              <span
                className={`h-2 w-2 rounded-full ${liveStatus === "live"
                  ? "bg-emerald-400"
                  : liveStatus === "error"
                    ? "bg-rose-500"
                    : "bg-amber-400"
                  }`}
              />
              <span className={liveStatus === "live" ? "text-emerald-300" : liveStatus === "error" ? "text-rose-400" : "text-amber-300"}>
                {liveStatus === "live"
                  ? `LIVE · backend frame ${frameNumber}`
                  : liveStatus === "error"
                    ? "LIVE · backend unreachable"
                    : liveStatus === "empty"
                      ? "LIVE · backend responding, no regions"
                      : "LIVE · connecting"}
              </span>
            </span>
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
      )}

      <Navbar
        activePage={activePage}
        computeUsage={computeUsage}
        fps={fps}
        frameNumber={frameNumber}
        onNavigate={setActivePage}
        dataSource={dataSource}
        liveStatus={liveStatus}
      />

      <main className="pt-4">
        {showLiveGate ? (
          <LiveStatusPanel
            error={liveError}
            onRetry={() => { setLiveStatus("connecting"); setLiveError(null); setDataSource("live"); }}
            onUseSimulated={() => setDataSource("simulated")}
            status={liveStatus}
          />
        ) : (
          <>
            {activePage === "demo" && <SimpleDashboard {...sharedProps} />}
            {activePage === "live" && <LiveSystem {...sharedProps} />}
            {activePage === "prediction" && <Prediction {...sharedProps} />}
            {activePage === "budget" && <BudgetAnalytics {...sharedProps} />}
            {activePage === "comparison" && <Comparison {...sharedProps} />}
          </>
        )}
      </main>

      <div className="sr-only">
        Source regions loaded: {isLive ? regions.length : BASE_REGIONS.length}. Utility, budget, resolution and prediction state are{" "}
        {isLive ? "read from the live backend" : "simulated client-side"}.
      </div>
    </div>
  );
}