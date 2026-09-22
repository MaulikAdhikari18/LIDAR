"""
Hierarchical Variable-Resolution 2.5D Quadtree Map.

Implements:
  - Master Doc Sec. 2  — 2.5D representation: cell = (x,y) region + elevation
    + occupancy + semantic class + velocity + confidence.
  - Master Doc Sec. 12 — hierarchical spatial structure, subdivide when
    utility rises, merge when utility falls.
  - Master Doc Sec. 15 — "What REFINE actually means": a 50cm cell that
    becomes high-utility is subdivided into finer children (20cm, then 5cm).
  - Revision Notes Sec. 12 — resolution levels 0.50 / 0.20 / 0.05 m.

The map is PERSISTENT across frames (it is created once and mutated frame to
frame) — rebuilding it from scratch every frame is explicitly forbidden by
the Prototype Enhancements addendum (Sec. 3 / Sec. 10).
"""
from __future__ import annotations
import itertools
from typing import Optional, List

from config import RESOLUTION_LEVELS


class QuadCell:
    """A single 2.5D map cell at some level of the resolution hierarchy."""

    _id_counter = itertools.count()

    def __init__(self, x_min, y_min, x_max, y_max, level: int = 0,
                 parent: Optional["QuadCell"] = None):
        self.id = f"L{level}_{next(QuadCell._id_counter)}"
        self.x_min, self.y_min, self.x_max, self.y_max = x_min, y_min, x_max, y_max
        self.level = level
        self.parent = parent
        self.children: List["QuadCell"] = []

        # ---- 2.5D attributes (Master Doc Sec. 2) --------------------------
        self.elevation = 0.0
        self.occupancy = 0.0
        self.semantic_class = "unknown"
        self.velocity = (0.0, 0.0)
        self.confidence = 0.5
        self.observation_count = 0
        self.point_count = 0

        # ---- decision bookkeeping (for explainability / reclamation) -----
        self.last_decision = "MAINTAIN"
        self.last_utility = 0.0
        self.last_information_gain = 0.0
        self.last_cost = 0.0
        self.allocated_cost = 1.0  # cost currently "owned" by this cell in the budget ledger
        self.retention_utility = 0.0  # persisted separately from last_utility -- see adaptive_map_manager.py
        self.future_probability = 0.0
        self.signals = {}  # last computed S/M/U/G/D breakdown, for the explainable panel
        # Frame index of this cell's last REFINE/COARSEN transition, used to
        # enforce a cooldown before it can transition again (prevents
        # threshold-boundary flip-flopping -- see TRANSITION_COOLDOWN_FRAMES
        # in config.py).
        self.last_transition_frame = -10**9

    # ------------------------------------------------------------------ geometry
    @property
    def center(self):
        return ((self.x_min + self.x_max) / 2.0, (self.y_min + self.y_max) / 2.0)

    @property
    def size(self):
        return RESOLUTION_LEVELS[self.level]

    def contains_point(self, x, y) -> bool:
        return self.x_min <= x < self.x_max and self.y_min <= y < self.y_max

    def is_leaf(self) -> bool:
        return len(self.children) == 0

    # ------------------------------------------------------------------ hierarchy
    def can_refine(self) -> bool:
        return self.level < len(RESOLUTION_LEVELS) - 1 and self.is_leaf()

    def can_coarsen(self) -> bool:
        return self.level > 0

    def children_per_side(self) -> int:
        """How many child cells per side when subdividing one level finer.
        Legal transition only: level -> level+1, never skipping a level."""
        cur = RESOLUTION_LEVELS[self.level]
        nxt = RESOLUTION_LEVELS[self.level + 1]
        return max(2, round(cur / nxt))

    def num_new_cells_if_refined(self) -> int:
        n = self.children_per_side()
        return n * n

    def refine(self) -> List["QuadCell"]:
        """Subdivide this leaf into next-finer children (legal transition
        only — one level at a time)."""
        if not self.can_refine():
            return []
        n = self.children_per_side()
        dx = (self.x_max - self.x_min) / n
        dy = (self.y_max - self.y_min) / n
        for i in range(n):
            for j in range(n):
                cx0 = self.x_min + i * dx
                cy0 = self.y_min + j * dy
                child = QuadCell(cx0, cy0, cx0 + dx, cy0 + dy,
                                  level=self.level + 1, parent=self)
                # children inherit state until they are re-observed this frame
                child.elevation = self.elevation
                child.semantic_class = self.semantic_class
                child.confidence = self.confidence
                child.velocity = self.velocity
                # also inherit the parent's last-computed signals/gain/cost/
                # utility so the explainable panel (Enhancement A4) never
                # shows a freshly-created cell as blank for the one frame
                # before it gets its own values computed.
                child.signals = dict(self.signals) if self.signals else {}
                child.last_information_gain = self.last_information_gain
                child.last_cost = self.last_cost
                child.last_utility = self.last_utility
                child.future_probability = self.future_probability
                self.children.append(child)
        self.last_decision = "REFINE"
        return self.children

    def coarsen(self) -> None:
        """Merge children back into this (parent) cell — releases their
        allocated budget back to the pool (handled by BudgetManager)."""
        self.children = []
        self.last_decision = "COARSEN"


class HierarchicalQuadtreeMap:
    """Persistent 2.5D hierarchical map covering a fixed (x, y) extent."""

    def __init__(self, x_range, y_range, base_level: int = 0):
        self.x_range = x_range
        self.y_range = y_range
        self.base_level = base_level
        self.root_cells: List[QuadCell] = self._build_base_grid()

    def _build_base_grid(self) -> List[QuadCell]:
        size = RESOLUTION_LEVELS[self.base_level]
        cells = []
        x0, x1 = self.x_range
        y0, y1 = self.y_range
        nx = max(1, round((x1 - x0) / size))
        ny = max(1, round((y1 - y0) / size))
        for i in range(nx):
            for j in range(ny):
                cx0 = x0 + i * size
                cy0 = y0 + j * size
                cells.append(QuadCell(cx0, min(cy0, y1), cx0 + size,
                                       min(cy0 + size, y1), level=self.base_level))
        return cells

    def all_leaf_cells(self) -> List[QuadCell]:
        leaves = []
        stack = list(self.root_cells)
        while stack:
            c = stack.pop()
            if c.is_leaf():
                leaves.append(c)
            else:
                stack.extend(c.children)
        return leaves

    def find_leaf(self, x, y) -> Optional[QuadCell]:
        for root in self.root_cells:
            if root.contains_point(x, y):
                return self._descend(root, x, y)
        return None

    def _descend(self, cell: QuadCell, x, y) -> QuadCell:
        if cell.is_leaf():
            return cell
        for child in cell.children:
            if child.contains_point(x, y):
                return self._descend(child, x, y)
        return cell

    def total_leaf_count(self) -> int:
        return len(self.all_leaf_cells())

    def memory_footprint_estimate(self) -> float:
        """1 unit per leaf cell — a simple, honest footprint proxy used by
        the benchmark comparison (Enhancement A3 / Demo D2 / D5)."""
        return float(self.total_leaf_count())

    def reset(self):
        QuadCell._id_counter = itertools.count()
        self.root_cells = self._build_base_grid()
