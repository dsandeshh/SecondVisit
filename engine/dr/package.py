"""BuildingPackage v1 + v2 additions (shared contract). Mirror in web/src/types.ts."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Vec2 = tuple[float, float]
LandmarkKind = Literal["desk", "elevator", "stairs", "door", "glass_door", "seating",
                       "restroom", "sign", "pillar", "water", "other"]
Side = Literal["left", "right", "none"]
Source = Literal["matterport", "vexcel", "costar", "hand", "calc", "ai"]


class Grid(BaseModel):
    res: float
    width: int
    height: int
    origin: Vec2
    cells_b64: str  # uint8 row major, row 0 = lowest y; 0 free,1 wall,2 fixed,3 movable,4 glass,5 stairs/drop


class Room(BaseModel):
    id: str
    label: str
    polygon: list[Vec2]
    area_m2: float


class Door(BaseModel):
    id: str
    a: Vec2
    b: Vec2
    rooms: list[str] = Field(default_factory=list)  # [] or exactly two room ids


class Landmark(BaseModel):
    id: str
    kind: LandmarkKind
    label: str
    pos: Vec2
    confidence: float
    fixed: bool


class Entrance(BaseModel):
    id: str
    label: str
    pos: Vec2
    heading_deg: float


class Segment(BaseModel):
    id: str
    start: Vec2
    end: Vec2
    heading_deg: float
    length_m: float
    steps: int
    wall_side: Side
    open_m: float
    landmarks_passed: list[str]
    turn_after: Side
    turn_deg: float
    instruction: str


class ScoreParts(BaseModel):
    length_m: float
    wall_share: float
    open_m: float
    turns: float
    decisions: float
    hazards: float
    landmarks_per_10m: float


class Score(BaseModel):
    total: float
    parts: ScoreParts


class Route(BaseModel):
    id: str
    from_: str = Field(alias="from")
    to: str
    path: list[Vec2]
    segments: list[Segment]
    score: Score

    model_config = {"populate_by_name": True, "serialize_by_alias": True}


class SimResult(BaseModel):
    runs: int
    arrival_rate: float
    lost_cells_b64: str


class Arrival(BaseModel):
    lat: float
    lon: float
    entrance_side: str
    dropoff: Vec2
    driver_message: str
    image_url: str | None = None
    confirmed: bool = False
    curb_to_door_m: float | None = None
    dropoff_plan: Vec2 | None = None  # curb pin in plan metres (x east, y north from geo_anchor)


class Prov(BaseModel):
    src: Source
    ref: str
    at: str
    inputs: list[str] | None = None
    confidence: float | None = None


class GeoAnchor(BaseModel):
    lat: float
    lon: float
    plan_pos: Vec2
    plan_north_deg: float


class Frames(BaseModel):
    plan_from_matterport: list[float] | None = None  # 3x3 2D affine, row major (9 numbers)
    geo_anchor: GeoAnchor | None = None


class BuildingPackage(BaseModel):
    version: Literal[1] = 1
    id: str
    name: str
    source: Literal["matterport", "fixture"]
    model_id: str | None = None
    generated_at: str
    grid: Grid
    rooms: list[Room] = Field(default_factory=list)
    doors: list[Door] = Field(default_factory=list)
    landmarks: list[Landmark] = Field(default_factory=list)
    entrances: list[Entrance] = Field(default_factory=list)
    routes: list[Route] = Field(default_factory=list)
    sim: dict[str, SimResult] = Field(default_factory=dict)
    arrival: Arrival | None = None
    notes: list[str] = Field(default_factory=list)
    # v2
    prov: dict[str, Prov] = Field(default_factory=dict)
    frames: Frames = Field(default_factory=Frames)
    map_date: str = ""


class PortfolioRow(BaseModel):
    """One line of web/public/portfolio.json (Task 20). Mirror in web/src/types.ts."""
    sid: str
    name: str
    address: str = ""
    costar_property_id: str = ""
    costar: dict = Field(default_factory=dict)
    rank: int | None = None
    total: float | None = None
    parts: dict[str, float] = Field(default_factory=dict)
    build_s: float = 0.0
    assumed_entrance: bool = False
    skipped: str | None = None  # data reason (no walls, no rooms, no route)
    error: str | None = None  # "<Type>: <msg>" for an unexpected exception (a bug, not a data problem)
    tour_url: str = ""
