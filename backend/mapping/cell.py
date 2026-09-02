from dataclasses import dataclass, field
import math

@dataclass
class Cell:
    region_id: str
    x: float
    y: float
    size: float
    resolution: float
    parent_id: str | None = None
    children: list = field(default_factory=list)
    active: bool = True
    elevation: float = 0.0
    occupancy: float = 0.0
    semantic_class: str = "unknown"
    semantic_importance: float = 0.0
    confidence: float = 0.5
    motion: float = 0.0
    uncertainty: float = 0.5
    geometry: float = 0.0
    distance_relevance: float = 0.0
    future_probability: float = 0.0
    last_action_frame: int = -9999
    last_seen_frame: int = -9999
    active_cost: float = 0.0

    def distance(self):
        return math.hypot(self.x, self.y)

    def to_dict(self):
        return self.__dict__.copy()