import math

class Tracker:
    def __init__(self, config):
        self.config = config
        self.tracks = {}

    def update(self, detections):
        out = []
        for d in detections:
            tid = d["track_id"]
            old = self.tracks.get(tid)
            if old:
                vx = 0.7 * old["vx"] + 0.3 * d["vx"]
                vy = 0.7 * old["vy"] + 0.3 * d["vy"]
            else:
                vx, vy = d["vx"], d["vy"]
            track = {
                "track_id": tid, "class": d["class"],
                "x": d["x"], "y": d["y"], "vx": vx, "vy": vy,
                "direction": math.atan2(vy, vx) if abs(vx)+abs(vy) > 1e-9 else 0.0,
                "uncertainty": 0.20,
            }
            self.tracks[tid] = track
            out.append(track)
        return out
