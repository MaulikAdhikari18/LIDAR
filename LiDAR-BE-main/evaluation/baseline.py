class BaselineEngine:
    def __init__(self, config):
        self.config = config

    def compare(self, result):
        regions = result.get("regions", [])
        proposed = {
            "active_cells": len(regions),
            "estimated_cost": result["metrics"].get("used_budget", 0),
            "resolution_distribution": {
                str(r): sum(1 for c in regions if abs(c["resolution"]-r)<1e-9)
                for r in self.config.resolution_levels
            }
        }

        distances = sorted(regions, key=lambda c: c.get("distance_relevance", 0), reverse=True)
        distance_baseline = {
            "rule": "illustrative distance-based assignment",
            "active_cells": len(distances),
            "note": "This is a baseline representation for comparison; no performance gain is asserted."
        }
        uniform = {
            "rule": "uniform fixed resolution",
            "active_cells": len(regions),
            "note": "Use measured runs for computational comparison."
        }
        return {"proposed": proposed, "distance_based": distance_baseline, "uniform": uniform}
