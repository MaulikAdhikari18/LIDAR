"""
Central configuration — single source of truth for every numeric constant
that appears in the FoveaMap Quick Revision Notes and the locked solution
documents. Every module imports constants from here instead of hardcoding
them, so the whole system stays consistent with the documentation.

Reference: FoveaMap — Quick Revision Notes, sections 4-15.
"""

# ---------------------------------------------------------------------------
# 12. Map — hierarchical resolution levels (coarse -> fine), in metres.
# These are REPRESENTATION CHOICES, not distance bands (Master Doc, Sec. 3).
# ---------------------------------------------------------------------------
RESOLUTION_LEVELS = [0.50, 0.20, 0.05]

# ---------------------------------------------------------------------------
# 6. Future trajectory
# ---------------------------------------------------------------------------
PREDICTION_HORIZON_SECONDS = 2.0     # how far ahead we predict (Pfuture = Pcurrent + V*dt)
FUTURE_GAUSSIAN_SIGMA_M = 0.6        # spatial spread of the probabilistic future occupancy field

# ---------------------------------------------------------------------------
# 5. Velocity smoothing:  Vnew = 0.7 * Vprevious + 0.3 * Vmeasured
# ---------------------------------------------------------------------------
VELOCITY_SMOOTH_PREV_WEIGHT = 0.7
VELOCITY_SMOOTH_NEW_WEIGHT = 0.3

# ---------------------------------------------------------------------------
# 6b. Turn-rate estimation for CTRV (Constant Turn Rate and Velocity) future
# prediction. Smoothed the same way as velocity above, so one noisy heading
# jump doesn't whip the projected path around -- a genuinely turning object
# still converges onto its real turn rate within a few frames.
# ---------------------------------------------------------------------------
YAW_RATE_SMOOTH_PREV_WEIGHT = 0.7
YAW_RATE_SMOOTH_NEW_WEIGHT = 0.3
# Below this speed, heading (atan2 of a near-zero velocity vector) is mostly
# sensor noise, not a real direction -- don't let it masquerade as a turn.
MIN_SPEED_FOR_YAW_RATE_MS = 0.15
# Below this turn rate (rad/s), treat the track as going straight. CTRV's own
# closed-form divides by yaw_rate, so this also doubles as the fallback
# threshold that avoids that division blowing up near zero.
MIN_YAW_RATE_RAD_S = 1e-3

# ---------------------------------------------------------------------------
# 7. Current Information Value
# IVcurrent = 0.30*S + 0.20*M + 0.15*U + 0.15*G + 0.05*D   (sums to 0.85)
# Future probability carries a SEPARATE weight wP = 0.15  (0.85 + 0.15 = 1.00)
# ---------------------------------------------------------------------------
IV_WEIGHT_SAFETY = 0.30        # S — semantic/safety importance
IV_WEIGHT_MOTION = 0.20        # M — motion
IV_WEIGHT_UNCERTAINTY = 0.15   # U — uncertainty
IV_WEIGHT_GEOMETRY = 0.15      # G — geometric/scene complexity
IV_WEIGHT_DISTANCE = 0.05      # D — distance relevance (deliberately small)
IV_WEIGHT_FUTURE = 0.15        # wP — future occupancy probability

# ---------------------------------------------------------------------------
# 8. Information Gain
# Base = aU*U + aS*S + aG*G + aM*M + aF*Pfuture
# Default base weights (documented order U/S/G/M/F): 0.20 / 0.30 / 0.15 / 0.15 / 0.20
# ConfidenceOfBenefit = 0.5 + 0.5*(1 - confidence)
# InformationGain = Base * ResolutionGain * ConfidenceOfBenefit * 10
# ---------------------------------------------------------------------------
IG_WEIGHT_UNCERTAINTY = 0.20   # aU
IG_WEIGHT_SAFETY = 0.30        # aS
IG_WEIGHT_GEOMETRY = 0.15      # aG
IG_WEIGHT_MOTION = 0.15        # aM
IG_WEIGHT_FUTURE = 0.20        # aF
IG_SCALE_FACTOR = 10.0

# ---------------------------------------------------------------------------
# 9. Refinement Cost
# Cost = (k_compute + k_memory) * num_new_cells + k_points * num_points  ... * hardware_multiplier
# Defaults: k_compute=0.20, k_memory=0.10, k_points=0.02, hardware_multiplier=1.0
# NOTE: the revision notes explicitly say the documentation does not fully
# specify the cost equation and that utility/refinement_cost.py is
# authoritative — this module IS that authoritative implementation.
# ---------------------------------------------------------------------------
COST_K_COMPUTE = 0.20
COST_K_MEMORY = 0.10
COST_K_POINTS = 0.02
COST_HARDWARE_MULTIPLIER = 1.0
COST_MIN = 0.05   # avoid division-by-zero / degenerate utility for empty regions

# Maintenance-cost multiplier for RETENTION decisions only (whether an
# already-refined cell still deserves to keep its resolution). This is NOT
# a documented revision-notes constant -- refinement_cost.py's k_compute/
# k_memory/k_points/hardware_multiplier ARE the documented cost model and
# are used exactly as specified for REFINE decisions. This multiplier only
# scales the ongoing "upkeep" cost used by retention_utility, giving a
# clean separation between genuinely important, consistently-refined
# regions (which comfortably clear it) and marginal/boring regions sitting
# near the coarsen threshold (which then correctly fall below it and get
# reclaimed) -- see AdaptiveMapManager's documented resolution of the
# "ResolutionGain ambiguity" the revision notes defer to the implementation.
MAINTENANCE_COST_MULTIPLIER = 2.5

# ---------------------------------------------------------------------------
# 11. REFINE / MAINTAIN / COARSEN thresholds + total computational budget
# ---------------------------------------------------------------------------
COARSEN_THRESHOLD = 0.25
REFINE_THRESHOLD = 0.55
TOTAL_COMPUTATIONAL_BUDGET = 5000

# ---------------------------------------------------------------------------
# Confidence-aware adaptation (Prototype Enhancement A1)
# ---------------------------------------------------------------------------
CONFIDENCE_GAIN_PER_OBSERVATION = 0.08     # repeated consistent observation -> more certain
CONFIDENCE_LOSS_ON_PREDICTION_ERROR = 0.35 # a wrong prediction knocks confidence down sharply
CONFIDENCE_MIN = 0.05
CONFIDENCE_MAX = 0.98

# Minimum number of frames a cell must wait after any REFINE/COARSEN
# transition before it's eligible to transition again. Without this,
# a cell whose utility sits right at the REFINE/COARSEN boundary can
# flip-flop every single frame (refine because utility ticks just above
# threshold, coarsen the very next frame because confidence shifted it
# just below, refine again...) -- this was discovered as a REAL bug via
# the live frontend: one region's own budget ledger showed 5 transitions
# in 5 consecutive frames. This is an implementation choice (not a
# documented revision-notes constant) that adds simple hysteresis.
TRANSITION_COOLDOWN_FRAMES = 15

# ---------------------------------------------------------------------------
# Prediction-error recovery (Prototype Enhancement A2)
# ---------------------------------------------------------------------------
PREDICTION_ERROR_DISTANCE_M = 0.20   # actual vs predicted position gap that counts as a "miss"
                                       # (calibrated for FRAME_DT_SECONDS=0.1s one-step-ahead checks
                                       # against the synthetic scene's cluster-centroid noise floor
                                       # (~0.05-0.08m); steady constant-velocity motion stays well
                                       # under this, while a genuine sudden direction change clears
                                       # it comfortably, ~0.3m+)

# ---------------------------------------------------------------------------
# Perception — semantic class buckets (SemanticPOSS/KITTI-style label ids).
# Section 3: PointNet++ checkpoint currently produces Terrain / Static / Dynamic.
# ---------------------------------------------------------------------------
SEMANTIC_CLASS_MAP = {
    0: "unknown",
    4: "person", 5: "person", 6: "rider",
    7: "car", 8: "trunk", 9: "plants",
    10: "traffic_sign", 11: "traffic_sign", 12: "traffic_sign",
    13: "pole", 14: "trashcan",
    15: "building", 16: "cone/stone",
    17: "fence", 21: "bike",
    22: "ground",
    40: "curb",   # synthetic-scene-only: the "uncertain road edge" object
}
# Verified against the real dataset's own read_data.py (LABEL_DICT): id 8 is
# "trunk" (a tree trunk -- static), not "truck", and ids 10/11/12 are three
# variants of "traffic sign" (standing / hanging / big-hanging) -- the
# original map had 8 as "truck" (which doesn't exist in this dataset's
# label scheme at all) and only mapped id 12, leaving 10 to fall through to
# "unknown" and 11 mislabeled as "trunk". A static tree trunk landing in
# "truck" would have been tracked as a moving vehicle; a real traffic sign
# (10) would have landed in the near-zero-safety-weight "unknown" terrain
# bucket instead of "static_obstacle". "truck" is kept below only because
# FRONTEND_CLASS_TRANSLATION still references it for forward-compatibility
# with a dataset that does have one -- id 8 no longer produces it.
DYNAMIC_CLASSES = {"person", "rider", "car", "truck", "bike"}
STATIC_CLASSES = {"building", "fence", "pole", "trunk", "traffic_sign", "trashcan", "cone/stone", "plants", "curb"}
TERRAIN_CLASSES = {"ground", "unknown"}

# Safety/semantic importance S per bucket, used by information_value.py
SAFETY_WEIGHT_BY_BUCKET = {
    "dynamic_person": 1.00,   # pedestrians/riders — highest safety relevance
    "dynamic_vehicle": 0.80,  # cars/trucks/bikes
    "static_obstacle": 0.45,  # poles, signs, road-edge/obstacle-like static objects
    "static_structure": 0.15, # buildings, fences — generally low future value
    "terrain": 0.05,          # empty road/ground
}

# Translates this backend's internal semantic_class strings into the
# vocabulary the frontend (built against a different backend's semantic
# scheme) expects. Anything not listed here falls back to "unknown".
FRONTEND_CLASS_TRANSLATION = {
    "car": "vehicle", "truck": "vehicle", "bike": "vehicle",
    "person": "pedestrian", "rider": "pedestrian",
    "ground": "road", "unknown": "unknown",
    "building": "building", "fence": "building",
    "curb": "curb",
    "pole": "obstacle", "traffic_sign": "obstacle", "trashcan": "obstacle",
    "cone/stone": "obstacle", "trunk": "obstacle", "plants": "obstacle",
}

# ---------------------------------------------------------------------------
# Synthetic scene (used automatically when the real LiDAR dataset is not
# available on disk — keeps every demo endpoint runnable anywhere).
# ---------------------------------------------------------------------------
SCENE_X_RANGE = (-25.0, 25.0)
SCENE_Y_RANGE = (0.0, 50.0)
FRAME_DT_SECONDS = 0.1   # simulated time between frames