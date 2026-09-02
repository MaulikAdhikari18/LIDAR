import math
from .quadtree import QuadTree

class MapManager:
    def __init__(self, config):
        self.config = config
        self.tree = QuadTree(config)
        self.active_ids = set()
        self.active_cost = 0.0
        self._last_release = 0.0
        self._last_consumption = 0.0

    def update_observations(self, observations):
        for obs in observations:
            cell = self.tree.get_or_create(obs["x"], obs["y"])
            if cell.region_id not in self.active_ids:
                self.active_ids.add(cell.region_id)
                cell.active = True
                cell.active_cost = self.cell_base_cost(cell.resolution)
                self.active_cost += cell.active_cost
            # Observation state follows the current persistent region.
            for k in ("z","occupancy","semantic_class","semantic_importance","motion",
                      "uncertainty","geometry","distance_relevance"):
                if k == "z":
                    cell.elevation = obs[k]
                elif k in obs:
                    setattr(cell, k, obs[k])
            cell.confidence = max(0.05, 1.0 - cell.uncertainty)

    def update_future_signal(self, future):
        for cell in self.active_regions():
            p = 0.0
            for f in future:
                d = math.hypot(cell.x - f["x"], cell.y - f["y"])
                sigma = max(0.25, f["sigma"])
                p = max(p, math.exp(-(d*d)/(2*sigma*sigma)))
            cell.future_probability = min(1.0, p)

    def active_regions(self):
        return [self.tree.nodes[rid] for rid in self.active_ids if self.tree.nodes[rid].active]

    def legal_transitions(self, region):
        levels = self.config.resolution_levels
        idx = levels.index(region.resolution)
        out = []
        if idx < len(levels)-1:
            out.append(levels[idx+1])  # refine
        if idx > 0:
            out.append(levels[idx-1])  # coarsen
        return out

    def cell_base_cost(self, resolution):
        # Transparent proxy for representation resource use.
        area = max(resolution**2, 1e-6)
        return 1.0 / area * 0.01

    def apply_decisions(self, decisions, frame_id, config):
        applied = []
        self._last_release = self._last_consumption = 0.0
        for d in decisions:
            region = self.tree.nodes.get(d["region_id"])
            if not region:
                continue
            old = region.resolution
            new = d["to_resolution"]
            if old == new:
                continue
            old_cost = region.active_cost
            if new < old:  # refine
                children = self.tree.children_for(region)
                region.active = False
                self.active_ids.discard(region.region_id)
                child_cost = 0.0
                for c in children:
                    c.active = True
                    c.semantic_class = region.semantic_class
                    c.semantic_importance = region.semantic_importance
                    c.motion = region.motion
                    c.uncertainty = region.uncertainty
                    c.geometry = region.geometry
                    c.distance_relevance = region.distance_relevance
                    c.future_probability = region.future_probability
                    c.active_cost = self.cell_base_cost(new)
                    self.active_ids.add(c.region_id)
                    child_cost += c.active_cost
                self.active_cost += child_cost - old_cost
                self._last_consumption += max(0.0, child_cost-old_cost)
                action = "REFINE"
                allocated = max(0.0, child_cost-old_cost)
            else:  # coarsen
                child_ids = list(region.children)
                release = 0.0
                for cid in child_ids:
                    c = self.tree.nodes.get(cid)
                    if c and c.active:
                        c.active = False
                        self.active_ids.discard(cid)
                        release += c.active_cost
                region.active = True
                self.active_ids.add(region.region_id)
                region.resolution = new
                region.active_cost = self.cell_base_cost(new)
                self.active_cost += region.active_cost - release
                self._last_release += max(0.0, release-region.active_cost)
                action = "COARSEN"
                allocated = -max(0.0, release-region.active_cost)

            rec = {
                **d, "previous_resolution": old, "candidate_resolution": new,
                "allocated_cost": allocated, "action": action,
                "budget_after": max(0.0, config.computational_budget-self.active_cost),
                "resources_released": self._last_release,
                "resources_consumed": self._last_consumption,
                "reason": "utility-driven allocation under finite budget"
            }
            applied.append(rec)
        return applied

    def reclaim_resources(self):
        self.active_cost = max(0.0, self.active_cost)

    def active_cell_count(self):
        return len(self.active_regions())

    def count_resolution(self, resolution):
        return sum(1 for c in self.active_regions() if abs(c.resolution-resolution) < 1e-9)

    def serialize_active(self):
        return [c.to_dict() for c in self.active_regions()]
