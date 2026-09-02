from dataclasses import dataclass, field

@dataclass
class Config:
    resolution_levels: list = field(default_factory=lambda: [0.50, 0.20, 0.05])
    map_dimensions: tuple = (40.0, 30.0)
    computational_budget: float = 160.0
    prediction_horizon: float = 2.0

    # Current/future value weights
    wS: float = 0.30
    wM: float = 0.20
    wU: float = 0.15
    wG: float = 0.15
    wD: float = 0.05
    wP: float = 0.15

    # IG weights
    aU: float = 0.20
    aS: float = 0.30
    aG: float = 0.15
    aM: float = 0.15
    aF: float = 0.20

    # Decision hysteresis
    refine_threshold: float = 0.55
    coarsen_threshold: float = 0.25
    min_dwell_frames: int = 2
    max_stale_frames: int = 5  # frames an active cell may go unobserved before it decays

    # Cost model
    k_compute: float = 0.20
    k_memory: float = 0.10
    k_points: float = 0.02
    hardware_multiplier: float = 1.0

    # Simulator
    simulation_dt: float = 0.20
    noise_std: float = 0.04
    point_density: int = 10
    random_seed: int = 7

    # Tracking/prediction
    process_noise: float = 0.15
    measurement_noise: float = 0.25
    prediction_sigma: float = 0.8

    def update(self, data):
        for key, value in data.items():
            if hasattr(self, key):
                setattr(self, key, value)
        if "resolution_levels" in data:
            self.resolution_levels = sorted([float(x) for x in data["resolution_levels"]], reverse=True)

    def to_dict(self):
        return self.__dict__.copy()