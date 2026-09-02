"""
Generate additional LiDAR frames (100-999) by EXTENDING the real motion
already present in your 100 real frames, instead of randomly transforming
the whole scene each frame (which destroys motion signal - see notes below).

Why the old approach didn't work:
  The previous script applied an independent random rotation + translation
  to the ENTIRE point cloud (background AND cars together) on every frame,
  freshly sampled each time with no relation to the previous frame. Over
  many frames that averages to zero net drift, so any object's tracked
  centroid just jitters around the same spot instead of progressing in a
  consistent direction -> velocity estimates come out ~0.

What this version does instead:
  1. STATIC background (road, buildings, poles, terrain, ...) is left
     completely real - never transformed. We simply loop the real 100-frame
     recording's background (frame 100's background = frame 0's background,
     etc.), since your real ego-vehicle recording already has whatever
     camera motion actually happened.
  2. DYNAMIC objects (car/person/bicyclist/...) are extrapolated with a
     constant-velocity model estimated from their OWN last two real
     frames (98->99), then that same real point cluster (its actual
     scanned shape, not resampled/interpolated) is rigidly translated
     along that trajectory for as many synthetic frames as you need.
     This keeps the object's shape real while giving it a consistent,
     physically coherent trajectory that tracking/prediction can actually
     pick up on - because it's the same kind of constant-velocity motion
     a real tracker is designed to detect in the first place.
  3. Instance IDs are preserved, so a tracker sees the same object
     continuously across the 0-99 -> 100-999 boundary and beyond.

Usage:
    python generate_frames.py

Requires: numpy
"""

import numpy as np
import os
import sys
import time

# ── Configuration ──────────────────────────────────────────────────────────
BASE_DIR     = r"D:\SIH\Try Anti\FoveaMap_Data\dataset\sequences\00"
VEL_DIR      = os.path.join(BASE_DIR, "velodyne")
LAB_DIR      = os.path.join(BASE_DIR, "labels")
EXISTING     = 100          # frames 000000 - 000099 (real data, untouched)
TARGET_TOTAL = 1000         # frames 000000 - 000999
TO_GENERATE  = TARGET_TOTAL - EXISTING

DT = 0.1                    # seconds/frame - matches KITTI's ~10Hz LiDAR rate
JITTER_STD = 0.01           # meters - tiny sensor-noise-only jitter on dynamic clusters
SEED = 42

# Must match (or be tighter than) the backend's config.map_dimensions, or
# spawned objects will drift outside the visible window sooner than expected.
MAP_HALF_W = 20.0
MAP_HALF_H = 15.0

# Spawn a fresh synthetic object every this-many generated frames, so the
# extended range always has something to track once the real extrapolated
# objects have driven out of view.
SPAWN_INTERVAL = 20
SPAWN_INSTANCE_ID_START = 60000  # stays well clear of real instance ids (all < 1000 here)
CAR_SPEED_RANGE = (3.0, 12.0)         # m/s
PEDESTRIAN_SPEED_RANGE = (0.6, 1.8)   # m/s
SPAWN_CLASS_WEIGHTS = {10: 0.7, 30: 0.3}  # mostly cars, some pedestrians

# SemanticKITTI "thing" classes we treat as independently-moving objects.
# (Static/stuff classes - road, building, vegetation, pole, etc. - are never
# touched; they come straight from the real recording.)
DYNAMIC_SEMANTIC_IDS = {10, 11, 13, 15, 16, 18, 20, 30, 31, 32,
                         252, 253, 254, 255, 256, 257, 258, 259}


def load_frame(frame_idx):
    vel_path = os.path.join(VEL_DIR, f"{frame_idx:06d}.bin")
    lab_path = os.path.join(LAB_DIR, f"{frame_idx:06d}.label")
    points = np.fromfile(vel_path, dtype=np.float32).reshape(-1, 4)
    labels = np.fromfile(lab_path, dtype=np.uint32)
    return points, labels


def save_frame(frame_idx, points, labels):
    vel_path = os.path.join(VEL_DIR, f"{frame_idx:06d}.bin")
    lab_path = os.path.join(LAB_DIR, f"{frame_idx:06d}.label")
    points.astype(np.float32).tofile(vel_path)
    labels.astype(np.uint32).tofile(lab_path)


def split_static_dynamic(points, labels):
    sem = labels & 0xFFFF
    inst = labels >> 16
    is_dyn = np.isin(sem, list(DYNAMIC_SEMANTIC_IDS)) & (inst > 0)
    return points[~is_dyn], labels[~is_dyn], points[is_dyn], labels[is_dyn], sem[is_dyn], inst[is_dyn]


def estimate_instance_velocities(frame_a_idx, frame_b_idx):
    """Constant-velocity estimate (m/s) per (sem, inst) track, from two real frames."""
    pts_a, lab_a = load_frame(frame_a_idx)
    pts_b, lab_b = load_frame(frame_b_idx)
    _, _, dyn_a, _, sem_a, inst_a = split_static_dynamic(pts_a, lab_a)
    _, _, dyn_b, _, sem_b, inst_b = split_static_dynamic(pts_b, lab_b)

    tracks = {}
    keys_a = set(zip(sem_a.tolist(), inst_a.tolist()))
    keys_b = set(zip(sem_b.tolist(), inst_b.tolist()))
    for sem, inst in keys_a & keys_b:
        mask_a = (sem_a == sem) & (inst_a == inst)
        mask_b = (sem_b == sem) & (inst_b == inst)
        centroid_a = dyn_a[mask_a, :3].mean(axis=0)
        centroid_b = dyn_b[mask_b, :3].mean(axis=0)
        velocity = (centroid_b - centroid_a) / ((frame_b_idx - frame_a_idx) * DT)
        # Keep the real frame_b_idx shape/points as the "template" to translate onward.
        template_points = dyn_b[mask_b].copy()
        template_labels_sem = sem
        template_labels_inst = inst
        tracks[(sem, inst)] = {
            "velocity": velocity,
            "centroid": centroid_b,
            "template_points": template_points,
            "sem": sem,
            "inst": inst,
        }
    return tracks


def collect_template_shapes(rng, per_class=6):
    """Scan the real 100 frames once and collect a handful of real point-cluster
    shapes per class (centered on their own centroid) to reuse as the 'body'
    of freshly spawned synthetic objects. Reusing real shapes keeps spawned
    objects looking like actual scanned cars/pedestrians instead of blobs."""
    templates = {10: [], 30: []}
    for i in range(EXISTING):
        pts, lab = load_frame(i)
        sem = lab & 0xFFFF
        inst = lab >> 16
        for cls in templates:
            if len(templates[cls]) >= per_class:
                continue
            mask = (sem == cls) & (inst > 0)
            if not mask.any():
                continue
            for iid in np.unique(inst[mask]):
                cluster = pts[mask & (inst == iid)]
                if len(cluster) >= 25:  # skip tiny/fragmentary detections
                    centroid = cluster[:, :3].mean(axis=0)
                    centered = cluster.copy()
                    centered[:, :3] -= centroid
                    templates[cls].append(centered)
                    break
        if all(len(v) >= per_class for v in templates.values()):
            break
    return templates


def spawn_synthetic_track(rng, templates, next_instance_id):
    """Creates a new object entering from a random edge of the map, heading
    roughly inward, using a real point-cluster shape as its body."""
    cls = rng.choice(list(SPAWN_CLASS_WEIGHTS.keys()), p=list(SPAWN_CLASS_WEIGHTS.values()))
    if not templates.get(cls):
        cls = 10 if templates.get(10) else 30
    shape = templates[cls][rng.integers(0, len(templates[cls]))].copy()

    edge = rng.integers(0, 4)  # 0=left,1=right,2=bottom,3=top
    margin = 1.0
    if edge == 0:
        x, y = -MAP_HALF_W + margin, rng.uniform(-MAP_HALF_H, MAP_HALF_H)
        heading = np.array([1.0, rng.uniform(-0.3, 0.3)])
    elif edge == 1:
        x, y = MAP_HALF_W - margin, rng.uniform(-MAP_HALF_H, MAP_HALF_H)
        heading = np.array([-1.0, rng.uniform(-0.3, 0.3)])
    elif edge == 2:
        x, y = rng.uniform(-MAP_HALF_W, MAP_HALF_W), -MAP_HALF_H + margin
        heading = np.array([rng.uniform(-0.3, 0.3), 1.0])
    else:
        x, y = rng.uniform(-MAP_HALF_W, MAP_HALF_W), MAP_HALF_H - margin
        heading = np.array([rng.uniform(-0.3, 0.3), -1.0])

    heading = heading / np.linalg.norm(heading)
    speed_range = CAR_SPEED_RANGE if cls == 10 else PEDESTRIAN_SPEED_RANGE
    speed = rng.uniform(*speed_range)
    velocity = np.array([heading[0] * speed, heading[1] * speed, 0.0])
    z_offset = shape[:, 2].min() * -1 + rng.uniform(-1.9, -1.7)  # roughly ground-level, matches real data's z~-1.8

    return {
        "sem": cls,
        "inst": next_instance_id,
        "centroid": np.array([x, y, z_offset]),
        "velocity": velocity,
        "template_points": shape,  # centered at origin; translate by centroid each frame
    }


def in_bounds(centroid, slack=3.0):
    return abs(centroid[0]) <= MAP_HALF_W + slack and abs(centroid[1]) <= MAP_HALF_H + slack


def render_track(track, current_centroid, rng):
    pts = track["template_points"].copy()
    pts[:, :3] += current_centroid
    pts[:, :3] += rng.normal(0, JITTER_STD, pts[:, :3].shape)
    labels = np.full(len(pts), (track["inst"] << 16) | track["sem"], dtype=np.uint32)
    return pts, labels


def main():
    rng = np.random.default_rng(SEED)

    print("Verifying existing 100 frames...")
    for i in range(EXISTING):
        vel = os.path.join(VEL_DIR, f"{i:06d}.bin")
        lab = os.path.join(LAB_DIR, f"{i:06d}.label")
        if not os.path.exists(vel) or not os.path.exists(lab):
            print(f"ERROR: Missing frame {i:06d} - aborting.")
            sys.exit(1)
    print(f"All {EXISTING} source frames verified.\n")

    print("Estimating dynamic-object velocities from the last two real frames "
          f"({EXISTING - 2} -> {EXISTING - 1})...")
    real_tracks = estimate_instance_velocities(EXISTING - 2, EXISTING - 1)
    print(f"Tracking {len(real_tracks)} dynamic instances forward with a constant-velocity model.")

    print("Collecting real point-cluster shapes to reuse for newly spawned objects...")
    templates = collect_template_shapes(rng)
    print(f"  car templates: {len(templates.get(10, []))}, pedestrian templates: {len(templates.get(30, []))}")
    print(f"New synthetic objects will spawn every {SPAWN_INTERVAL} frames so the scene "
          f"never runs empty.\n")

    print(f"Generating {TO_GENERATE} new frames ({EXISTING}-{TARGET_TOTAL - 1})...")
    print("=" * 60)
    start_time = time.time()

    next_spawn_id = SPAWN_INSTANCE_ID_START
    spawned_tracks = []  # list of dicts from spawn_synthetic_track, still in view

    for new_idx in range(EXISTING, TARGET_TOTAL):
        step = new_idx - (EXISTING - 1)  # 1, 2, 3, ... frames past the last real one

        # 1. Real, looping static background - never transformed.
        bg_source_idx = new_idx % EXISTING
        bg_pts_full, bg_lab_full = load_frame(bg_source_idx)
        static_pts, static_lab, _, _, _, _ = split_static_dynamic(bg_pts_full, bg_lab_full)

        dyn_pts_list = [static_pts]
        dyn_lab_list = [static_lab]

        # 2. Extrapolate each ORIGINAL dynamic instance along its real trajectory,
        #    dropping it once it has drifted well outside the visible window.
        for (sem, inst), track in real_tracks.items():
            centroid = track["centroid"] + track["velocity"] * (step * DT)
            if not in_bounds(centroid):
                continue
            offset = track["velocity"] * (step * DT)
            pts, labels = render_track({"template_points": track["template_points"],
                                         "inst": inst, "sem": sem}, offset, rng)
            dyn_pts_list.append(pts)
            dyn_lab_list.append(labels)

        # 3. Spawn a fresh synthetic object periodically...
        if (new_idx - EXISTING) % SPAWN_INTERVAL == 0:
            new_track = spawn_synthetic_track(rng, templates, next_spawn_id)
            new_track["spawn_idx"] = new_idx
            spawned_tracks.append(new_track)
            next_spawn_id += 1

        # 4. Advance every still-visible spawned object (tracked by its own
        #    spawn frame index) and render it; drop it once it exits view.
        for track in list(spawned_tracks):
            elapsed_steps = new_idx - track["spawn_idx"]
            current_centroid = track["centroid"] + track["velocity"] * (elapsed_steps * DT)
            if not in_bounds(current_centroid):
                spawned_tracks.remove(track)
                continue
            pts, labels = render_track(track, current_centroid, rng)
            dyn_pts_list.append(pts)
            dyn_lab_list.append(labels)

        out_pts = np.concatenate(dyn_pts_list, axis=0)
        out_lab = np.concatenate(dyn_lab_list, axis=0)
        save_frame(new_idx, out_pts, out_lab)

        done = new_idx - EXISTING + 1
        if done % 50 == 0 or done == TO_GENERATE:
            elapsed = time.time() - start_time
            rate = done / elapsed
            remaining = (TO_GENERATE - done) / rate if rate > 0 else 0
            print(f"  [{done:4d}/{TO_GENERATE}] frames generated  "
                  f"({elapsed:.1f}s elapsed, ~{remaining:.0f}s remaining, "
                  f"{len(spawned_tracks)} synthetic object(s) currently in view)")

    total_time = time.time() - start_time
    print("=" * 60)
    print(f"\nDone! Generated {TO_GENERATE} new frames in {total_time:.1f} seconds.")
    print(f"Total dataset: {TARGET_TOTAL} frames (000000.bin - 000999.bin)")
    print("Dynamic objects now move along real, constant-velocity trajectories;")
    print("static background is always real, looped data - never fabricated.")

    total_vel = len([f for f in os.listdir(VEL_DIR) if f.endswith('.bin')])
    total_lab = len([f for f in os.listdir(LAB_DIR) if f.endswith('.label')])
    print(f"\nVerification: {total_vel} .bin files, {total_lab} .label files")


if __name__ == "__main__":
    main()