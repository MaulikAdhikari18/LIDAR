import math

class FuturePredictor:
    def __init__(self, config):
        self.config = config

    def predict(self, tracks, horizon):
        result = []
        for tr in tracks:
            speed = math.hypot(tr["vx"], tr["vy"])
            sigma = self.config.prediction_sigma + tr["uncertainty"] * horizon
            result.append({
                "track_id": tr["track_id"],
                "class": tr["class"],
                "x0": tr["x"], "y0": tr["y"],
                "x": tr["x"] + tr["vx"] * horizon,
                "y": tr["y"] + tr["vy"] * horizon,
                "sigma": sigma,
                "speed": speed,
                "horizon": horizon
            })
        return result
