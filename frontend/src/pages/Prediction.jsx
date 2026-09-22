import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CarFront,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Crosshair,
  Gauge,
  Layers3,
  Pause,
  Play,
  Route,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  SkipForward,
  Target,
  TrendingUp,
} from "lucide-react";
import { AnimalTop, BarrierTop, BuildingTop, CarTop, PersonTop, TreeTop } from "../components/SceneModels.jsx";
import {
  AnimalSprite, BuildingSprite, CarSprite, EgoCar, PedestrianSprite, SceneBox, SceneMedia, SignSprite, corner, lerp,
} from "../components/SceneShowcase.jsx";
import { Backdrop, baseCells, hashRegionId, palette, shapeFor } from "../components/AdaptiveMap.jsx";
import { layoutLabels } from "../utils/labelLayout.js";
import RegionInspector from "../components/RegionInspector.jsx";
import UtilityEngine from "../components/UtilityEngine.jsx";

// Five pipeline stages (was nine) -- matches the autonomous feedback loop as
// it's actually explained to viewers: perceive -> predict -> prioritize ->
// adapt resolution -> safe corridors. The richer nine-beat story below still
// drives the scene (obstacle emerging, getting detected, etc.) but every one
// of those beats now maps onto ONE of these five stages instead of getting
// its own box, so the pipeline reads as a loop instead of a checklist.
const STAGES = [
  { key: "PERCEIVE", label: "Objects detected" },
  { key: "PREDICT", label: "Future motion" },
  { key: "PRIORITIZE", label: "Compute utility" },
  { key: "ADAPT RESOLUTION", label: "Refine critical regions" },
  { key: "SAFE CORRIDORS", label: "Path updated" },
];

// phase (0-8, from SCENES below) -> which of the 5 STAGES is current.
const STAGE_FOR_PHASE = [0, 0, 0, 1, 1, 2, 3, 3, 4];

const SCENES = [
  { phase: 0, title: "Clear road", detail: "Low information value ahead → keep most of the map coarse.", obstacle: false, predicted: false, refine: false },
  { phase: 1, title: "Animal enters view", detail: "An animal moves into the vehicle's sensor field ahead.", obstacle: true, obstacleX: 55, predicted: false, refine: false },
  { phase: 2, title: "Object detected", detail: "Semantic perception classifies the object as a dynamic animal actor.", obstacle: true, obstacleX: 53, predicted: false, refine: false },
  { phase: 3, title: "Motion / trajectory evaluated", detail: "The system checks whether the animal's path intersects the projected corridor.", obstacle: true, obstacleX: 51, predicted: true, refine: false },
  { phase: 4, title: "Future collision risk", detail: "Predicted occupancy overlaps the current driving corridor.", obstacle: true, obstacleX: 49, predicted: true, refine: true },
  { phase: 5, title: "Utility crosses threshold", detail: "Expected information gain is now worth the extra computation.", obstacle: true, obstacleX: 47, predicted: true, refine: true },
  { phase: 6, title: "Fovea refinement", detail: "Only the critical animal / future corridor receives 5 cm cells.", obstacle: true, obstacleX: 45, predicted: true, refine: true },
  { phase: 7, title: "Budget reallocation", detail: "Low-value cells are coarsened and their budget is reclaimed.", obstacle: true, obstacleX: 43, predicted: true, refine: true },
  { phase: 8, title: "Safe corridor selected", detail: "The original path is blocked, so the predicted free corridor is updated.", obstacle: true, obstacleX: 41, predicted: true, refine: true },
];

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function scenarioAt(time, demoStep, running) {
  const continuous = running ? time * 0.72 : time * 0.72;
  const phase = demoStep % SCENES.length;
  const scene = SCENES[phase];
  const vehicleY = 82 - ((continuous * 7) % 10);
  const obstacleX = scene.obstacleX ?? 50;
  const obstacleY = clamp(34 - Math.max(0, phase - 1) * 1.8, 20, 34);
  const speed = phase < 4 ? 8.0 + Math.sin(time) * 0.4 : 6.8 + Math.sin(time) * 0.25;
  const utility = [0.82, 1.02, 1.24, 1.58, 1.94, 2.28, 2.62, 2.38, 2.12][phase];
  const confidence = [0.94, 0.91, 0.93, 0.9, 0.88, 0.92, 0.94, 0.95, 0.96][phase];
  const infoGain = [0.18, 0.25, 0.34, 0.47, 0.62, 0.71, 0.78, 0.69, 0.63][phase];
  const cost = [0.22, 0.24, 0.25, 0.27, 0.29, 0.31, 0.3, 0.29, 0.3][phase];
  const decision = scene.refine ? "REFINE" : phase >= 2 ? "MAINTAIN" : "COARSEN";
  const cells = scene.refine ? 3120 : phase >= 2 ? 840 : 180;

  // The moving vehicle ahead is a SEPARATE, always-present dynamic actor
  // (distinct from the animal hazard above) -- it's the one the
  // Object Information panel focuses on, same as a real perception stack
  // would keep tracking a moving car even while another dynamic hazard is also
  // being evaluated.
  const vehicleSpeedMps = 8.2 + Math.sin(time * 0.9) * 0.3;
  const vehicleDistance = clamp(24 - ((continuous * 1.6) % 14), 6, 24);
  const vehiclePredictedDisplacement = vehicleSpeedMps * 1.5;
  const vehicleConfidence = clamp(0.88 + Math.sin(time * 0.5) * 0.04, 0.85, 0.97);

  return {
    phase, scene, vehicleY, obstacleX, obstacleY, speed, utility, confidence, infoGain, cost, decision, cells,
    vehicleSpeedMps, vehicleDistance, vehiclePredictedDisplacement, vehicleConfidence,
    refine: scene.refine,
  };
}

// --- Photoreal scene placement (SimulationView + FutureProbabilityLayer) ---
// Both panels render the SAME night-highway perspective as the Comparison
// page (imported from SceneShowcase.jsx: sky/road/vanishing-point backdrop,
// side-view sprites, labeled SceneBoxes) instead of the flat top-down map
// the rest of this page still uses. depth: 0 = at the ego, 1 = the horizon.
// lateral: 0 = left edge of the road, 1 = right edge. Computed once and
// shared so the two panels can't drift apart on where anything actually is.
function scenePositions(sim) {
  const vehicleDepth = clamp(sim.vehicleDistance / 90, 0.06, 0.9);
  const animalDepth = clamp(0.82 - sim.phase * 0.065, 0.26, 0.82);
  const animalLateral = clamp(sim.obstacleX / 100, 0.25, 0.75);
  return {
    ego: { depth: 0, lateral: 0.5 },
    vehicle: { depth: vehicleDepth, lateral: 0.54 },
    animal: { depth: animalDepth, lateral: animalLateral },
    parkedCar: { depth: 0.52, lateral: 0.15 },
    building: { depth: 0.6, lateral: 0.87 },
  };
}

// Sprites/boxes shrink toward the horizon -- nearer objects (small depth)
// render bigger, same visual logic as the Comparison page's hand-placed art,
// just driven by live sim state instead of fixed numbers.
function sizeAt(depth, near, far) {
  return lerp(near, far, clamp(depth, 0, 1));
}

// Forward-projected predicted path for a dynamic object, converted into ROAD
// (perspective) coordinates. Shared by SimulationView and
// FutureProbabilityLayer so BOTH panels draw a path for EVERY dynamic object
// at once -- not just whichever one happens to be selected -- the same way
// the Live System page (AdaptiveMap.jsx) draws a projected path for every
// tracked dynamic region simultaneously, instead of gating it on selection.
// (mapPositionFor / predictedTrajectory / flatToRoad are declared further
// down this file, but as function declarations they're hoisted, so calling
// them here is safe.)
function predictedPathRoad(sim, id) {
  const origin = flatToRoad(mapPositionFor(id, sim).x, mapPositionFor(id, sim).y);
  const steps = predictedTrajectory(sim, id).map((s) => flatToRoad(s.x, s.y));
  return { origin, steps };
}

function Pipeline({ active }) {
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border border-line bg-black/20 p-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-1 flex-wrap items-center gap-1.5">
        {STAGES.map((stage, i) => {
          const done = i <= active;
          return (
            <div className="flex items-center gap-1.5" key={stage.key}>
              <div className={`rounded-md border px-2.5 py-1.5 ${done ? "border-cyanSignal/60 bg-cyanSignal/10" : "border-line bg-black/20"}`}>
                <div className={`text-[10px] font-black tracking-[0.1em] ${done ? "text-cyanSignal" : "text-slate-600"}`}>{i + 1}. {stage.key}</div>
                <div className={`mt-0.5 text-[10px] leading-tight ${done ? "text-slate-300" : "text-slate-600"}`}>{done ? "✓ " : ""}{stage.label}</div>
              </div>
              {i < STAGES.length - 1 && <ChevronRight className={done ? "text-cyanSignal/60" : "text-slate-700"} size={14} />}
            </div>
          );
        })}
      </div>
      <span className="flex shrink-0 items-center gap-2 self-start rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-300 lg:self-auto">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
        Autonomous feedback matrix · Active
      </span>
    </div>
  );
}

function clampU(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

// Real per-object utility factors, computed live from sim state (not
// hardcoded), using the SAME weighted formula and REFINE/MAINTAIN/COARSEN
// thresholds as utils/utilityCalculation.js -- so every object's decision is
// derived the same way the ego reasons about anything it looks at.
function factorsFor(id, sim) {
  const vehicleActive = sim.phase >= 3;
  switch (id) {
    case "vehicle":
      return {
        safetyRelevance: clampU(0.5 + (1 - sim.vehicleDistance / 24) * 0.45, 0.3, 0.97),
        motion: clampU(sim.vehicleSpeedMps / 10, 0, 1),
        uncertainty: clampU(1 - sim.vehicleConfidence, 0.03, 0.6),
        geometricComplexity: 0.46,
        distanceValue: clampU(1 - sim.vehicleDistance / 30, 0.08, 1),
        futureOccupancy: sim.scene.predicted ? clampU(0.3 + (1 - sim.vehicleDistance / 24) * 0.5, 0.1, 0.9) : 0.1,
        baseCost: 0.38,
        dynamic: true,
      };
    case "parkedCar":
      return { safetyRelevance: 0.25, motion: 0, uncertainty: 0.12, geometricComplexity: 0.3, distanceValue: 0.4, futureOccupancy: 0.05, baseCost: 0.22, dynamic: false };
    case "building":
      return { safetyRelevance: 0.15, motion: 0, uncertainty: 0.08, geometricComplexity: 0.5, distanceValue: 0.25, futureOccupancy: 0.02, baseCost: 0.2, dynamic: false };
    case "animal":
      return {
        safetyRelevance: sim.phase >= 4 ? 0.95 : 0.52,
        motion: sim.phase >= 3 ? 0.88 : 0.18,
        uncertainty: sim.phase >= 2 ? 0.42 : 0.16,
        geometricComplexity: 0.36,
        distanceValue: clampU(1 - sim.obstacleY / 40, 0.08, 1),
        futureOccupancy: sim.scene.predicted ? 0.79 : 0.12,
        baseCost: 0.3,
        // An animal darting across the road is a moving actor by definition --
        // unlike a real road barrier, it has no business being "static".
        dynamic: true,
      };
    // The ego's own reference profile -- not a tracked object, just the
    // "nothing to worry about" baseline every other object is measured
    // against, so the UI can say WHY something outranks the ego's own idle state.
    case "ego":
      return { safetyRelevance: 0.2, motion: 0.1, uncertainty: 0.05, geometricComplexity: 0.2, distanceValue: 0.1, futureOccupancy: 0.05, baseCost: 0.15, dynamic: false };
    default:
      return null;
  }
}

function utilityFor(factors) {
  const ig = clampU(
    factors.safetyRelevance * 0.27 +
      factors.motion * 0.18 +
      factors.uncertainty * 0.2 +
      factors.geometricComplexity * 0.15 +
      factors.distanceValue * 0.08 +
      factors.futureOccupancy * 0.12,
    0.04,
    0.98,
  );
  const cost = clampU(factors.baseCost + ig * 0.11 + (factors.dynamic ? 0.08 : 0), 0.1, 0.82);
  const utility = ig / cost;
  const decision = utility > 1.8 ? "REFINE" : utility > 1.08 ? "MAINTAIN" : "COARSEN";
  return { ig, cost, utility, decision };
}

// Static per-object facts + live-computed utility. rows are the metrics the
// Object Information card displays; factors/ig/cost/utility/decision feed
// the Information Utility Engine's per-object comparison against the ego.
function objectInfoFor(id, sim) {
  const factors = factorsFor(id, sim);
  if (!factors) return null;
  const { ig, cost, utility, decision } = utilityFor(factors);
  const base = { factors, ig, cost, utility, decision };
  switch (id) {
    case "vehicle":
      return {
        ...base, name: "Moving Vehicle #1", badge: "DYNAMIC",
        rows: [
          ["Distance", `${sim.vehicleDistance.toFixed(1)} m`],
          ["Velocity", `${sim.vehicleSpeedMps.toFixed(1)} m/s`],
          ["Predicted Position", `+${sim.vehiclePredictedDisplacement.toFixed(1)} m (1.5s)`],
          ["Confidence", `${Math.round(sim.vehicleConfidence * 100)}%`],
        ],
      };
    case "parkedCar":
      return { ...base, name: "Parked Car", badge: "STATIC", rows: [["Distance", "18.4 m"], ["Velocity", "0.0 m/s"], ["Occupancy", "84%"], ["Confidence", "97%"]] };
    case "building":
      return { ...base, name: "Building Facade", badge: "STATIC", rows: [["Distance", "31.2 m"], ["Velocity", "0.0 m/s"], ["Occupancy", "96%"], ["Confidence", "93%"]] };
    case "animal":
      return {
        ...base, name: "Animal", badge: "DYNAMIC · HAZARD",
        rows: [
          ["Distance", `${(sim.obstacleY * 0.6).toFixed(1)} m`],
          ["Velocity", `${(factors.motion * 3).toFixed(1)} m/s`],
          ["Predicted overlap", sim.scene.predicted ? "Yes" : "No"],
          ["Confidence", `${Math.round(sim.confidence * 100)}%`],
        ],
      };
    // The ego's own baseline row isn't shown in the Object panel (it's
    // never "selected" from the scene), but UtilityPanel needs a full
    // objectInfoFor("ego", sim) result to build its comparison box.
    case "ego":
      return {
        ...base, name: "Ego Vehicle", badge: "BASELINE",
        rows: [
          ["Distance", "0.0 m"],
          ["Velocity", `${sim.speed.toFixed(1)} m/s`],
          ["Predicted overlap", "N/A"],
          ["Confidence", "N/A"],
        ],
      };
    default:
      return null;
  }
}

// Both ObjectPanel and UtilityPanel need "what's actually selected right
// now, falling back sensibly if the animal isn't on screen this phase" --
// shared here so the two panels can't drift out of sync with each other.
function resolveSelected(selectedObjectId, sim) {
  const id = selectedObjectId === "animal" && !sim.scene.obstacle ? "vehicle" : selectedObjectId;
  return { id, info: objectInfoFor(id, sim) ?? objectInfoFor("vehicle", sim) };
}

function SimulationView({ sim, controls, setControls, resetSimulation, onStep, isAdvancingFrame, frameNumber, selectedObjectId, setSelectedObjectId }) {
  const pos = scenePositions(sim);
  const obstacleVisible = sim.scene.obstacle;
  const corridorBlocked = sim.phase >= 4;

  const egoPt = corner(pos.ego.depth, pos.ego.lateral);
  const vehiclePt = corner(pos.vehicle.depth, pos.vehicle.lateral);
  const animalPt = corner(pos.animal.depth, pos.animal.lateral);
  const parkedCarPt = corner(pos.parkedCar.depth, pos.parkedCar.lateral);
  const buildingPt = corner(pos.building.depth, pos.building.lateral);

  // red = dynamic/critical, amber = relevant, blue = static -- same color
  // language the Comparison page uses for its cell-importance legend.
  const vehicleColor = sim.phase >= 3 ? "#f87171" : "#fbbf24";
  const animalColor = sim.refine ? "#f87171" : "#fbbf24";

  const vehicleW = sizeAt(pos.vehicle.depth, 11, 3);
  const vehicleBoxW = sizeAt(pos.vehicle.depth, 9, 3);
  const vehicleBoxH = sizeAt(pos.vehicle.depth, 8.5, 2.6);

  const animalW = sizeAt(pos.animal.depth, 8.5, 2.6);
  const animalBoxW = sizeAt(pos.animal.depth, 9, 3);
  const animalBoxH = sizeAt(pos.animal.depth, 6.5, 2.2);

  const parkedCarW = sizeAt(pos.parkedCar.depth, 11, 3);
  const parkedCarBoxW = sizeAt(pos.parkedCar.depth, 9.5, 3);
  const parkedCarBoxH = sizeAt(pos.parkedCar.depth, 9, 3);

  const buildingW = sizeAt(pos.building.depth, 20, 6);
  const buildingBoxW = sizeAt(pos.building.depth, 17, 6);
  const buildingBoxH = sizeAt(pos.building.depth, 30, 10);

  // Predicted future path for EVERY dynamic object at once -- vehicle
  // always, animal whenever it's on screen -- using the same forward-
  // simulated trajectory FutureProbabilityLayer uses, so the two panels
  // agree on where each object is headed. Mirrors how the Live System page
  // (AdaptiveMap.jsx) draws a projected path for every tracked dynamic
  // region simultaneously, instead of gating it on which one is selected.
  const vehiclePath = predictedPathRoad(sim, "vehicle");
  const animalPath = obstacleVisible ? predictedPathRoad(sim, "animal") : null;
  const pathD = (path) => `M${path.origin.x} ${path.origin.y} ${path.steps.map((p) => `L${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ")}`;

  const safePath = corridorBlocked
    ? (() => {
        const p2 = corner(0.28, 0.38);
        const p3 = corner(0.55, 0.24);
        const p4 = corner(0.78, 0.19);
        return `M${egoPt.x} ${egoPt.y} C ${p2.x} ${p2.y}, ${p3.x} ${p3.y}, ${p4.x} ${p4.y}`;
      })()
    : null;

  const frameBase = (frameNumber ?? 32) - (frameNumber ? frameNumber % 1 : 0);
  const filmstrip = Array.from({ length: 7 }, (_, i) => Math.max(0, Math.round(frameBase) - 3 + i));

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border-2 border-cyanSignal/40 bg-slate-950">
      <div className="flex items-center justify-between border-b border-cyanSignal/20 bg-cyanSignal/5 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-cyanSignal/15 text-cyanSignal"><ScanLine size={16} /></span>
          <div>
            <div className="text-sm font-bold text-white">Simulation View</div>
            <div className="text-xs text-slate-400">Ego vehicle perspective, synthetic sensor frame</div>
          </div>
        </div>
        <span className="hidden shrink-0 items-center gap-1 rounded-full border border-cyanSignal/40 bg-cyanSignal/10 px-2.5 py-1 text-[11px] font-bold text-cyanSignal sm:flex">
          <Crosshair size={12} /> Live Tracking
        </span>
      </div>

      <SceneMedia
        overlay={(
          <>
            {/* predicted future path -- drawn for every dynamic object at
                once (violet dashed + growing dots), not just whichever is
                selected. Matches the "Predicted Corridor" legend entry. */}
            <path d={pathD(vehiclePath)} fill="none" opacity="0.85" stroke="#a78bfa" strokeDasharray="1.4 1.2" strokeWidth="0.5" />
            {vehiclePath.steps.map((p, i) => (
              <circle cx={p.x} cy={p.y} fill="#a78bfa" fillOpacity={0.3 + i * 0.1} key={`veh-pt-${i}`} r={0.5 + i * 0.12} />
            ))}
            {animalPath && <path d={pathD(animalPath)} fill="none" opacity="0.85" stroke="#a78bfa" strokeDasharray="1.4 1.2" strokeWidth="0.5" />}
            {animalPath && animalPath.steps.map((p, i) => (
              <circle cx={p.x} cy={p.y} fill="#a78bfa" fillOpacity={0.3 + i * 0.1} key={`ani-pt-${i}`} r={0.5 + i * 0.12} />
            ))}
            {safePath && <path d={safePath} fill="none" opacity="0.14" stroke="#22c55e" strokeWidth="3.5" />}
            {safePath && <path d={safePath} fill="none" opacity="0.9" stroke="#22c55e" strokeDasharray="1.4 1" strokeWidth="0.55" />}
          </>
        )}
      >
        <BuildingSprite cx={buildingPt.x} cy={buildingPt.y} w={buildingW} />
        <SceneBox
          color="#38bdf8"
          h={buildingBoxH}
          label="Building"
          onClick={() => setSelectedObjectId("building")}
          selected={selectedObjectId === "building"}
          sub="static"
          w={buildingBoxW}
          x={buildingPt.x - buildingBoxW / 2}
          y={buildingPt.y - buildingBoxH / 2}
        />

        <CarSprite color="#38bdf8" cx={parkedCarPt.x} cy={parkedCarPt.y} w={parkedCarW} />
        <SceneBox
          color="#38bdf8"
          h={parkedCarBoxH}
          label="Parked Car"
          onClick={() => setSelectedObjectId("parkedCar")}
          selected={selectedObjectId === "parkedCar"}
          sub="static"
          w={parkedCarBoxW}
          x={parkedCarPt.x - parkedCarBoxW / 2}
          y={parkedCarPt.y - parkedCarBoxH / 2}
        />

        <EgoCar />

        <CarSprite color={vehicleColor} cx={vehiclePt.x} cy={vehiclePt.y} w={vehicleW} />
        <SceneBox
          color={vehicleColor}
          h={vehicleBoxH}
          label="Moving Vehicle"
          onClick={() => setSelectedObjectId("vehicle")}
          selected={selectedObjectId === "vehicle"}
          sub={`${sim.vehicleSpeedMps.toFixed(1)} m/s`}
          w={vehicleBoxW}
          x={vehiclePt.x - vehicleBoxW / 2}
          y={vehiclePt.y - vehicleBoxH / 2}
        />

        <AnimatePresence>
          {obstacleVisible && (
            <motion.div
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              initial={{ opacity: 0, scale: 0.6 }}
              key="animal"
              style={{ position: "absolute", inset: 0, transformOrigin: `${animalPt.x}% ${animalPt.y}%` }}
            >
              <AnimalSprite color={animalColor} cx={animalPt.x} cy={animalPt.y} w={animalW} />
              <SceneBox
                color={animalColor}
                h={animalBoxH}
                label="Animal"
                onClick={() => setSelectedObjectId("animal")}
                selected={selectedObjectId === "animal"}
                sub={sim.phase >= 2 ? "detected" : "emerging"}
                w={animalBoxW}
                x={animalPt.x - animalBoxW / 2}
                y={animalPt.y - animalBoxH / 2}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </SceneMedia>

      <div className="p-4">
        <div className="mb-3 flex flex-wrap gap-3 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
          <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-rose-400" />High / Dynamic</span>
          <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-amber-400" />Medium / Relevant</span>
          <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-sky-400" />Static / Background</span>
          <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-violet-400" />Predicted Corridor</span>
          <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-400" />Safe Corridor</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button className="control-button flex items-center gap-2" onClick={() => setControls((c) => ({ ...c, running: !c.running }))} type="button">
            {controls.running ? <Pause size={15} /> : <Play size={15} />}{controls.running ? "Pause" : "Play"}
          </button>
          <button className="control-button flex items-center gap-2" onClick={resetSimulation} type="button">
            <RotateCcw size={15} /> Reset
          </button>
          <button className="control-button flex items-center gap-2 disabled:cursor-wait disabled:opacity-60" disabled={isAdvancingFrame} onClick={onStep} type="button">
            <SkipForward size={15} /> {isAdvancingFrame ? "Advancing…" : "Next Frame"}
          </button>
          <button className={`control-button flex items-center gap-2 ${controls.demoActive ? "control-button-active" : ""}`} onClick={() => setControls((c) => ({ ...c, demoActive: !c.demoActive, running: true, showPrediction: true, demoStep: c.demoActive ? c.demoStep : 0 }))} type="button">
            {controls.demoActive ? "Demo Running" : "Run Demo"}
          </button>
          <label className="flex items-center gap-2 rounded-md border border-line bg-slate-950/70 px-3 py-2 text-xs font-semibold text-slate-400">Simulation Speed
            <input type="range" min="0.4" max="2.4" step="0.2" value={controls.speed} onChange={(e) => setControls((c) => ({ ...c, speed: Number(e.target.value) }))} />
            <span className="font-mono text-cyanSignal">{controls.speed.toFixed(1)}x</span>
          </label>
        </div>

        <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-1">
          {filmstrip.map((n, i) => (
            <div
              key={`${n}-${i}`}
              className={`flex shrink-0 flex-col items-center gap-1 rounded-md border px-2 py-1.5 ${i === 3 ? "border-cyanSignal/70 bg-cyanSignal/10" : "border-line bg-black/20"}`}
            >
              <div className={`h-6 w-9 rounded-sm ${i === 3 ? "bg-cyanSignal/20" : "bg-slate-800/60"}`} />
              <span className={`text-[9px] font-bold ${i === 3 ? "text-cyanSignal" : "text-slate-500"}`}>Frame {n}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Gaussian-ish falloff used to paint the future occupancy/relevance layer.
// Anisotropic on purpose: spread is longer along the direction of travel
// (where the tracked object is likely to actually go) and tighter
// cross-track, and the whole thing widens as tracking confidence drops --
// more uncertainty -> a broader, softer probability field, not a sharper one.
function occupancyValue(x, y, cx, cy, sigmaX, sigmaY) {
  const dx = x - cx;
  const dy = y - cy;
  return Math.exp(-((dx * dx) / (2 * sigmaX * sigmaX) + (dy * dy) / (2 * sigmaY * sigmaY)));
}

function probabilityColor(v) {
  // transparent/slate at low relevance -> cyan -> violet -> hot red at the
  // most likely future cell. Colour, not just opacity, encodes probability
  // so the peak reads as "hot" at a glance.
  if (v < 0.18) return "#0ea5b7";
  if (v < 0.4) return "#22d3ee";
  if (v < 0.65) return "#a78bfa";
  return "#f43f5e";
}

const PREDICTION_HORIZON_S = 1.5;
const TRAJECTORY_SAMPLES = 5;

// Where each trackable object sits in the shared 0-100 map viewBox --
// same coordinate frame the top-view (resolution) map uses, so the
// probability view lines up with it exactly. Ego is fixed at the bottom
// of the frame; everything else is positioned relative to it, which is
// what lets "moves relative to ego" mean something concrete here.
function mapPositionFor(id, sim) {
  const movingVehicleTopY = clamp(22 + (24 - sim.vehicleDistance) * 2.1, 22, 70);
  switch (id) {
    case "vehicle":
      return { x: 50, y: movingVehicleTopY };
    case "parkedCar":
      return { x: 22, y: 38 };
    case "building":
      return { x: 79, y: 15 };
    case "animal":
      return { x: sim.obstacleX, y: sim.obstacleY };
    case "ego":
    default:
      return { x: 50, y: 88 };
  }
}

// A real motion predictor doesn't collapse the whole horizon into one frozen
// ellipse -- it forward-simulates a handful of time slices and the
// per-cell probability is the envelope over all of them. Doing it this way
// (instead of a single Gaussian at the +1.5s point) is what makes the field
// fan out like a cone instead of reading as one clean, too-linear blob:
// each slice drifts a little sideways (unmodeled lane micro-drift / steering
// noise) and grows a little more uncertain the further out it is.
//
// Generalized to whichever object is selected (not just the moving vehicle):
// static objects (parked car, building) don't travel, so their "future" is
// just their current cell held with high, non-growing confidence -- there's
// no cone to fan out, only a steady near-certain spot. The animal and the
// vehicle are both genuinely dynamic actors, so both get a forward-simulated
// fan instead.
function predictedTrajectory(sim, id) {
  const pos = mapPositionFor(id, sim);
  const info = objectInfoFor(id, sim);
  const dynamic = info?.factors?.dynamic ?? false;
  const uncertainty = info?.factors?.uncertainty ?? 0.1; // consistent with the Utility Engine's own uncertainty bar
  // The animal's speed is derived from its own motion factor (same source the
  // Utility Engine bars read) rather than a separate hardcoded number, so the
  // two views can't drift out of sync with each other.
  const speedMps = id === "vehicle" ? sim.vehicleSpeedMps : id === "animal" ? info.factors.motion * 3 : 0;
  const pxPerMeter = 2.1;
  // Ties the lateral wander to live sim state (not Math.random()) so it's
  // reproducible for a given frame but still drifts as the scenario plays,
  // instead of a perfectly straight, static tube.
  const seed = pos.x * 1.3 + pos.y * 1.1 + sim.phase * 0.6;

  const steps = [];
  for (let i = 1; i <= TRAJECTORY_SAMPLES; i += 1) {
    const t = (PREDICTION_HORIZON_S * i) / TRAJECTORY_SAMPLES;
    if (!dynamic) {
      steps.push({
        t,
        x: pos.x,
        y: pos.y,
        sigmaY: 3 + uncertainty * 6,
        sigmaX: 3 + uncertainty * 6,
        weight: 1,
      });
      continue;
    }
    const travelledPx = speedMps * t * pxPerMeter;
    const wander = Math.sin(seed + t * 3.1) * (2.4 + uncertainty * 11) * (t / PREDICTION_HORIZON_S)
      + Math.sin(seed * 1.7 + t * 6.4) * (1.1 + uncertainty * 4) * (t / PREDICTION_HORIZON_S);
    steps.push({
      t,
      x: clamp(pos.x + wander, 17, 83),
      y: clamp(pos.y - travelledPx, 8, 90),
      // uncertainty compounds with the prediction horizon -- sqrt-time growth
      // is the usual assumption for accumulated motion-model error.
      sigmaY: 4.5 + uncertainty * 22 + Math.sqrt(t) * 6.5,
      sigmaX: 2.6 + uncertainty * 9 + Math.sqrt(t) * 3,
      weight: 0.5 + 0.5 * (i / TRAJECTORY_SAMPLES),
    });
  }
  return steps;
}

// Projects a point from the flat top-down map (x,y in the same 0..100
// viewBox mapPositionFor/occupancyValue/predictedTrajectory already use)
// into the SceneShowcase road-perspective point. The probability field's
// math stays entirely in flat space, unchanged -- only how it's drawn
// changes, so nothing about the underlying prediction logic is at risk here.
function flatToRoad(x, y) {
  const lateral = clamp(x / 100, 0, 1);
  const depth = clamp((96 - y) / (96 - 4), 0, 1);
  return corner(depth, lateral);
}

// A flat square cell (center cx,cy, half-width `half`) drawn as a
// perspective-correct quad instead of an axis-aligned rect.
function cellPolygon(cx, cy, half) {
  const pts = [
    flatToRoad(cx - half, cy - half),
    flatToRoad(cx + half, cy - half),
    flatToRoad(cx + half, cy + half),
    flatToRoad(cx - half, cy + half),
  ];
  return pts.map((p) => `${p.x},${p.y}`).join(" ");
}

function FutureProbabilityLayer({ sim, selectedObjectId, setSelectedObjectId, cells, hovered, setHovered, selectedPeak, trajVehicle, trajAnimal }) {
  const { id: selectedId, info } = resolveSelected(selectedObjectId, sim);
  const pos = mapPositionFor(selectedId, sim);
  const dynamic = info.factors.dynamic;
  const step = 5.6;
  const hoveredCell = hovered !== null ? cells[hovered] : null;

  // Same world placement SimulationView uses, so a viewer flipping between
  // the two tabs sees the same objects in the same spots.
  const scenePos = scenePositions(sim);
  const buildingPt = corner(scenePos.building.depth, scenePos.building.lateral);
  const parkedCarPt = corner(scenePos.parkedCar.depth, scenePos.parkedCar.lateral);
  const vehiclePt = corner(scenePos.vehicle.depth, scenePos.vehicle.lateral);
  const animalPt = corner(scenePos.animal.depth, scenePos.animal.lateral);
  const nowPt = flatToRoad(pos.x, pos.y);
  const vehicleTrajRoad = trajVehicle.map((s) => flatToRoad(s.x, s.y));
  const animalTrajRoad = trajAnimal.map((s) => flatToRoad(s.x, s.y));

  const buildingW = sizeAt(scenePos.building.depth, 20, 6);
  const buildingBoxW = sizeAt(scenePos.building.depth, 17, 6);
  const buildingBoxH = sizeAt(scenePos.building.depth, 30, 10);
  const parkedCarW = sizeAt(scenePos.parkedCar.depth, 11, 3);
  const parkedCarBoxW = sizeAt(scenePos.parkedCar.depth, 9.5, 3);
  const parkedCarBoxH = sizeAt(scenePos.parkedCar.depth, 9, 3);
  const vehicleW = sizeAt(scenePos.vehicle.depth, 11, 3);
  const vehicleBoxW = sizeAt(scenePos.vehicle.depth, 9, 3);
  const vehicleBoxH = sizeAt(scenePos.vehicle.depth, 8.5, 2.6);
  const animalW = sizeAt(scenePos.animal.depth, 8.5, 2.6);
  const animalBoxW = sizeAt(scenePos.animal.depth, 9, 3);
  const animalBoxH = sizeAt(scenePos.animal.depth, 6.5, 2.2);

  return (
    <SceneMedia
      overlay={(
        <g onMouseLeave={() => setHovered(null)}>
          {/* per-cell occupancy field, perspective-projected -- the UNION of
              every dynamic object's forward projection, colour encoding P;
              the exact % only appears on hover. */}
          {cells.map((c, i) => {
            const isHovered = i === hovered;
            return (
              <polygon
                fill={probabilityColor(c.v)}
                fillOpacity={isHovered ? clamp(c.v * 0.85 + 0.2, 0.3, 0.95) : clamp(c.v * 0.85, 0.05, 0.82)}
                key={i}
                onMouseEnter={() => setHovered(i)}
                points={cellPolygon(c.x, c.y, step / 2)}
                stroke={isHovered ? "#ffffff" : "none"}
                strokeOpacity="0.9"
                strokeWidth={isHovered ? 0.3 : 0}
                style={{ cursor: "crosshair" }}
              />
            );
          })}

          {/* forward-simulated trajectory for EVERY dynamic object at once --
              growing rings = growing uncertainty the further into the horizon
              that sample sits. The currently selected object is drawn full
              strength; the other stays visible but dimmer. Static objects
              (building/parked car) don't fan out. */}
          <g opacity={selectedId === "vehicle" ? 1 : 0.5}>
            <path
              d={`M${vehiclePt.x} ${vehiclePt.y} ${vehicleTrajRoad.map((p) => `L${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ")}`}
              fill="none"
              opacity="0.55"
              pointerEvents="none"
              stroke="#fda4af"
              strokeDasharray="1.2 1"
              strokeWidth="0.4"
            />
            {vehicleTrajRoad.map((p, i) => (
              <g key={i} pointerEvents="none">
                <circle cx={p.x} cy={p.y} fill="none" opacity={0.3 + i * 0.09} r={0.9 + i * 0.35} stroke="#f43f5e" strokeDasharray="1 1" strokeWidth="0.3" />
                <circle cx={p.x} cy={p.y} fill="#f43f5e" fillOpacity={0.35 + i * 0.11} r="0.65" />
              </g>
            ))}
          </g>
          {sim.scene.obstacle && (
            <g opacity={selectedId === "animal" ? 1 : 0.5}>
              <path
                d={`M${animalPt.x} ${animalPt.y} ${animalTrajRoad.map((p) => `L${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ")}`}
                fill="none"
                opacity="0.55"
                pointerEvents="none"
                stroke="#fda4af"
                strokeDasharray="1.2 1"
                strokeWidth="0.4"
              />
              {animalTrajRoad.map((p, i) => (
                <g key={i} pointerEvents="none">
                  <circle cx={p.x} cy={p.y} fill="none" opacity={0.3 + i * 0.09} r={0.9 + i * 0.35} stroke="#f43f5e" strokeDasharray="1 1" strokeWidth="0.3" />
                  <circle cx={p.x} cy={p.y} fill="#f43f5e" fillOpacity={0.35 + i * 0.11} r="0.65" />
                </g>
              ))}
            </g>
          )}

          {/* selected object's current position -- a small reticle, layered
              under the SceneBox that already labels it. Meaningful even for
              a static selection (building/parked car), which have no fan. */}
          <circle cx={nowPt.x} cy={nowPt.y} fill="#f5d0fe" pointerEvents="none" r="1.3" stroke="#fff" strokeOpacity="0.7" strokeWidth="0.35" />
        </g>
      )}
    >
      <BuildingSprite cx={buildingPt.x} cy={buildingPt.y} w={buildingW} />
      <SceneBox
        color="#38bdf8"
        h={buildingBoxH}
        label="Building"
        onClick={() => setSelectedObjectId("building")}
        selected={selectedId === "building"}
        sub={selectedId === "building" ? "selected" : "P 0.99"}
        w={buildingBoxW}
        x={buildingPt.x - buildingBoxW / 2}
        y={buildingPt.y - buildingBoxH / 2}
      />

      <CarSprite color="#38bdf8" cx={parkedCarPt.x} cy={parkedCarPt.y} w={parkedCarW} />
      <SceneBox
        color="#38bdf8"
        h={parkedCarBoxH}
        label="Parked Car"
        onClick={() => setSelectedObjectId("parkedCar")}
        selected={selectedId === "parkedCar"}
        sub={selectedId === "parkedCar" ? "selected" : "P 0.99"}
        w={parkedCarBoxW}
        x={parkedCarPt.x - parkedCarBoxW / 2}
        y={parkedCarPt.y - parkedCarBoxH / 2}
      />

      <EgoCar />

      <CarSprite color={selectedId === "vehicle" ? "#f5d0fe" : "#94a3b8"} cx={vehiclePt.x} cy={vehiclePt.y} w={vehicleW} />
      <SceneBox
        color={selectedId === "vehicle" ? "#f5d0fe" : "#94a3b8"}
        h={vehicleBoxH}
        label="Moving Vehicle"
        onClick={() => setSelectedObjectId("vehicle")}
        selected={selectedId === "vehicle"}
        sub={selectedId === "vehicle" ? "selected" : "tracked"}
        w={vehicleBoxW}
        x={vehiclePt.x - vehicleBoxW / 2}
        y={vehiclePt.y - vehicleBoxH / 2}
      />

      {sim.scene.obstacle && (
        <>
          <AnimalSprite color={selectedId === "animal" ? "#f5d0fe" : "#fbbf24"} cx={animalPt.x} cy={animalPt.y} w={animalW} />
          <SceneBox
            color={selectedId === "animal" ? "#f5d0fe" : "#fbbf24"}
            h={animalBoxH}
            label="Animal"
            onClick={() => setSelectedObjectId("animal")}
            selected={selectedId === "animal"}
            sub={selectedId === "animal" ? "selected" : "tracked"}
            w={animalBoxW}
            x={animalPt.x - animalBoxW / 2}
            y={animalPt.y - animalBoxH / 2}
          />
        </>
      )}

      <div className="absolute right-2 top-2 rounded-lg border border-line/60 bg-slate-950/85 p-2.5 text-right backdrop-blur-sm">
        <div className="text-[11px] font-bold text-white">NOW · {info.name}</div>
        <div className="mt-1 font-mono text-lg font-black text-rose-300">{Math.round(selectedPeak * 100)}%</div>
        <div className="text-[10px] text-slate-400">{dynamic ? "peak P(occupied) · +1.5s" : "static · no drift"}</div>
        {hoveredCell && (
          <div className="mt-2 border-t border-line/60 pt-2">
            <div className="text-[10px] text-slate-500">Hovered cell</div>
            <div className="font-mono text-base font-black text-white">{Math.round(hoveredCell.v * 100)}%</div>
          </div>
        )}
      </div>
    </SceneMedia>
  );
}

// A Top View object label as an HTML pill positioned in container-percentage
// space, styled to exactly match SceneBox's label markup from Future
// Probability (solid bg-black/85, white bold name, font-mono sub-line) --
// rather than raw SVG <text> anchored only by its left edge, which is what
// let the Building/Dynamic Vehicle labels run past the frame edge and clip.
// Only x is clamped: every real anchor's y already sits well clear of the
// top/bottom edges once the label renders above it (mb-1 + bottom-full).
function TopViewLabel({ x, y, name, decision }) {
  const left = Math.min(92, Math.max(8, x));
  const decisionColor = decision === "REFINE" ? "#22d3ee" : decision === "COARSEN" ? "#94a3b8" : "#34d399";
  return (
    <div className="absolute" style={{ left: `${left}%`, top: `${y}%` }}>
      <div className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-black/85 px-1.5 py-0.5 text-center text-[10px] font-bold leading-tight text-white">
        {name}
        {decision ? <><br /><span className="font-mono font-semibold" style={{ color: decisionColor }}>{decision}</span></> : null}
      </div>
    </div>
  );
}

// Shared photoreal backdrop for BOTH the Simulated and Live Top View tabs --
// the exact same gradient stops and star field SceneBackdrop uses for
// Future Probability (sceneSky's #0a1022 -> #131d38 -> #0c1327, the same
// faint 0.5-opacity star specks), just reprojected for a bird's-eye look
// instead of a road-to-horizon perspective. Callers supply their own road
// polygon (the two Top Views use slightly different road geometry, already
// calibrated to their own sprite positions) but share every other visual
// element, so switching Top View <-> Future Probability, or Simulated <->
// Live, never feels like a different app.
function TopViewBackdrop({ roadPath, egoY = 92, idPrefix = "topView" }) {
  const stars = [
    [6, 5], [92, 6], [4, 22], [95, 26], [8, 55], [93, 58], [5, 82], [94, 80],
    [15, 3], [85, 4], [20, 96], [78, 95], [50, 3], [50, 97],
  ];
  return (
    <>
      <defs>
        <linearGradient id={`${idPrefix}Sky`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#0a1022" />
          <stop offset="70%" stopColor="#131d38" />
          <stop offset="100%" stopColor="#0c1327" />
        </linearGradient>
        <linearGradient id={`${idPrefix}RoadFill`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#161c2b" />
          <stop offset="100%" stopColor="#262c3c" />
        </linearGradient>
        <radialGradient cx="50%" cy={`${egoY}%`} id={`${idPrefix}EgoGlow`} r="48%">
          <stop offset="0%" stopColor="#cfe0ff" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#cfe0ff" stopOpacity="0" />
        </radialGradient>
        {/* soft glow behind the selected sprite, matching SceneBox's
            `box-shadow: 0 0 10px ${color}66` -- SVG has no box-shadow, so
            a blurred, oversized, same-colour rect drawn behind the icon
            gets the same "glowing" read. */}
        <filter height="240%" id={`${idPrefix}Glow`} width="240%" x="-70%" y="-70%">
          <feGaussianBlur stdDeviation="1.4" />
        </filter>
      </defs>
      <rect fill={`url(#${idPrefix}Sky)`} height="100" width="100" />
      {stars.map(([x, y], i) => <circle cx={x} cy={y} fill="#e2e8f0" key={i} opacity="0.5" r="0.32" />)}
      <path d={roadPath} fill={`url(#${idPrefix}RoadFill)`} stroke="#64748b" strokeOpacity="0.3" />
      <rect fill={`url(#${idPrefix}EgoGlow)`} height="100" width="100" />
    </>
  );
}

function AdaptiveSimulationMap({ sim, selectedObjectId, setSelectedObjectId }) {
  const [view, setView] = useState("resolution");
  const fine = sim.refine;
  const obstacleX = sim.obstacleX;
  const obstacleY = sim.obstacleY;
  const safe = sim.phase >= 8;
  const grid = [];
  const step = fine ? 3.2 : sim.phase >= 2 ? 8 : 20;
  for (let y = 5; y < 96; y += step) for (let x = 5; x < 96; x += step) grid.push({ x, y });

  const vehicleActive = sim.phase >= 3;
  const movingVehicleTopY = clamp(22 + (24 - sim.vehicleDistance) * 2.1, 22, 70);

  const { id: selectedId, info: selectedInfo } = resolveSelected(selectedObjectId, sim);
  const dynamicSelected = selectedInfo.factors.dynamic;

  // Same occupancy field FutureProbabilityLayer needs -- computed once here
  // (rather than separately in each tab) so Top View can show the same
  // continuous predicted-path grid Future Probability does, guaranteed to
  // never drift out of sync with it.
  const trajVehicle = useMemo(
    () => predictedTrajectory(sim, "vehicle"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sim.vehicleDistance, sim.vehicleSpeedMps, sim.vehicleConfidence, sim.phase],
  );
  const trajAnimal = useMemo(
    () => (sim.scene.obstacle ? predictedTrajectory(sim, "animal") : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sim.scene.obstacle, sim.obstacleX, sim.obstacleY, sim.phase],
  );
  const selectedTrajectory = useMemo(
    () => predictedTrajectory(sim, selectedId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedId, sim.vehicleDistance, sim.vehicleSpeedMps, sim.vehicleConfidence, sim.obstacleX, sim.obstacleY, sim.phase],
  );
  const fieldStep = 5.6;
  const cells = useMemo(() => {
    const contributors = dynamicSelected ? [...trajVehicle, ...trajAnimal] : [...trajVehicle, ...trajAnimal, ...selectedTrajectory];
    const out = [];
    for (let y = 4; y < 96; y += fieldStep) {
      for (let x = 16; x < 84; x += fieldStep) {
        let v = 0;
        for (const s of contributors) {
          const cand = occupancyValue(x, y, s.x, s.y, s.sigmaX, s.sigmaY) * s.weight;
          if (cand > v) v = cand;
        }
        if (v > 0.045) out.push({ x, y, v });
      }
    }
    return out;
  }, [trajVehicle, trajAnimal, selectedTrajectory, dynamicSelected]);
  const [hovered, setHovered] = useState(null);
  const selectedPeak = useMemo(() => {
    let m = 0;
    for (let y = 4; y < 96; y += fieldStep) {
      for (let x = 16; x < 84; x += fieldStep) {
        let v = 0;
        for (const s of selectedTrajectory) {
          const cand = occupancyValue(x, y, s.x, s.y, s.sigmaX, s.sigmaY) * s.weight;
          if (cand > v) v = cand;
        }
        if (v > m) m = v;
      }
    }
    return m;
  }, [selectedTrajectory]);
  const hoveredCell = hovered !== null ? cells[hovered] : null;

  return (
    <div className="panel">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="section-title mb-0"><Layers3 size={16} /> Adaptive 2.5D Map</div>
        <div className="flex gap-1 rounded-md border border-line bg-black/30 p-0.5">
          <button
            className={`rounded px-2.5 py-1 text-[10px] font-black uppercase tracking-wider transition ${view === "resolution" ? "bg-cyanSignal/15 text-cyanSignal" : "text-slate-500 hover:text-slate-300"}`}
            onClick={() => setView("resolution")}
            type="button"
          >
            Top View
          </button>
          <button
            className={`rounded px-2.5 py-1 text-[10px] font-black uppercase tracking-wider transition ${view === "probability" ? "bg-rose-400/15 text-rose-300" : "text-slate-500 hover:text-slate-300"}`}
            onClick={() => setView("probability")}
            type="button"
          >
            Future Probability
          </button>
        </div>
      </div>
      {view === "resolution" ? (
        <div className="mb-3 flex flex-wrap gap-3 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
          <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-slate-500" />Coarse (50 cm)</span>
          <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-sky-400" />Medium (20 cm)</span>
          <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-cyanSignal" />Fine (5 cm)</span>
          <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-rose-500" />Active ROI</span>
        </div>
      ) : (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
          <span>Occupancy likelihood, horizon +1.5s</span>
          <span className="ml-auto flex items-center gap-1 normal-case tracking-normal">
            <span className="h-2 w-6 rounded-sm" style={{ background: "linear-gradient(90deg,#0ea5b7,#22d3ee,#a78bfa,#f43f5e)" }} />
            <span className="text-slate-500">low</span><span className="text-slate-600">→</span><span className="text-rose-300">high</span>
          </span>
        </div>
      )}
      {view === "resolution" ? (
      <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-line bg-slate-950">
        <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
          <TopViewBackdrop egoY={88} roadPath="M30 0 L70 0 L83 100 L17 100 Z" />
          <path d="M43 0 L45 100 M57 0 L55 100" stroke="#e2e8f0" strokeDasharray="3 4" strokeOpacity="0.22" />
          {grid.map((g, i) => <rect fill="none" height={step - 0.45} key={i} stroke={fine ? "#22d3ee" : "#64748b"} strokeOpacity={fine ? "0.16" : "0.2"} width={step - 0.45} x={g.x} y={g.y} />)}

          {/* continuous predicted-path occupancy field -- same cells (and
              same occupancyValue math) FutureProbabilityLayer renders,
              just as flat squares instead of road-perspective polygons,
              so Top View shows where tracked objects are headed, not only
              where they are now. */}
          {cells.map((c, i) => {
            const isHovered = i === hovered;
            return (
              <rect
                fill={probabilityColor(c.v)}
                fillOpacity={isHovered ? clamp(c.v * 0.85 + 0.2, 0.3, 0.95) : clamp(c.v * 0.85, 0.05, 0.82)}
                height={fieldStep - 0.5}
                key={i}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
                stroke={isHovered ? "#ffffff" : "none"}
                strokeOpacity="0.9"
                strokeWidth={isHovered ? 0.3 : 0}
                style={{ cursor: "crosshair" }}
                width={fieldStep - 0.5}
                x={c.x - fieldStep / 2}
                y={c.y - fieldStep / 2}
              />
            );
          })}

          {/* terrain -- roadside trees */}
          {[[10, 8], [90, 14], [8, 90], [92, 86]].map(([cx, cy], i) => (
            <TreeTop cx={cx} cy={cy} key={i} r={2.6} />
          ))}

          {/* static infrastructure -- always MAINTAIN, clickable to inspect */}
          <g className="cursor-pointer" onClick={() => setSelectedObjectId("building")}>
            <rect fill="#38bdf8" filter="url(#topViewGlow)" fillOpacity={selectedObjectId === "building" ? 0.6 : 0.3} height="14" width="14" x="72" y="8" />
            <BuildingTop color="#38bdf8" h={14} seed={2} w={14} x={72} y={8} />
            <rect fill="none" height="14" rx="1" stroke={selectedObjectId === "building" ? "#fff" : "#38bdf8"} strokeOpacity={selectedObjectId === "building" ? 1 : 0.7} strokeWidth={selectedObjectId === "building" ? 1 : 0.5} width="14" x="72" y="8" />
          </g>
          <g className="cursor-pointer" onClick={() => setSelectedObjectId("parkedCar")}>
            <rect fill="#38bdf8" filter="url(#topViewGlow)" fillOpacity={selectedObjectId === "parkedCar" ? 0.6 : 0.3} height="8" width="12" x="16" y="34" />
            <CarTop color="#38bdf8" cx={22} cy={38} h={8} w={6} />
            <rect fill="none" height="8" rx="1" stroke={selectedObjectId === "parkedCar" ? "#fff" : "#38bdf8"} strokeOpacity={selectedObjectId === "parkedCar" ? 1 : 0.7} strokeWidth={selectedObjectId === "parkedCar" ? 1 : 0.5} width="12" x="16" y="34" />
          </g>

          {/* moving vehicle -- clickable */}
          <g className="cursor-pointer" onClick={() => setSelectedObjectId("vehicle")}>
            <rect fill="#e879f9" filter="url(#topViewGlow)" fillOpacity={selectedObjectId === "vehicle" ? 0.6 : 0.32} height="8" width="10" x="45" y={movingVehicleTopY - 4} />
            <CarTop color="#e879f9" cx={50} cy={movingVehicleTopY} h={8} w={6} />
            <rect fill="none" height="8" rx="1.2" stroke="#fff" strokeOpacity={selectedObjectId === "vehicle" ? 1 : 0.7} strokeWidth={selectedObjectId === "vehicle" ? 1.4 : 0.7} width="10" x="45" y={movingVehicleTopY - 4} />
          </g>
          <path d={`M50 88 L50 ${movingVehicleTopY + 6}`} fill="none" opacity="0.75" stroke="#e879f9" strokeDasharray="2 1.5" strokeWidth="1" />

          {/* animal hazard -- clickable */}
          {sim.scene.obstacle && (
            <g className="cursor-pointer" onClick={() => setSelectedObjectId("animal")}>
              <circle cx={obstacleX} cy={obstacleY} fill="#ef4444" filter="url(#topViewGlow)" fillOpacity={selectedObjectId === "animal" ? 0.6 : 0.32} r="5" />
              <AnimalTop color="#ef4444" cx={obstacleX} cy={obstacleY} h={6} selected={selectedObjectId === "animal"} w={9} />
            </g>
          )}
          {fine && sim.scene.predicted && <circle cx={obstacleX} cy={obstacleY} fill="#ef4444" fillOpacity="0.06" r="13" stroke="#ef4444" strokeDasharray="2 1.5" strokeWidth="0.8" />}

          {safe && <path d="M50 88 C 48 72, 43 61, 34 50 C 30 44, 28 38, 28 28" fill="none" stroke="#22c55e" strokeOpacity="0.13" strokeWidth="7" />}
          {safe && <path d="M50 88 C 48 72, 43 61, 34 50 C 30 44, 28 38, 28 28" fill="none" stroke="#22c55e" strokeDasharray="2 1" strokeWidth="1.1" />}

          {/* ego -- always carries a soft red glow, matching EgoCar's
              constant taillight-red drop-shadow in Future Probability. */}
          <circle cx={50} cy={88} fill="#ef4444" filter="url(#topViewGlow)" fillOpacity="0.4" r="4.5" />
          <CarTop color="#22d3ee" cx={50} cy={88} h={8} w={6} />
        </svg>

        {/* HTML pill labels over the SVG -- unlike raw <text>, these clamp
            to stay inside the frame instead of running off the edge near
            x=0/x=100 (that clipping was the bug in the earlier screenshot). */}
        <TopViewLabel decision="MAINTAIN" name="Building" x={79} y={8} />
        <TopViewLabel decision="MAINTAIN" name="Parked Car" x={22} y={34} />
        <TopViewLabel decision={vehicleActive ? "REFINE" : "MAINTAIN"} name="Dynamic Vehicle" x={50} y={movingVehicleTopY - 4} />
        {sim.scene.obstacle && (
          <TopViewLabel decision={sim.decision} name="Animal" x={obstacleX} y={obstacleY - 4} />
        )}
        <TopViewLabel decision={null} name="Ego" x={50} y={94} />

        <div className="absolute left-2 top-2 text-[9px] font-bold uppercase tracking-wider text-slate-500">+Y ahead</div>
        {fine && <div className="absolute bottom-2 left-2 rounded bg-cyanSignal/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-cyanSignal">Fine ROI · 5 cm</div>}

        <div className="absolute right-2 top-2 rounded-lg border border-line/60 bg-slate-950/85 p-2.5 text-right backdrop-blur-sm">
          <div className="text-[11px] font-bold text-white">TOP VIEW · {resolveSelected(selectedObjectId, sim).info.name}</div>
          <div className="mt-1 font-mono text-lg font-black text-cyanSignal">{fine ? "5 cm" : sim.phase >= 2 ? "20 cm" : "50 cm"}</div>
          <div className="text-[10px] text-slate-400">allocated resolution</div>
          {hoveredCell && (
            <div className="mt-2 border-t border-line/60 pt-2">
              <div className="text-[10px] text-slate-500">Hovered cell</div>
              <div className="font-mono text-base font-black text-white">{Math.round(hoveredCell.v * 100)}%</div>
            </div>
          )}
        </div>
      </div>
      ) : (
      <div className="overflow-hidden rounded-lg border border-line">
        <FutureProbabilityLayer
          cells={cells}
          hovered={hovered}
          selectedObjectId={selectedObjectId}
          selectedPeak={selectedPeak}
          setHovered={setHovered}
          setSelectedObjectId={setSelectedObjectId}
          sim={sim}
          trajAnimal={trajAnimal}
          trajVehicle={trajVehicle}
        />
      </div>
      )}
      <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
        {view === "resolution"
          ? "Cell size follows allocated resolution, not raw distance -- the same region can be maintained, refined or coarsened as its information value changes."
          : "Colour encodes the SELECTED object's modeled P(occupied) within the +1.5s horizon, relative to the ego vehicle's fixed position -- moving objects fan out, static ones hold their cell. Click any object to switch. Hover any cell to read its exact probability."}
      </p>
    </div>
  );
}

// Live Backend counterpart of AdaptiveSimulationMap above: same Top View /
// Future Probability toggle and the same photoreal gradient/sprite
// treatment, but every position, sprite type, decision and probability
// comes from the real backend's regions (via liveAdapter.js's
// currentPosition/futurePosition/futureTrack/decision fields) instead of
// the scripted animal-crossing narrative. Reuses AdaptiveMap.jsx's own
// palette()/shapeFor()/hashRegionId()/Backdrop/baseCells() so this view and
// the plain Live System map can never disagree about what a region IS or
// where it sits -- only how it's presented.
// Live Backend counterpart of SimulationView above: the same ego-perspective
// panel (SceneMedia backdrop, side-view sprites, SceneBox labels), but every
// object comes from the real backend's regions instead of the scripted
// animal-crossing narrative -- this is the panel that was missing entirely
// from the Live Backend page, which is why it structurally didn't match the
// Simulated demo layout even after the map itself got matching visuals.
// Only regions with a recognisable sprite (car/person/building/barrier) are
// drawn here -- small background regions (curb/road/unknown) are already
// covered exhaustively by the Top View map next to this panel, and drawing
// a sprite for every one of them here would just be clutter.
function LiveSimulationView({ regions, selectedRegionId, setSelectedRegionId, onAdvanceFrame, isAdvancingFrame, frameNumber }) {
  const toDepthLateral = (pos) => ({
    depth: clamp(1 - (pos?.y ?? 90) / 100, 0.02, 0.95),
    lateral: clamp((pos?.x ?? 50) / 100, 0.05, 0.95),
  });
  const spriteRegions = regions.filter((r) => shapeFor(r).type !== "dot");
  const pathRegions = regions.filter((r) => r.kind === "dynamic" && r.futureTrack?.length > 0);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border-2 border-cyanSignal/40 bg-slate-950">
      <div className="flex items-center justify-between border-b border-cyanSignal/20 bg-cyanSignal/5 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-cyanSignal/15 text-cyanSignal"><ScanLine size={16} /></span>
          <div>
            <div className="text-sm font-bold text-white">Live Sensor View</div>
            <div className="text-xs text-slate-400">Ego vehicle perspective, real backend frame</div>
          </div>
        </div>
        <span className="hidden shrink-0 items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-bold text-emerald-300 sm:flex">
          <Crosshair size={12} /> Live Tracking
        </span>
      </div>

      <SceneMedia
        overlay={(
          <>
            {/* predicted future path -- every dynamic region with a real
                futureTrack, not just the selected one, same as
                SimulationView drawing every object's path at once. */}
            {pathRegions.map((r) => {
              const points = [r.currentPosition, ...r.futureTrack.map((f) => f.position)].map((p) => {
                const { depth, lateral } = toDepthLateral(p);
                return corner(depth, lateral);
              });
              const d = `M${points[0].x} ${points[0].y} ${points.slice(1).map((p) => `L${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ")}`;
              return (
                <g key={r.id}>
                  <path d={d} fill="none" opacity="0.85" stroke="#a78bfa" strokeDasharray="1.4 1.2" strokeWidth="0.5" />
                  {points.slice(1).map((p, i) => <circle cx={p.x} cy={p.y} fill="#a78bfa" fillOpacity={0.3 + i * 0.1} key={i} r={0.5 + i * 0.12} />)}
                </g>
              );
            })}
          </>
        )}
      >
        {spriteRegions.map((region) => {
          const { depth, lateral } = toDepthLateral(region.currentPosition);
          const pt = corner(depth, lateral);
          const shape = shapeFor(region);
          const color = palette(region);
          const selected = selectedRegionId === region.id;
          const tall = shape.type === "building";
          const w = sizeAt(depth, tall ? 20 : shape.type === "person" ? 6 : 11, tall ? 6 : shape.type === "person" ? 2 : 3);
          const boxW = sizeAt(depth, tall ? 17 : 9.5, tall ? 6 : 3);
          const boxH = sizeAt(depth, tall ? 30 : 9, tall ? 10 : 3);

          let sprite;
          if (shape.type === "car") sprite = <CarSprite color={color} cx={pt.x} cy={pt.y} w={w} />;
          else if (shape.type === "person") sprite = <PedestrianSprite color={color} cx={pt.x} cy={pt.y} w={w} />;
          else if (shape.type === "building") sprite = <BuildingSprite cx={pt.x} cy={pt.y} w={w} />;
          else sprite = <SignSprite cx={pt.x} cy={pt.y} w={w} />;

          return (
            <div key={region.id}>
              {sprite}
              <SceneBox
                color={color}
                h={boxH}
                label={region.name}
                onClick={() => setSelectedRegionId(region.id)}
                selected={selected}
                sub={region.decision}
                w={boxW}
                x={pt.x - boxW / 2}
                y={pt.y - boxH / 2}
              />
            </div>
          );
        })}
        <EgoCar />
      </SceneMedia>

      <div className="p-4">
        <div className="mb-3 flex flex-wrap gap-3 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
          <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-cyanSignal" />Refine</span>
          <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-400" />Maintain</span>
          <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-slate-500" />Coarsen</span>
          <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-violet-400" />Predicted Path</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button className="control-button flex items-center gap-2 disabled:cursor-wait disabled:opacity-60" disabled={isAdvancingFrame || !onAdvanceFrame} onClick={onAdvanceFrame} type="button">
            <SkipForward size={15} /> {isAdvancingFrame ? "Advancing…" : "Next Frame"}
          </button>
          <span className="text-xs text-slate-500">Frame {frameNumber ?? "--"} · {regions.length} tracked regions from the real backend</span>
        </div>
      </div>
    </div>
  );
}

// Live Backend counterpart of FutureProbabilityLayer above: the same
// ego-perspective camera (flatToRoad projection, perspective-correct
// cellPolygon cells, SceneMedia backdrop) instead of the bird's-eye Top
// View camera -- this is what was missing. Live's Future Probability tab
// was reusing the bird's-eye camera for both tabs, which is why it never
// looked like the Simulated demo's Future Probability tab even after the
// cell grid and glow treatment already matched.
function LiveFutureProbabilityLayer({ regions, selectedRegionId, setSelectedRegionId, cells, hovered, setHovered, selectedPeak }) {
  const selectedRegion = regions.find((r) => r.id === selectedRegionId) ?? regions[0] ?? null;
  const step = 5.6;
  const hoveredCell = hovered !== null ? cells[hovered] : null;
  const nowPt = selectedRegion ? flatToRoad(selectedRegion.currentPosition.x, selectedRegion.currentPosition.y) : corner(0, 0.5);
  const spriteRegions = regions.filter((r) => shapeFor(r).type !== "dot");
  const pathRegions = regions.filter((r) => r.kind === "dynamic" && r.futureTrack?.length > 0);

  return (
    <SceneMedia
      overlay={(
        <g onMouseLeave={() => setHovered(null)}>
          {/* per-cell occupancy field, perspective-projected -- identical
              math to the bird's-eye Top View's cells, just drawn as a
              road-perspective quad instead of an axis-aligned square. */}
          {cells.map((c, i) => {
            const isHovered = i === hovered;
            return (
              <polygon
                fill={probabilityColor(c.v)}
                fillOpacity={isHovered ? clamp(c.v * 0.85 + 0.2, 0.3, 0.95) : clamp(c.v * 0.85, 0.05, 0.82)}
                key={i}
                onMouseEnter={() => setHovered(i)}
                points={cellPolygon(c.x, c.y, step / 2)}
                stroke={isHovered ? "#ffffff" : "none"}
                strokeOpacity="0.9"
                strokeWidth={isHovered ? 0.3 : 0}
                style={{ cursor: "crosshair" }}
              />
            );
          })}

          {/* real predicted path for every dynamic region at once -- the
              selected one drawn full strength, the rest dimmer. */}
          {pathRegions.map((r) => {
            const isSelected = r.id === selectedRegionId;
            const start = flatToRoad(r.currentPosition.x, r.currentPosition.y);
            const roadPts = r.futureTrack.map((f) => flatToRoad(f.position.x, f.position.y));
            return (
              <g key={r.id} opacity={isSelected ? 1 : 0.5}>
                <path
                  d={`M${start.x} ${start.y} ${roadPts.map((p) => `L${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ")}`}
                  fill="none"
                  opacity="0.55"
                  pointerEvents="none"
                  stroke="#fda4af"
                  strokeDasharray="1.2 1"
                  strokeWidth="0.4"
                />
                {roadPts.map((p, i) => (
                  <g key={i} pointerEvents="none">
                    <circle cx={p.x} cy={p.y} fill="none" opacity={0.3 + i * 0.09} r={0.9 + i * 0.35} stroke="#f43f5e" strokeDasharray="1 1" strokeWidth="0.3" />
                    <circle cx={p.x} cy={p.y} fill="#f43f5e" fillOpacity={0.35 + i * 0.11} r="0.65" />
                  </g>
                ))}
              </g>
            );
          })}

          {/* selected region's current position -- meaningful even for a
              static selection, which has no fan. */}
          <circle cx={nowPt.x} cy={nowPt.y} fill="#f5d0fe" pointerEvents="none" r="1.3" stroke="#fff" strokeOpacity="0.7" strokeWidth="0.35" />
        </g>
      )}
    >
      {spriteRegions.map((region) => {
        const pt = flatToRoad(region.currentPosition.x, region.currentPosition.y);
        const shape = shapeFor(region);
        const selected = region.id === selectedRegionId;
        const color = selected ? "#f5d0fe" : palette(region);
        const tall = shape.type === "building";
        const depth = clamp((96 - region.currentPosition.y) / (96 - 4), 0, 1);
        const w = sizeAt(depth, tall ? 20 : shape.type === "person" ? 6 : 11, tall ? 6 : shape.type === "person" ? 2 : 3);
        const boxW = sizeAt(depth, tall ? 17 : 9.5, tall ? 6 : 3);
        const boxH = sizeAt(depth, tall ? 30 : 9, tall ? 10 : 3);

        let sprite;
        if (shape.type === "car") sprite = <CarSprite color={color} cx={pt.x} cy={pt.y} w={w} />;
        else if (shape.type === "person") sprite = <PedestrianSprite color={color} cx={pt.x} cy={pt.y} w={w} />;
        else if (shape.type === "building") sprite = <BuildingSprite cx={pt.x} cy={pt.y} w={w} />;
        else sprite = <SignSprite cx={pt.x} cy={pt.y} w={w} />;

        return (
          <div key={region.id}>
            {sprite}
            <SceneBox
              color={color}
              h={boxH}
              label={region.name}
              onClick={() => setSelectedRegionId(region.id)}
              selected={selected}
              sub={selected ? "selected" : region.kind === "dynamic" ? "tracked" : `P ${(region.futureProbability ?? 0.99).toFixed(2)}`}
              w={boxW}
              x={pt.x - boxW / 2}
              y={pt.y - boxH / 2}
            />
          </div>
        );
      })}
      <EgoCar />

      <div className="absolute right-2 top-2 rounded-lg border border-line/60 bg-slate-950/85 p-2.5 text-right backdrop-blur-sm">
        <div className="text-[11px] font-bold text-white">NOW · {selectedRegion?.name ?? "No region"}</div>
        <div className="mt-1 font-mono text-lg font-black text-rose-300">{Math.round(selectedPeak * 100)}%</div>
        <div className="text-[10px] text-slate-400">{selectedRegion?.kind === "dynamic" ? "peak P(occupied)" : "static · no drift"}</div>
        {hoveredCell && (
          <div className="mt-2 border-t border-line/60 pt-2">
            <div className="text-[10px] text-slate-500">Hovered cell</div>
            <div className="font-mono text-base font-black text-white">{Math.round(hoveredCell.v * 100)}%</div>
          </div>
        )}
      </div>
    </SceneMedia>
  );
}

function LiveAdaptiveSceneMap({ regions, selectedRegionId, setSelectedRegionId, onAdvanceFrame }) {
  const [view, setView] = useState("resolution");
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const grid = useMemo(() => baseCells(), []);
  const selectedRegion = regions.find((r) => r.id === selectedRegionId) ?? regions[0] ?? null;
  const dynamicRegions = useMemo(() => regions.filter((r) => r.kind === "dynamic"), [regions]);

  const step = 5.6;
  // Same Gaussian-field approach as the Simulated tab's occupancyValue field,
  // but the sources are the backend's own real futureTrack samples -- sigma
  // is derived from the backend's reported confidence (tighter -> smaller
  // canvas sigma) rather than a scripted uncertainty knob.
  const contributorsFor = (region) => (region?.futureTrack ?? []).map((f, i, arr) => ({
    x: f.position.x,
    y: f.position.y,
    sigma: 2.6 + (1 - (f.confidence ?? 1)) * 14,
    weight: 0.5 + 0.5 * ((i + 1) / Math.max(1, arr.length)),
  }));

  const cells = useMemo(() => {
    const contributors = dynamicRegions.flatMap((r) => contributorsFor(r));
    const out = [];
    for (let y = 4; y < 100; y += step) {
      for (let x = 8; x < 92; x += step) {
        let v = 0;
        for (const s of contributors) {
          const cand = occupancyValue(x, y, s.x, s.y, s.sigma, s.sigma) * s.weight;
          if (cand > v) v = cand;
        }
        if (v > 0.045) out.push({ x, y, v });
      }
    }
    return out;
  }, [dynamicRegions]);

  // Peak shown in the corner readout, scoped to whichever region is
  // selected -- a grid-scan max over ONLY that region's own trajectory
  // contributors, exactly mirroring FutureProbabilityLayer's selectedPeak
  // above (not a raw confidence number, which can be 0 for an object the
  // adapter otherwise reports with a perfectly confident, tight track).
  const selectedPeak = useMemo(() => {
    const contributors = contributorsFor(selectedRegion);
    if (contributors.length === 0) return selectedRegion?.futureProbability ?? 0;
    let m = 0;
    for (let y = 4; y < 100; y += step) {
      for (let x = 8; x < 92; x += step) {
        let v = 0;
        for (const s of contributors) {
          const cand = occupancyValue(x, y, s.x, s.y, s.sigma, s.sigma) * s.weight;
          if (cand > v) v = cand;
        }
        if (v > m) m = v;
      }
    }
    return m;
  }, [selectedRegion]);
  const hovered = hoveredIdx !== null ? cells[hoveredIdx] : null;
  const cm = (metres) => `${Math.round((metres ?? 0.5) * 100)} cm`;

  // Resolve label collisions up front (same utility AdaptiveMap.jsx uses)
  // so labels for closely-clustered regions stack into readable tiers
  // instead of overlapping into smashed-together text.
  const labelAnchors = useMemo(() => layoutLabels(
    regions.map((region) => {
      const shape = shapeFor(region);
      const labelW = Math.max(16, region.name.length * 1.4);
      const labelX = Math.min(90, Math.max(labelW / 2 + 1, region.currentPosition.x));
      const naturalY = Math.max(4, region.currentPosition.y - shape.h / 2 - 1);
      return { id: region.id, cx: labelX, w: labelW + 1.5, baseY: naturalY, h: 5 };
    }),
    { gap: 1.4, step: 5.6, maxTiers: 5 },
  ), [regions]);

  if (regions.length === 0) return null;

  return (
    <div className="panel">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="section-title mb-0"><Layers3 size={16} /> Live Adaptive Map</div>
        <div className="flex gap-1 rounded-md border border-line bg-black/30 p-0.5">
          <button
            className={`rounded px-2.5 py-1 text-[10px] font-black uppercase tracking-wider transition ${view === "resolution" ? "bg-cyanSignal/15 text-cyanSignal" : "text-slate-500 hover:text-slate-300"}`}
            onClick={() => setView("resolution")}
            type="button"
          >
            Top View
          </button>
          <button
            className={`rounded px-2.5 py-1 text-[10px] font-black uppercase tracking-wider transition ${view === "probability" ? "bg-rose-400/15 text-rose-300" : "text-slate-500 hover:text-slate-300"}`}
            onClick={() => setView("probability")}
            type="button"
          >
            Future Probability
          </button>
        </div>
      </div>
      {view === "resolution" ? (
        <div className="mb-3 flex flex-wrap gap-3 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
          <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-cyanSignal" />Refine</span>
          <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-400" />Maintain</span>
          <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-slate-500" />Coarsen</span>
        </div>
      ) : (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
          <span>Occupancy likelihood, real backend prediction</span>
          <span className="ml-auto flex items-center gap-1 normal-case tracking-normal">
            <span className="h-2 w-6 rounded-sm" style={{ background: "linear-gradient(90deg,#0ea5b7,#22d3ee,#a78bfa,#f43f5e)" }} />
            <span className="text-slate-500">low</span><span className="text-slate-600">→</span><span className="text-rose-300">high</span>
          </span>
        </div>
      )}

      <div
        className={`relative aspect-square w-full overflow-hidden rounded-lg border border-line bg-slate-950 ${view === "resolution" && onAdvanceFrame ? "cursor-pointer" : ""}`}
        onClick={view === "resolution" ? onAdvanceFrame : undefined}
      >
        {view === "resolution" ? (
        <>
        <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
          <TopViewBackdrop egoY={94} idPrefix="liveTopView" roadPath="M40 2 L60 2 L74 100 L26 100 Z" />
          <line stroke="#e2e8f0" strokeDasharray="2.6 3.4" strokeOpacity="0.22" x1="50" x2="50" y1="4" y2="100" />
          {grid.map((c) => <rect fill="none" height={c.size} key={c.id} stroke="#64748b" strokeOpacity="0.12" width={c.size} x={c.x} y={c.y} />)}
          <Backdrop />

          {cells.map((c, i) => (
            <rect
              fill={probabilityColor(c.v)}
              fillOpacity={0.16 + c.v * 0.55}
              height={step - 0.5}
              key={i}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx((h) => (h === i ? null : h))}
              stroke={probabilityColor(c.v)}
              strokeOpacity={0.35 + c.v * 0.4}
              width={step - 0.5}
              x={c.x - step / 2}
              y={c.y - step / 2}
            />
          ))}

          {regions.map((region) => {
            const color = palette(region);
            const { x, y } = region.currentPosition;
            const selected = selectedRegion?.id === region.id;
            const shape = shapeFor(region);
            let icon;
            if (shape.type === "car") icon = <CarTop color={color} cx={x} cy={y} dashed={region.kind === "uncertain"} h={shape.h} w={shape.w} />;
            else if (shape.type === "person") icon = <PersonTop color={color} cx={x} cy={y} r={shape.w / 2} selected={selected} />;
            else if (shape.type === "building") icon = <BuildingTop color={color} h={shape.h} seed={hashRegionId(region.id)} w={shape.w} x={x - shape.w / 2} y={y - shape.h / 2} />;
            else if (shape.type === "barrier") icon = <BarrierTop h={shape.h} w={shape.w} x={x - shape.w / 2} y={y - shape.h / 2} />;
            else icon = <circle cx={x} cy={y} fill={color} r={shape.w / 2} />;

            return (
              <g className="cursor-pointer" key={region.id} onClick={(e) => { e.stopPropagation(); setSelectedRegionId(region.id); }}>
                <rect fill={color} filter="url(#liveTopViewGlow)" fillOpacity={selected ? 0.6 : 0.3} height={shape.h} width={shape.w} x={x - shape.w / 2} y={y - shape.h / 2} />
                {icon}
                {selected && (
                  <rect fill="none" height={shape.h + 1.6} rx="1" stroke="#fff" strokeOpacity="0.85" strokeWidth="0.45" width={shape.w + 1.6} x={x - (shape.w + 1.6) / 2} y={y - (shape.h + 1.6) / 2} />
                )}
              </g>
            );
          })}

          <circle cx={50} cy={92} fill="#ef4444" filter="url(#liveTopViewGlow)" fillOpacity="0.4" r="4.2" />
          <CarTop color="#22d3ee" cx={50} cy={92} h={7.5} w={6.8} />
        </svg>

        {regions.map((region) => {
          const shape = shapeFor(region);
          const labelW = Math.max(16, region.name.length * 1.4);
          const labelX = Math.min(90, Math.max(labelW / 2 + 1, region.currentPosition.x));
          const labelY = labelAnchors[region.id] ?? Math.max(4, region.currentPosition.y - shape.h / 2 - 1);
          return <TopViewLabel decision={region.decision} key={`label-${region.id}`} name={region.name} x={labelX} y={labelY} />;
        })}
        <TopViewLabel decision={null} name="Ego" x={50} y={85} />

        <div className="absolute right-2 top-2 rounded-lg border border-line/60 bg-slate-950/85 p-2.5 text-right backdrop-blur-sm">
          <div className="text-[11px] font-bold text-white">TOP VIEW · {selectedRegion?.name ?? "No region"}</div>
          <div className="mt-1 font-mono text-lg font-black text-cyanSignal">{selectedRegion ? cm(selectedRegion.resolutionMetres) : "--"}</div>
          <div className="text-[10px] text-slate-400">allocated resolution</div>
          {hovered && (
            <div className="mt-2 border-t border-line/60 pt-2">
              <div className="text-[10px] text-slate-500">Hovered cell</div>
              <div className="font-mono text-base font-black text-white">{Math.round(hovered.v * 100)}%</div>
            </div>
          )}
        </div>
        </>
        ) : (
          <LiveFutureProbabilityLayer
            cells={cells}
            hovered={hoveredIdx}
            regions={regions}
            selectedPeak={selectedPeak}
            selectedRegionId={selectedRegionId}
            setHovered={setHoveredIdx}
            setSelectedRegionId={setSelectedRegionId}
          />
        )}
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
        {view === "resolution"
          ? "Sprite highlight follows the backend's actual REFINE / MAINTAIN / COARSEN decision for this frame -- not a script. Click any object to inspect it on the right."
          : "Colour encodes each tracked object's real predicted position (region.futureTrack) from the backend's own motion model, not a simulated field. Hover any cell to read its exact probability."}
      </p>
    </div>
  );
}

const DECISION_PILL = {
  REFINE: "bg-cyanSignal/15 text-cyanSignal",
  MAINTAIN: "bg-emerald-400/15 text-emerald-300",
  COARSEN: "bg-slate-700/60 text-slate-400",
};

function ObjectPanel({ sim, selectedObjectId }) {
  const { info } = resolveSelected(selectedObjectId, sim);

  return (
    <div className="panel">
      <div className="section-title"><CarFront size={16} /> Object Information · Selected</div>
      <div className="flex items-center gap-3 rounded-lg border border-line bg-black/20 p-3">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded border border-fuchsia-400/40 bg-fuchsia-500/10">
          <CarFront className="text-fuchsia-300" size={28} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <b className="text-sm text-white">{info.name}</b>
            <span className="rounded-full bg-fuchsia-500/15 px-2 py-0.5 text-[9px] font-black text-fuchsia-300">{info.badge}</span>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${DECISION_PILL[info.decision] ?? DECISION_PILL.COARSEN}`}>{info.decision}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-slate-500">
            {info.rows.map(([label, value]) => (
              <span key={label}>{label} <b className="text-slate-300">{value}</b></span>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-slate-600">Click any object in either view on the left to inspect it here.</p>
    </div>
  );
}

// value = selected object's factor (filled bar); egoValue = the ego's own
// baseline for that same factor, drawn as a thin marker so it's obvious at a
// glance whether the selected object sits above or below the ego reference.
function Bar({ label, value, egoValue, colorClass }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400">
        <span>{label}</span>
        <span>{value.toFixed(2)} <span className="text-slate-600">vs ego {egoValue.toFixed(2)}</span></span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded bg-slate-900">
        <div className={`h-full rounded ${colorClass}`} style={{ width: `${value * 100}%` }} />
        <div className="absolute top-0 h-full w-[2px] bg-white/70" style={{ left: `${egoValue * 100}%` }} />
      </div>
    </div>
  );
}

function UtilityPanel({ sim, selectedObjectId }) {
  const { info } = resolveSelected(selectedObjectId, sim);
  const ego = objectInfoFor("ego", sim);
  const rows = [
    ["Safety relevance", info.factors.safetyRelevance, ego.factors.safetyRelevance, "bg-rose-400"],
    ["Motion", info.factors.motion, ego.factors.motion, "bg-sky-400"],
    ["Uncertainty", info.factors.uncertainty, ego.factors.uncertainty, "bg-amber-400"],
    ["Geometric complexity", info.factors.geometricComplexity, ego.factors.geometricComplexity, "bg-slate-300"],
    ["Distance value", info.factors.distanceValue, ego.factors.distanceValue, "bg-emerald-400"],
    ["Future occupancy", info.factors.futureOccupancy, ego.factors.futureOccupancy, "bg-violet-400"],
  ];
  return (
    <div className="panel">
      <div className="section-title"><Target size={16} /> Information Utility Engine</div>
      <p className="mb-2 text-[10px] text-slate-500">Showing <b className="text-slate-300">{info.name}</b> — filled bar is the selected object, white tick is the ego vehicle's own baseline for that factor.</p>
      <div className="space-y-2">
        {rows.map(([name, value, egoValue, colorClass]) => <Bar colorClass={colorClass} egoValue={egoValue} key={name} label={name} value={value} />)}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-line bg-black/20 p-2 text-center">
          <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">{info.name}</div>
          <div className="mt-1 flex items-center justify-center gap-1.5 text-xs font-mono">
            <span className="text-slate-400">{info.ig.toFixed(2)}</span><span className="text-slate-600">÷</span>
            <span className="text-slate-400">{info.cost.toFixed(2)}</span><span className="text-slate-600">=</span>
            <span className="font-black text-cyanSignal">{info.utility.toFixed(2)}</span>
          </div>
        </div>
        <div className="rounded-lg border border-line bg-black/20 p-2 text-center">
          <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">Ego Vehicle (baseline)</div>
          <div className="mt-1 flex items-center justify-center gap-1.5 text-xs font-mono">
            <span className="text-slate-400">{ego.ig.toFixed(2)}</span><span className="text-slate-600">÷</span>
            <span className="text-slate-400">{ego.cost.toFixed(2)}</span><span className="text-slate-600">=</span>
            <span className="font-black text-slate-300">{ego.utility.toFixed(2)}</span>
          </div>
        </div>
      </div>
      <div className={`mt-3 rounded-lg border p-3 ${info.decision === "REFINE" ? "border-cyanSignal/60 bg-cyanSignal/10" : info.decision === "MAINTAIN" ? "border-emerald-400/30 bg-emerald-400/5" : "border-slate-700 bg-slate-900/40"}`}>
        <div className="flex items-center gap-2 text-sm font-black">
          <Crosshair size={17} className={info.decision === "REFINE" ? "text-cyanSignal" : info.decision === "MAINTAIN" ? "text-emerald-400" : "text-slate-400"} />
          {info.name}: {info.decision} <span className="text-slate-600">vs</span> Ego: {ego.decision}
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          {info.utility > ego.utility
            ? `${info.name} outranks the ego's own baseline utility (${info.utility.toFixed(2)} vs ${ego.utility.toFixed(2)}), which is why it earns ${info.decision.toLowerCase()} resolution.`
            : `${info.name} sits at or below the ego's own baseline utility (${info.utility.toFixed(2)} vs ${ego.utility.toFixed(2)}), so it's coarsened rather than spending extra compute on it.`}
        </p>
      </div>
    </div>
  );
}

function Metric({ label, value, accent = false }) {
  return (
    <div className="min-w-0 flex-1 rounded border border-line bg-slate-950/50 p-2 text-center">
      <div className="text-[8px] font-bold uppercase leading-tight tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-black ${accent ? "text-cyanSignal" : "text-white"}`}>{value}</div>
    </div>
  );
}

function CorridorPanel({ sim }) {
  const blocked = sim.phase >= 4;
  return (
    <div className="panel">
      <div className="section-title"><Route size={16} /> Safe Corridor & Motion Planning</div>
      <div className="grid grid-cols-[1.1fr_1fr] gap-3">
        <svg className="h-32 w-full rounded border border-line bg-slate-950" viewBox="0 0 100 70">
          <path d="M32 0 L68 0 L78 70 L22 70 Z" fill="#17212d" />
          <path d="M45 0 L47 70 M55 0 L53 70" stroke="#94a3b8" strokeOpacity="0.3" strokeDasharray="3 4" />
          {blocked && <path d="M50 68 C49 52 43 42 35 30 C31 24 29 16 29 5" fill="none" stroke="#22c55e" strokeWidth="7" strokeOpacity="0.17" />}
          {blocked && <path d="M50 68 C49 52 43 42 35 30 C31 24 29 16 29 5" fill="none" stroke="#22c55e" strokeWidth="1.3" strokeDasharray="2 1" />}
          <path d="M50 68 L50 20" fill="none" stroke={blocked ? "#ef4444" : "#22d3ee"} strokeWidth="1" strokeDasharray="2 1" />
          {sim.scene.obstacle && <AnimalTop color="#ef4444" cx={sim.obstacleX} cy={19} h={5} w={7} />}
          <path d="M50 65 l-3 5 h6 z" fill="#22d3ee" />
        </svg>
        <div className="space-y-2 text-[10px] font-bold uppercase tracking-wider">
          <div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${blocked ? "bg-rose-500" : "bg-emerald-400"}`} />Original path: <b className={blocked ? "text-rose-400" : "text-emerald-400"}>{blocked ? "BLOCKED" : "CLEAR"}</b></div>
          <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-400" />Alternative corridor: <b className="text-emerald-400">CLEAR</b></div>
          <div className="flex items-center gap-2"><CheckCircle2 size={12} className="text-emerald-400" /> Dynamic animal crossing predicted</div>
          <div className="flex items-center gap-2"><CheckCircle2 size={12} className="text-emerald-400" /> Path updated successfully</div>
        </div>
      </div>
    </div>
  );
}


export default function Prediction({
  controls, setControls, resetSimulation, time, onStep, frameNumber, isAdvancingFrame,
  isLive, dataSource, regions, selectedRegion, selectedRegionId, setSelectedRegionId, resolutionLevels,
}) {
  const sim = scenarioAt(time, controls.demoStep, controls.running);
  const activeStage = STAGE_FOR_PHASE[sim.phase];
  const budgetSaved = sim.phase < 6 ? 18 : sim.phase < 8 ? 31 : 38;
  const [selectedObjectId, setSelectedObjectId] = useState("vehicle");

  // Live Backend is selected AND has actually produced regions: drive the
  // core visualization (map, inspector, utility breakdown -> REFINE /
  // MAINTAIN / COARSEN) from the real backend's regions, using the exact
  // same generic components the Live System page uses (AdaptiveMap /
  // RegionInspector / UtilityEngine), instead of the scripted animal-
  // crossing walkthrough below. That walkthrough is a fixed teaching
  // narrative that doesn't correspond to whatever the real dataset/scene
  // actually contains, so it stays reserved for Simulated mode only.
  const showLiveDecisionView = isLive && regions?.length > 0;

  return (
    <section>
      {showLiveDecisionView ? (
        <div className="mb-4 rounded-lg border border-emerald-400/30 bg-emerald-400/5 px-4 py-3">
          <div className="text-sm font-black text-white">Live Backend — real decisions</div>
          <div className="mt-1 text-xs text-slate-400">
            REFINE / MAINTAIN / COARSEN below are computed live by the backend's actual
            information-value → gain → cost → utility pipeline for the currently loaded dataset
            (or synthetic scene, if no real dataset is configured) — not the scripted walkthrough.
          </div>
        </div>
      ) : (
        <>
          <Pipeline active={activeStage} />
          <div className="mb-4 flex items-center justify-between rounded-lg border border-cyanSignal/20 bg-cyanSignal/5 px-4 py-3">
            <div><div className="text-sm font-black text-white">{sim.scene.title}</div><div className="mt-1 text-xs text-slate-400">{sim.scene.detail}</div></div>
            <div className="hidden items-center gap-4 text-right sm:flex">
              <div><div className="metric-label">Frame</div><div className="font-mono text-sm font-bold text-cyanSignal">{String(sim.phase + 1).padStart(3, "0")} / 009</div></div>
              <div><div className="metric-label">Compute saved</div><div className="font-mono text-sm font-bold text-emerald-400">{budgetSaved}%</div></div>
            </div>
          </div>
        </>
      )}

      {showLiveDecisionView ? (
        <>
          <section className="grid items-stretch gap-4 xl:grid-cols-[1.05fr_1.15fr_390px]">
            <LiveSimulationView
              frameNumber={frameNumber}
              isAdvancingFrame={isAdvancingFrame}
              onAdvanceFrame={dataSource === "live" ? onStep : undefined}
              regions={regions}
              selectedRegionId={selectedRegionId}
              setSelectedRegionId={setSelectedRegionId}
            />
            <LiveAdaptiveSceneMap
              onAdvanceFrame={dataSource === "live" ? onStep : undefined}
              regions={regions}
              selectedRegionId={selectedRegionId}
              setSelectedRegionId={setSelectedRegionId}
            />
            <RegionInspector region={selectedRegion} />
          </section>
          <section className="mt-4 grid items-stretch gap-4 xl:grid-cols-[1.05fr_1.15fr_390px]">
            <div className="xl:col-span-2">
              <UtilityEngine region={selectedRegion} />
            </div>
            <ProjectedPathsPanel frameNumber={frameNumber} regions={regions} />
          </section>
        </>
      ) : (
        <section className="grid gap-4 xl:grid-cols-[1.05fr_1.15fr_390px]">
          <SimulationView controls={controls} frameNumber={frameNumber} isAdvancingFrame={isAdvancingFrame} onStep={onStep} resetSimulation={resetSimulation} setControls={setControls} sim={sim} selectedObjectId={selectedObjectId} setSelectedObjectId={setSelectedObjectId} />
          <AdaptiveSimulationMap sim={sim} selectedObjectId={selectedObjectId} setSelectedObjectId={setSelectedObjectId} />
          <aside className="space-y-4">
            <ObjectPanel sim={sim} selectedObjectId={selectedObjectId} />
            <UtilityPanel sim={sim} selectedObjectId={selectedObjectId} />
            <CorridorPanel sim={sim} />
          </aside>
        </section>
      )}

      {!showLiveDecisionView && (
        <div className="mt-4 grid gap-4 md:grid-cols-4">
          <SmallCard icon={Gauge} title="Vehicle speed" value={`${sim.speed.toFixed(1)} m/s`} note="forward motion" />
          <SmallCard icon={TrendingUp} title="Predicted occupancy" value={`${Math.round(sim.scene.predicted ? 79 : 12)}%`} note="future corridor" />
          <SmallCard icon={Cpu} title="ROI cells" value={sim.cells.toLocaleString()} note={sim.refine ? "5 cm fine" : "coarse / medium"} />
          <SmallCard icon={ShieldCheck} title="Confidence" value={`${Math.round(sim.confidence * 100)}%`} note="synthetic perception" />
        </div>
      )}

    </section>
  );
}

// Frame-by-frame projected path for every dynamic object on the CURRENTLY
// LOADED frame. region.futureTrack (built in liveAdapter.js) is the same
// CTRV reconstruction drawn on the map -- curved while an object has a real
// turn rate, straight-line otherwise -- this panel just lists it as numbers
// so "what's this object doing over the next 10 frames" is readable without
// eyeballing the SVG. Since it's derived straight from the `regions` prop
// (this frame's data only), it never mixes data across frames: switching
// frames replaces this panel's contents entirely, it doesn't append.
function ProjectedPathsPanel({ frameNumber, regions }) {
  const tracked = (regions ?? []).filter((r) => r.kind === "dynamic" && r.futureTrack?.length);

  return (
    <div className="panel">
      <div className="section-title">
        <Route size={16} />
        Projected Paths — Frame {String(frameNumber ?? 0).padStart(3, "0")}
      </div>
      {tracked.length === 0 ? (
        <p className="text-xs text-slate-500">No moving objects detected on this frame.</p>
      ) : (
        <div className="space-y-3">
          {tracked.map((region) => {
            const endpoint = region.futureTrack[region.futureTrack.length - 1];
            const dx = endpoint.positionMeters.x - region.position.x;
            const start = region.futureTrack[0];
            // Detect curvature directly from the plotted path (heading of
            // the first leg vs. the last leg) rather than needing a
            // separate yaw_rate field threaded through -- if CTRV kicked in
            // for this track, the two headings will meaningfully diverge.
            const headingAt = (a, b) => Math.atan2(b.positionMeters.y - a.positionMeters.y, b.positionMeters.x - a.positionMeters.x);
            // region.position is flat {x, y} (raw meters), unlike futureTrack
            // points which nest under .positionMeters -- wrap it to match
            // headingAt's expected shape instead of crashing on
            // "region.position.positionMeters" being undefined.
            const firstLegHeading = headingAt({ positionMeters: region.position }, start);
            const lastLegHeading = region.futureTrack.length > 1
              ? headingAt(region.futureTrack[region.futureTrack.length - 2], endpoint)
              : firstLegHeading;
            const headingDeltaDeg = Math.abs(((lastLegHeading - firstLegHeading + Math.PI) % (2 * Math.PI)) - Math.PI) * (180 / Math.PI);
            const isCurving = headingDeltaDeg > 3;
            return (
              <div className="rounded-md border border-line bg-slate-950/60 p-2.5" key={region.id}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-bold text-white">
                    {region.name}
                    {isCurving && (
                      <span className="rounded border border-cyanSignal/40 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-cyanSignal">
                        curving
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-[10px] text-slate-500">
                    frame {frameNumber} → {frameNumber + endpoint.frameOffset}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {region.futureTrack.map((point) => (
                    <span
                      className={`rounded border px-1.5 py-0.5 font-mono text-[9.5px] ${
                        point.extrapolatedBeyondBackend
                          ? "border-slate-700 text-slate-500"
                          : "border-cyanSignal/40 text-cyanSignal"
                      }`}
                      key={point.frameOffset}
                      title={`+${point.frameOffset} frames · ${(point.confidence * 100).toFixed(0)}% confidence`}
                    >
                      +{point.frameOffset}
                    </span>
                  ))}
                </div>
                <div className="mt-1.5 text-[10.5px] text-slate-500">
                  ~{Math.abs(dx).toFixed(1)} m {dx >= 0 ? "forward" : "back"} over {region.futureTrack.length} frames ·{" "}
                  {(endpoint.confidence * 100).toFixed(0)}% confidence at +{endpoint.frameOffset}
                  {start.extrapolatedBeyondBackend ? " (beyond backend's own prediction horizon)" : ""}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SmallCard({ icon: Icon, title, value, note }) {
  return <div className="panel"><div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500"><Icon size={14} /> {title}</div><div className="mt-2 text-xl font-black text-white">{value}</div><div className="mt-1 text-[10px] text-slate-500">{note}</div></div>;
}