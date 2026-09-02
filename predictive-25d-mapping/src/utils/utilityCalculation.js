import { BASE_REGIONS, RESOLUTION_LEVELS, TOTAL_BUDGET } from "../data/simulationData.js";

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function wave(time, seed, amplitude = 1, frequency = 1) {
  return Math.sin(time * frequency + seed) * amplitude;
}

export function getRegionPosition(region, time, futureSeconds = 0, demoBoost = 0) {
  const motionScale = 16 + demoBoost * 6;
  const x =
    region.position.x +
    wave(time, region.position.x, region.kind === "dynamic" ? 4.6 : 0.8, 0.55) +
    region.velocity.x * (time + futureSeconds) * motionScale;
  const y =
    region.position.y +
    wave(time, region.position.y, region.kind === "dynamic" ? 3.7 : 0.7, 0.5) +
    region.velocity.y * (time + futureSeconds) * motionScale;

  return {
    x: clamp(x, 7, 93),
    y: clamp(y, 9, 91),
  };
}

export function getFutureOccupancyProbability(region, time, horizonSeconds, predictionEnabled) {
  if (!predictionEnabled || region.kind !== "dynamic") return 0;
  const nearTermConfidence = 0.74 - horizonSeconds * 0.16;
  const uncertaintySpread = Math.abs(wave(time, region.position.y + horizonSeconds, 0.05, 0.8));
  return clamp(nearTermConfidence + uncertaintySpread, 0.05, 0.82);
}

export function calculateRegionUtility(region, time, options = {}) {
  const predictionEnabled = options.predictionEnabled ?? true;
  const demoIntensity = options.demoIntensity ?? 0;
  const futureProbability = getFutureOccupancyProbability(region, time, 1.5, predictionEnabled);
  const distanceValue = clamp(1 - region.distance / 70, 0.08, 1);
  const dynamicBoost = region.kind === "dynamic" ? 0.08 + Math.abs(wave(time, region.position.x, 0.05, 0.8)) : 0;
  const pedestrianDemoBoost = region.id === "pedestrian" ? demoIntensity * 0.16 : 0;

  const expectedInformationGain = clamp(
    region.safetyRelevance * 0.27 +
      region.motion * 0.18 +
      region.uncertainty * 0.2 +
      region.geometricComplexity * 0.15 +
      distanceValue * 0.08 +
      futureProbability * 0.12 +
      dynamicBoost +
      pedestrianDemoBoost,
    0.04,
    0.98,
  );

  const computationalCost = clamp(
    region.baseCost + expectedInformationGain * 0.11 + (region.kind === "dynamic" ? 0.08 : 0),
    0.1,
    0.82,
  );

  const utility = expectedInformationGain / computationalCost;
  const decision = utility > 1.8 ? "REFINE" : utility > 1.08 ? "MAINTAIN" : "COARSEN";
  const resolution = RESOLUTION_LEVELS[decision];

  return {
    ...region,
    distanceValue,
    expectedInformationGain,
    computationalCost,
    utility,
    decision,
    resolution,
    futureProbability,
    currentPosition: getRegionPosition(region, time, 0, demoIntensity),
    futurePosition: getRegionPosition(region, time, 2.5, demoIntensity),
    speedMps: Math.hypot(region.velocity.x, region.velocity.y) * 52,
  };
}

export function calculateFrame(time, options = {}) {
  const enriched = BASE_REGIONS.map((region) => calculateRegionUtility(region, time, options));
  const weighted = enriched.map((region) => ({
    ...region,
    budgetWeight: Math.pow(region.utility, 1.7) * (region.kind === "low" ? 0.35 : 1),
  }));
  const minimumCells = 4600;
  const distributableBudget = TOTAL_BUDGET - minimumCells * weighted.length;
  const totalWeight = weighted.reduce((sum, region) => sum + region.budgetWeight, 0);

  const allocated = weighted.map((region) => ({
    ...region,
    cellsAllocated: Math.round(minimumCells + (distributableBudget * region.budgetWeight) / totalWeight),
  }));

  const correction = TOTAL_BUDGET - allocated.reduce((sum, region) => sum + region.cellsAllocated, 0);
  allocated[allocated.length - 1].cellsAllocated += correction;

  return allocated;
}

export function buildBudgetHistory(time, options = {}) {
  return Array.from({ length: 16 }, (_, index) => {
    const t = time - (15 - index) * 0.6;
    const frame = calculateFrame(t, options);
    return {
      label: `${index - 15}s`,
      Pedestrian: frame.find((r) => r.id === "pedestrian").cellsAllocated,
      Vehicle: frame.find((r) => r.id === "vehicle").cellsAllocated,
      Terrain: frame.find((r) => r.id === "terrain").cellsAllocated,
      RoadEdge: frame.find((r) => r.id === "edge").cellsAllocated,
    };
  });
}
