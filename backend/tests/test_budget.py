from core.budget_manager import BudgetManager
from config import TOTAL_COMPUTATIONAL_BUDGET


def test_default_total_budget():
    b = BudgetManager()
    assert b.total_budget == TOTAL_COMPUTATIONAL_BUDGET == 5000


def test_allocate_within_budget():
    b = BudgetManager(total_budget=10.0)
    assert b.allocate("cellA", 4.0, frame_id=0) is True
    assert b.used_budget == 4.0
    assert b.remaining() == 6.0


def test_allocate_rejected_over_budget():
    b = BudgetManager(total_budget=5.0)
    assert b.allocate("cellA", 4.0, frame_id=0) is True
    assert b.allocate("cellB", 3.0, frame_id=0) is False  # would exceed 5.0
    assert b.used_budget == 4.0


def test_reclaim_frees_budget_for_reallocation():
    b = BudgetManager(total_budget=5.0)
    b.allocate("cellA", 4.0, frame_id=0)
    b.reclaim("cellA", 4.0, frame_id=1)
    assert b.used_budget == 0.0
    assert b.allocate("cellB", 5.0, frame_id=1) is True  # now fits


def test_ledger_records_events():
    b = BudgetManager(total_budget=10.0)
    b.allocate("cellA", 2.0, frame_id=0)
    b.reclaim("cellA", 2.0, frame_id=1)
    types = [e.type for e in b.ledger]
    assert types == ["REALLOCATE", "RECLAIM"]
