"""Occupancy grid helpers. cells[row, col]; row 0 = lowest y."""
from __future__ import annotations

import base64

import numpy as np
from scipy.ndimage import distance_transform_edt

Vec2 = tuple[float, float]


class OccGrid:
    def __init__(self, cells: np.ndarray, res: float, origin: Vec2):
        self.cells = cells.astype(np.uint8)
        self.res = res
        self.origin = (float(origin[0]), float(origin[1]))

    def world_to_cell(self, p: Vec2) -> tuple[int, int]:
        return (int(np.floor((p[1] - self.origin[1]) / self.res)),
                int(np.floor((p[0] - self.origin[0]) / self.res)))

    def cell_to_world(self, rc: tuple[int, int]) -> Vec2:
        return (self.origin[0] + (rc[1] + 0.5) * self.res,
                self.origin[1] + (rc[0] + 0.5) * self.res)

    def to_b64(self) -> str:
        return base64.b64encode(np.ascontiguousarray(self.cells).tobytes()).decode("ascii")

    @classmethod
    def from_b64(cls, s: str, width: int, height: int, res: float, origin: Vec2) -> "OccGrid":
        a = np.frombuffer(base64.b64decode(s), dtype=np.uint8).reshape(height, width).copy()
        return cls(a, res, origin)

    def wall_distance(self) -> np.ndarray:
        """Metres from each cell to the nearest cell coded 1, 2 or 4."""
        solid = np.isin(self.cells, (1, 2, 4))
        if not solid.any():
            return np.full(self.cells.shape, np.inf)
        return distance_transform_edt(~solid) * self.res
