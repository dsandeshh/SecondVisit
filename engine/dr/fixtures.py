"""Invented lobby fixture: 20 x 12 m room, 0.2 m walls, west door gap, central pillar."""
from __future__ import annotations

import numpy as np

from dr.config import GRID_RES
from dr.grid import OccGrid
from dr.package import Entrance, Landmark


def lobby_fixture() -> tuple[OccGrid, list[Entrance], list[Landmark]]:
    res = GRID_RES
    w, h = round(20 / res), round(12 / res)
    c = np.zeros((h, w), dtype=np.uint8)
    t = round(0.2 / res)
    c[:t, :] = 1
    c[-t:, :] = 1
    c[:, :t] = 1
    c[:, -t:] = 1
    c[round(5.4 / res):round(6.6 / res), :t] = 0  # west gap
    c[round(5.5 / res):round(6.5 / res), round(9.5 / res):round(10.5 / res)] = 2  # pillar
    ents = [Entrance(id="ent_w", label="West entrance", pos=(0.5, 6.0), heading_deg=90)]
    lms = [Landmark(id="desk", kind="desk", label="Reception desk", pos=(18.5, 10.8),
                    confidence=1.0, fixed=True)]
    return OccGrid(c, res, (0.0, 0.0)), ents, lms
