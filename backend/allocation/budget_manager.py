class BudgetManager:
    def __init__(self, config):
        self.config = config

    def allocate(self, candidates, map_manager):
        # First decide which regions should coarsen based on low utility.
        coarsen = [
            c for c in candidates
            if c["to_resolution"] > c["from_resolution"]
            and c["utility"] <= self.config.coarsen_threshold
        ]
        # Refine candidates are ranked by utility = IG / cost.
        refine = sorted(
            [c for c in candidates if c["to_resolution"] < c["from_resolution"]],
            key=lambda c: c["utility"], reverse=True
        )

        selected = list(coarsen)
        remaining = max(0.0, self.config.computational_budget - map_manager.active_cost)

        for c in refine:
            if c["utility"] < self.config.refine_threshold:
                continue
            if c["cost"] <= remaining:
                selected.append(c)
                remaining -= c["cost"]
        return selected
