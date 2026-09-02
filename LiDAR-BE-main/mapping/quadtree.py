from .cell import Cell

class QuadTree:
    def __init__(self, config):
        self.config = config
        self.nodes = {}
        self._build_roots()

    def _build_roots(self):
        w, h = self.config.map_dimensions
        size = self.config.resolution_levels[0]
        step = size
        nx, ny = int(w/step), int(h/step)
        # Sparse roots are created only where needed by observations.
        self.root_size = step
        self.roots = {}

    def get_or_create(self, x, y):
        r = self.config.resolution_levels[0]
        key = (int((x + self.config.map_dimensions[0]/2)/r),
               int((y + self.config.map_dimensions[1]/2)/r))
        rid = f"r-{key[0]}-{key[1]}"
        if rid not in self.nodes:
            self.nodes[rid] = Cell(rid, key[0]*r-r/2, key[1]*r-r/2, r, r)
        return self.nodes[rid]

    def children_for(self, parent):
        levels = self.config.resolution_levels
        idx = levels.index(parent.resolution)
        if idx >= len(levels)-1:
            return []
        child_size = levels[idx+1]
        factor = max(1, round(parent.size / child_size))
        children = []
        for ix in range(factor):
            for iy in range(factor):
                x = parent.x - parent.size/2 + child_size/2 + ix*child_size
                y = parent.y - parent.size/2 + child_size/2 + iy*child_size
                rid = f"{parent.region_id}/{ix}-{iy}"
                c = self.nodes.get(rid)
                if c is None:
                    c = Cell(rid, x, y, child_size, child_size, parent.region_id)
                    self.nodes[rid] = c
                children.append(c)
        parent.children = [c.region_id for c in children]
        return children
