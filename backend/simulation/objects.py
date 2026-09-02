from dataclasses import dataclass

@dataclass
class SimObject:
    track_id: str
    class_name: str
    x: float
    y: float
    vx: float
    vy: float

    def step(self, dt):
        self.x += self.vx * dt
        self.y += self.vy * dt
        if abs(self.x) > 18:
            self.vx *= -1
        if abs(self.y) > 12:
            self.vy *= -1

    def to_detection(self):
        return {"track_id": self.track_id, "class": self.class_name,
                "x": self.x, "y": self.y, "vx": self.vx, "vy": self.vy,
                "confidence": 0.95}
