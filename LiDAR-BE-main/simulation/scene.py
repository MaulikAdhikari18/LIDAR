import numpy as np
from .objects import SimObject
from .lidar_simulator import generate_point_cloud

class SyntheticScene:
    def __init__(self, config):
        self.config = config
        self.rng = np.random.default_rng(config.random_seed)
        self.t = 0.0
        self.objects = [
            SimObject("ped-1", "pedestrian", -4.0, 2.0, 0.9, 0.25),
            SimObject("veh-1", "vehicle", 8.0, -5.0, -0.45, 0.0),
            SimObject("obs-1", "obstacle", 13.0, 7.0, 0.0, 0.0),
        ]

    def next_frame(self):
        self.t += self.config.simulation_dt
        for obj in self.objects:
            obj.step(self.config.simulation_dt)
        points = generate_point_cloud(self.objects, self.config, self.rng)
        return {"points": points, "timestamp": self.t,
                "objects": [o.to_detection() for o in self.objects]}
