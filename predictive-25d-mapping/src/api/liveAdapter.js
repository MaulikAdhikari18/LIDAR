// Reshapes a real backend /api/frame response into exactly the region shape
// that utils/utilityCalculation.js's calculateFrame() already produces, so
// every existing component (AdaptiveMap, BudgetPanel, RegionInspector,
// UtilityEngine, LiveLidarScene) works unmodified whether the data came from
// the client-side simulation or the real backend.
//
// Deliberately reuses the backend's OWN computed numbers (ig, cost, utility
// from result.candidates) instead of recomputing fake approximations
// client-side -- this is the whole point of wiring it up for real.

const SAFETY_RELEVANCE = {
  pedestrian: 1.0, vehicle: 0.9, curb: 0.75,
  obstacle: 0.85, road: 0.25, building: 0.35,
  terrain: 0.2, unknown: 0.45,
};

// Backend works in real meters relative to the sensor; the existing UI was
// built around a normalized 0-100 canvas space. Map one onto the other.
function metersToCanvas(x, y, mapDimensions) {
  const [w, h] = mapDimensions;
  const px = 50 + (x / (w / 2)) * 43;
  const py = 50 + (y / (h / 2)) * 43;
  return {
    x: Math.max(7, Math.min(93, px)),
    y: Math.max(7, Math.min(93, py)),
  };
}

function inferKind(region) {
  if (region.semantic_class === "vehicle" || region.semantic_class === "pedestrian") return "dynamic";
  if (region.semantic_class === "road" && region.occupancy < 0.15) return "low";
  if (region.confidence < 0.55) return "uncertain";
  return "static";
}

function prettyName(region, index, track) {
  if (track) return `${track.class.charAt(0).toUpperCase() + track.class.slice(1)} #${track.track_id}`;
  const label = region.semantic_class.charAt(0).toUpperCase() + region.semantic_class.slice(1);
  return `${label} #${region.region_id ?? index}`;
}

/**
 * @param {object} frameResult - raw response from POST /api/frame or GET /api/state
 * @param {object} config - live config from GET /api/config-equivalent (or Config defaults); needs map_dimensions
 * @param {number} maxRegions - how many regions to surface in the UI (keeps cards/lists readable)
 */
export function adaptBackendFrame(frameResult, config, maxRegions = 8) {
  if (!frameResult || !frameResult.regions) return { regions: [], metrics: null };

  const mapDimensions = config?.map_dimensions ?? [40, 30];
  const budget = config?.computational_budget ?? frameResult.metrics?.budget ?? 5000;

  // Best utility candidate per region_id (candidates already sorted desc by utility).
  const bestCandidateByRegion = new Map();
  for (const c of frameResult.candidates || []) {
    if (!bestCandidateByRegion.has(c.region_id)) bestCandidateByRegion.set(c.region_id, c);
  }

  const allRegions = frameResult.regions;
  const nearestRegion = (x, y) => {
    let best = null, bestDist = Infinity;
    for (const r of allRegions) {
      const d = Math.hypot(r.x - x, r.y - y);
      if (d < bestDist) { bestDist = d; best = r; }
    }
    return best;
  };

  // Build dynamic entries FROM the tracker's own list, not from grid cells.
  // A refined grid cell's position is the geometric center of that tile
  // (recomputed from its parent on every refine/coarsen), NOT the object's
  // real continuous position -- so matching "cell tagged vehicle" -> "nearby
  // track" frequently fails once a cell has been subdivided a few times.
  // Going the other way (track -> nearest cell, just for supplementary
  // fields like cost/occupancy) keeps the object's real position accurate
  // AND keeps its id permanently stable across frames via track_id.
  const dynamicFromTracks = (frameResult.objects || []).map((track) => {
    const region = nearestRegion(track.x, track.y);
    return { track, region: region ?? null };
  });

  const usedRegionIds = new Set(dynamicFromTracks.map((d) => d.region?.region_id).filter(Boolean));
  const rest = allRegions
    .filter(r => r.semantic_class !== "vehicle" && r.semantic_class !== "pedestrian" && !usedRegionIds.has(r.region_id))
    .sort((a, b) => (bestCandidateByRegion.get(b.region_id)?.utility ?? 0) - (bestCandidateByRegion.get(a.region_id)?.utility ?? 0));

  const dynamicSlots = Math.min(dynamicFromTracks.length, maxRegions);
  const selectedDynamic = dynamicFromTracks.slice(0, dynamicSlots);
  const selectedStatic = rest.slice(0, maxRegions - dynamicSlots);

  const buildEntry = ({ track, region }, index) => {
    // A dynamic entry always has a track; region is the nearest grid cell
    // used only to borrow supplementary fields (cost, occupancy, resolution).
    // A static entry has no track, just a region straight from the grid.
    const semanticClass = track ? track.class : region.semantic_class;
    const x = track ? track.x : region.x;
    const y = track ? track.y : region.y;
    const vx = track?.vx ?? 0;
    const vy = track?.vy ?? 0;
    const candidate = region ? bestCandidateByRegion.get(region.region_id) : null;
    const position = metersToCanvas(x, y, mapDimensions);
    const kind = track ? "dynamic" : inferKind(region);

    const utility = candidate?.utility ?? 0;
    const ig = candidate?.ig ?? 0;
    const cost = candidate?.cost ?? Math.max(region?.active_cost ?? 0.05, 0.001);
    const decision = utility >= 0.55 ? "REFINE" : utility <= 0.25 ? "COARSEN" : "MAINTAIN";

    let futurePosition = position;
    const future = (frameResult.future || []).find(f => f.track_id === track?.track_id);
    if (future) futurePosition = metersToCanvas(future.x, future.y, mapDimensions);

    return {
      // A grid cell's own region_id changes when the quadtree refines or
      // coarsens it (a child cell gets a brand-new id). track_id is
      // genuinely stable across frames for the same real object, so using
      // it here keeps React's reconciliation stable -- the UI can smoothly
      // move an existing element instead of destroying/recreating a "new"
      // one at a different position every poll.
      id: track ? `track-${track.track_id}` : (region.region_id ?? `region-${index}`),
      name: prettyName(region, index, track),
      semanticClass: kind === "dynamic" ? `Dynamic ${semanticClass}` : semanticClass,
      kind,
      position: { x, y }, // raw meters, kept for reference
      velocity: { x: vx, y: vy },
      directionDeg: track ? (track.direction * 180) / Math.PI : 0,
      elevation: region?.elevation ?? 0,
      occupancy: region?.occupancy ?? 0.5,
      confidence: region?.confidence ?? track?.confidence ?? 0.7,
      safetyRelevance: SAFETY_RELEVANCE[semanticClass] ?? region?.semantic_importance ?? 0.45,
      motion: track ? Math.min(1, Math.hypot(vx, vy) / 3) : (region.motion ?? 0),
      uncertainty: region?.uncertainty ?? track?.uncertainty ?? 0.3,
      geometricComplexity: region?.geometry ?? 0.5,
      distance: Math.hypot(x, y),
      distanceValue: region?.distance_relevance ?? 1 / (1 + Math.hypot(x, y) / 10),
      baseCost: region?.active_cost ?? cost,

      // Fields the existing components read directly (previously produced
      // by calculateRegionUtility on the client -- now the backend's own
      // authoritative numbers, not a re-derived approximation).
      expectedInformationGain: ig,
      computationalCost: cost,
      utility,
      decision,
      resolution: region?.resolution ?? 0.5,
      futureProbability: region?.future_probability ?? 0,
      currentPosition: position,
      futurePosition,
      speedMps: Math.hypot(vx, vy),
      // Proportional share of the REAL total spend this frame (metrics.used_budget),
      // scaled to the fixed budget - not (cost/budget)*budget, which algebraically
      // cancels the budget term out and just reduces to cost*100 regardless of
      // how big the budget actually is.
      cellsAllocated: Math.round(
        (cost / Math.max(frameResult.metrics?.used_budget ?? cost, 1e-6)) * budget
      ),
    };
  };

  const regions = [
    ...selectedDynamic.map((entry, index) => buildEntry(entry, index)),
    ...selectedStatic.map((region, index) => buildEntry({ track: null, region }, index)),
  ];

  return { regions, metrics: frameResult.metrics };
}