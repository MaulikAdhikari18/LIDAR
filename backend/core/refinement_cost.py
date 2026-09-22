"""
utility/refinement_cost.py — Refinement Cost Model.

Revision Notes Sec. 9 says the documentation does not fully specify the
cost equation and explicitly names this module as authoritative. This is
that implementation.

Cost represents the resource impact of refining a cell: new sub-cells,
compute, memory and point-level processing (Sec. 9):

    ComputeComponent = k_compute * num_new_cells
    MemoryComponent  = k_memory  * num_new_cells
    PointsComponent  = k_points  * num_points_in_cell
    Cost = (ComputeComponent + MemoryComponent + PointsComponent) * hardware_multiplier

Defaults: k_compute=0.20, k_memory=0.10, k_points=0.02, hardware_multiplier=1.0
(all defined in config.py, the single source of truth).
"""
from __future__ import annotations

from config import (
    COST_K_COMPUTE, COST_K_MEMORY, COST_K_POINTS,
    COST_HARDWARE_MULTIPLIER, COST_MIN, MAINTENANCE_COST_MULTIPLIER,
)


def compute_refinement_cost(num_new_cells: int, num_points_in_cell: int,
                             hardware_multiplier: float = COST_HARDWARE_MULTIPLIER) -> float:
    compute_component = COST_K_COMPUTE * num_new_cells
    memory_component = COST_K_MEMORY * num_new_cells
    points_component = COST_K_POINTS * num_points_in_cell
    cost = (compute_component + memory_component + points_component) * hardware_multiplier
    return max(COST_MIN, cost)


def compute_maintain_cost(hardware_multiplier: float = COST_HARDWARE_MULTIPLIER) -> float:
    """A MAINTAIN/retention decision still keeps the cell's existing
    footprint "allocated" in the budget ledger — modelled as a small fixed
    maintenance cost, scaled by MAINTENANCE_COST_MULTIPLIER (see config.py
    for why this exists and is separate from the documented refine-cost
    coefficients)."""
    return max(COST_MIN, (COST_K_COMPUTE + COST_K_MEMORY) * hardware_multiplier * MAINTENANCE_COST_MULTIPLIER)
