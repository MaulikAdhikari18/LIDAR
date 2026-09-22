from core.quadtree import HierarchicalQuadtreeMap


def test_base_grid_resolution():
    m = HierarchicalQuadtreeMap((0.0, 1.0), (0.0, 1.0))
    # 1.0 / 0.5 = 2 cells per side -> 4 root cells
    assert len(m.root_cells) == 4
    for c in m.root_cells:
        assert c.level == 0
        assert c.size == 0.50


def test_refine_creates_legal_next_level_children():
    m = HierarchicalQuadtreeMap((0.0, 1.0), (0.0, 1.0))
    cell = m.root_cells[0]
    assert cell.can_refine()
    children = cell.refine()
    assert len(children) == cell.children_per_side() ** 2
    for c in children:
        assert c.level == cell.level + 1
        assert c.size == 0.20  # legal one-level-finer transition


def test_cannot_refine_finest_level():
    m = HierarchicalQuadtreeMap((0.0, 1.0), (0.0, 1.0))
    cell = m.root_cells[0]
    cell.refine()          # level 0 -> 1
    child = cell.children[0]
    child.refine()          # level 1 -> 2 (finest)
    grandchild = child.children[0]
    assert grandchild.level == 2
    assert grandchild.can_refine() is False


def test_coarsen_removes_children():
    m = HierarchicalQuadtreeMap((0.0, 1.0), (0.0, 1.0))
    cell = m.root_cells[0]
    cell.refine()
    assert not cell.is_leaf()
    cell.coarsen()
    assert cell.is_leaf()


def test_total_leaf_count_matches_all_leaves():
    m = HierarchicalQuadtreeMap((0.0, 2.0), (0.0, 2.0))
    before = m.total_leaf_count()
    m.root_cells[0].refine()
    after = m.total_leaf_count()
    added = m.root_cells[0].children_per_side() ** 2 - 1  # -1 because parent is no longer a leaf
    assert after == before + added
