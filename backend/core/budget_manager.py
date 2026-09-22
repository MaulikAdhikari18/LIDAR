"""
Fixed Computational Budget + Resource Reclamation/Reallocation.

Implements Revision Notes Sec. 11 (default budget = 5000) and Master Doc
Differentiator #6 ("The computational budget follows the information, not
the location") plus Enhancement's "explicit RECLAIM/REALLOCATE events"
requirement (see the old stub /demo/resource_flow, now backed for real).

Algorithm per frame:
  1. Every leaf cell's utility is computed elsewhere (adaptive_map_manager).
  2. Cells are sorted by utility, descending (highest expected benefit per
     unit cost first — greedy knapsack-style prioritisation, explicitly
     endorsed by the notes: "ML vs Mathematics" -> budget allocation is a
     greedy algorithm, not a trained model).
  3. Cells already below COARSEN_THRESHOLD immediately release their
     allocated cost back to the pool (RECLAIM event) and are coarsened.
  4. Remaining cells are walked in utility order. A REFINE candidate is
     granted the refinement (and its extra cost is now "allocated") only
     if the running total stays within TOTAL_COMPUTATIONAL_BUDGET
     (REALLOCATE event); otherwise it is downgraded to MAINTAIN/COARSEN.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, List

from config import TOTAL_COMPUTATIONAL_BUDGET
from core.utility import Decision


@dataclass
class LedgerEvent:
    type: str          # "RECLAIM" or "REALLOCATE"
    cell_id: str
    amount: float
    frame_id: int


@dataclass
class BudgetManager:
    total_budget: float = TOTAL_COMPUTATIONAL_BUDGET
    used_budget: float = 0.0
    ledger: List[LedgerEvent] = field(default_factory=list)

    def remaining(self) -> float:
        return max(0.0, self.total_budget - self.used_budget)

    def reclaim(self, cell_id: str, amount: float, frame_id: int):
        self.used_budget = max(0.0, self.used_budget - amount)
        self.ledger.append(LedgerEvent("RECLAIM", cell_id, amount, frame_id))

    def allocate(self, cell_id: str, amount: float, frame_id: int) -> bool:
        if amount <= self.remaining() + 1e-9:
            self.used_budget += amount
            self.ledger.append(LedgerEvent("REALLOCATE", cell_id, amount, frame_id))
            return True
        return False

    def recent_events(self, n: int = 20) -> List[dict]:
        return [e.__dict__ for e in self.ledger[-n:]]

    def reset(self):
        self.used_budget = 0.0
        self.ledger = []


def apply_budget_allocation(candidates: List[dict], budget: BudgetManager,
                             frame_id: int) -> Dict[str, str]:
    """
    candidates: list of dicts with keys:
        id, utility, decision (Decision enum from thresholding),
        current_cost (already-allocated cost this cell owns),
        refine_cost (extra cost REFINE would consume)
    Returns {cell_id: final_decision_str} after applying the finite budget.
    """
    # highest utility first -> greedy prioritisation (Master Doc Sec. 5/6)
    ordered = sorted(candidates, key=lambda c: c["utility"], reverse=True)

    final: Dict[str, str] = {}
    for c in ordered:
        cid = c["id"]
        threshold_decision = c["decision"]

        if threshold_decision == Decision.COARSEN:
            # release this cell's allocated cost back to the pool
            budget.reclaim(cid, c["current_cost"], frame_id)
            final[cid] = Decision.COARSEN.value

        elif threshold_decision == Decision.REFINE:
            # refinement only proceeds if the budget can actually afford it
            # (importance alone never guarantees refinement — Master Doc Sec. 6)
            granted = budget.allocate(cid, c["refine_cost"], frame_id)
            final[cid] = Decision.REFINE.value if granted else Decision.MAINTAIN.value

        else:  # MAINTAIN
            final[cid] = Decision.MAINTAIN.value

    return final
