"""Task 0: pull and cache every sponsor layer for one model into data/<sid>/raw/, then report on it.

    python -m dr.probe pull --model x37LjPx62VA
    python -m dr.probe status --model x37LjPx62VA

Each step writes one or more files and is skipped when they exist, so a second pull makes no HTTP
calls. Signed URLs are never trusted from the cache alone: on expiry the query is run again.
Everything written here is sponsor data and stays out of git (data/*/raw/ is gitignored).
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sys
import zipfile
from pathlib import Path
from typing import Callable

from dr import mp_client
from dr.mp_client import ROOT, HttpFile, MatterportError, MPClient

DATA = ROOT / "data"
INDEX_CSV = ROOT / "vendor" / "matterport" / "models_index.csv"
VEXCEL_ORTHO = "https://api.vexcelgroup.com/v2/ortho/extract"
FACES = (1, 2, 3, 4)  # horizon faces of the skybox: 0 up, 1 to 4 around, 5 down
CLOUD_STRIDE = 10

Q_BASICS = """query Basics($id: ID!) { model(id: $id) {
  id name description created visibility internalId
  address { address locality administrativeArea postalCode }
  geolocation { lat long }
  generatedDescription { summary }
  propertyClassifications { classification type }
  floors { id label } rooms { id } panoLocations { id }
  image { url } } }"""

Q_ROOMS = """query Rooms($id: ID!) { model(id: $id) {
  floors { id label sequence vertices { id position { x y } }
           edges { id type thickness vertices { id } } }
  rooms { id floor { id } classifications { label confidence } boundary { edges { id } }
          dimensions(units: metric) { areaFloor width depth height } }
  assets { floorplans(provider: "matterport") { format flags url width height resolution origin { x y } } }
  panoLocations { id label position { x y z } } } }"""

Q_PANOS = """query Panos($id: ID!) { model(id: $id) {
  panoLocations { id label position { x y z } skybox(resolution: "2k") { status children } }
  view(type: "matterport.model.defurnished") { id } } }"""

Q_PANOS_DEF = """query PanosDef($id: ID!) { model(id: $id) {
  panoLocations { id label position { x y z } skybox(resolution: "2k") { status children } } } }"""

Q_MATTERPAK = """query MatterPak($id: ID!) { model(id: $id) {
  bundle(id: "mp:matterpak") { availability assets { ... on Resource { format status filename url } } } } }"""


def _read(p: Path):
    return json.loads(p.read_text())


def _write(p: Path, obj) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, indent=1))


def _pano_ids(raw: Path, name: str) -> list[str]:
    p = raw / name
    if not p.exists():
        return []
    d = _read(p)
    if d.get("none"):
        return []
    return [x["id"] for x in (d.get("model") or {}).get("panoLocations") or []]


def expected_files(raw: Path) -> list[str]:
    """Every file a finished pull leaves in `raw`, given what is cached so far."""
    files = ["basics.json", "rooms.json", "panos.json", "panos_defurnished.json"]
    files += [f"faces/{p}_{k}.jpg" for p in _pano_ids(raw, "panos.json") for k in FACES]
    files += [f"faces_def/{p}_{k}.jpg" for p in _pano_ids(raw, "panos_defurnished.json") for k in FACES]
    files += ["floorplan.jpg", "floorplan.json", "matterpak.json", "cloud_sample.xyz", "vexcel_ortho.jpg",
              "index_row.json", "costar.json"]
    return files


def missing_files(raw: Path) -> list[str]:
    return [f for f in expected_files(raw) if not (raw / f).exists()]


class Puller:
    def __init__(self, sid: str, raw: Path, client: MPClient | None):
        self.sid, self.raw = sid, raw
        self._client = client
        self._fresh: dict[str, dict] = {}

    @property
    def client(self) -> MPClient:
        if self._client is None:
            self._client = mp_client.client()
        return self._client

    # Queries, run at most once per pull when a cached signed URL has expired.
    def fresh(self, name: str, query: str, model_id: str | None = None, ok_codes=("not.found",)) -> dict:
        if name not in self._fresh:
            d = self.client.graph(query, {"id": model_id or self.sid}, ok_codes=ok_codes)
            self._fresh[name] = d
            if name in ("rooms.json", "panos.json", "panos_defurnished.json"):
                _write(self.raw / name, d)
        return self._fresh[name]

    def cached_or_fresh(self, name: str, query: str, model_id: str | None = None) -> Callable[[], dict]:
        """First call returns the cached response, later calls re query (the URLs inside it expired)."""
        state = {"n": 0}

        def get() -> dict:
            state["n"] += 1
            if state["n"] == 1 and (self.raw / name).exists():
                return _read(self.raw / name)
            self._fresh.pop(name, None)
            return self.fresh(name, query, model_id)
        return get

    # Steps -------------------------------------------------------------------------------------
    def step_json(self, name: str, query: str) -> str:
        if (self.raw / name).exists():
            return "cached"
        self.fresh(name, query)
        if name not in ("rooms.json", "panos.json"):
            _write(self.raw / name, self._fresh[name])
        return "pulled"

    def step_defurnished(self) -> str:
        if (self.raw / "panos_defurnished.json").exists():
            return "cached"
        view = ((_read(self.raw / "panos.json").get("model") or {}).get("view") or {}).get("id")
        if not view:
            _write(self.raw / "panos_defurnished.json", {"none": True})
            return "none (model has no defurnished view)"
        self.fresh("panos_defurnished.json", Q_PANOS_DEF, model_id=view)
        return "pulled"

    def step_faces(self, panos_name: str, folder: str, query: str, model_id: str | None = None) -> str:
        ids = _pano_ids(self.raw, panos_name)
        todo = [(p, k) for p in ids for k in FACES if not (self.raw / folder / f"{p}_{k}.jpg").exists()]
        if not todo:
            return "cached" if ids else "none"
        getters: dict[str, Callable[[], dict]] = {}
        for p, k in todo:
            get = getters.setdefault("g", self.cached_or_fresh(panos_name, query, model_id))
            first = {"done": False}

            def url(p=p, k=k, first=first) -> str:
                d = get() if not first["done"] else self.fresh(panos_name, query, model_id)
                first["done"] = True
                pano = next(x for x in d["model"]["panoLocations"] if x["id"] == p)
                return pano["skybox"]["children"][k]
            data = self.client.fetch_signed(url)
            out = self.raw / folder / f"{p}_{k}.jpg"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(data)
        return f"pulled {len(todo)} faces"

    def _pick_floorplan(self, d: dict) -> dict | None:
        plans = ((d.get("model") or {}).get("assets") or {}).get("floorplans") or []
        jpgs = [p for p in plans if (p.get("format") or "").lower() in ("jpg", "jpeg") and p.get("url")]
        jpgs.sort(key=lambda p: "photogramy" not in " ".join(p.get("flags") or []).lower())
        return jpgs[0] if jpgs else None

    def step_floorplan(self) -> str:
        if (self.raw / "floorplan.jpg").exists() and (self.raw / "floorplan.json").exists():
            return "cached"
        plan = self._pick_floorplan(_read(self.raw / "rooms.json"))
        if not plan:
            return "missing (no jpg floor plan)"
        first = {"done": False}

        def url() -> str:
            d = _read(self.raw / "rooms.json") if not first["done"] else self.fresh("rooms.json", Q_ROOMS)
            first["done"] = True
            return self._pick_floorplan(d)["url"]
        (self.raw / "floorplan.jpg").write_bytes(self.client.fetch_signed(url))
        _write(self.raw / "floorplan.json", {k: v for k, v in plan.items() if k != "url"})
        return "pulled"

    def _matterpak(self) -> dict:
        return (self.client.graph(Q_MATTERPAK, {"id": self.sid}).get("model") or {}).get("bundle") or {}

    def step_matterpak(self) -> str:
        if (self.raw / "matterpak.json").exists():
            return "cached"
        b = self._matterpak()
        assets = [{k: v for k, v in a.items() if k != "url"} | {"has_url": bool(a.get("url"))}
                  for a in b.get("assets") or []]
        _write(self.raw / "matterpak.json", {"availability": b.get("availability"), "assets": assets})
        return f"pulled ({b.get('availability')})"

    def step_cloud(self) -> str:
        if (self.raw / "cloud_sample.xyz").exists():
            return "cached"
        if not any(a.get("has_url") for a in _read(self.raw / "matterpak.json").get("assets", [])):
            return "missing (MatterPak has no download link)"

        def url() -> str:
            return next(a["url"] for a in self._matterpak().get("assets") or [] if a.get("url"))
        z = zipfile.ZipFile(HttpFile(self.client, url))
        member = next(n for n in z.namelist() if n.endswith("cloud.xyz"))
        tmp = self.raw / "cloud_sample.xyz.part"
        kept = 0
        with z.open(member) as src, tmp.open("wb") as dst:
            for i, line in enumerate(src):
                if i % CLOUD_STRIDE == 0:
                    dst.write(line)
                    kept += 1
        tmp.rename(self.raw / "cloud_sample.xyz")
        return f"pulled {kept:,} points (every {CLOUD_STRIDE}th)"

    def step_vexcel(self) -> str:
        if (self.raw / "vexcel_ortho.jpg").exists():
            return "cached"
        geo = (_read(self.raw / "basics.json").get("model") or {}).get("geolocation") or {}
        if not geo.get("lat"):
            return "missing (no geolocation)"
        lat, lon = float(geo["lat"]), float(geo["long"])
        h = 30.0  # half side, metres: a 60 m square
        dla, dlo = h / 111_320, h / (111_320 * math.cos(math.radians(lat)))
        ring = [(lon - dlo, lat - dla), (lon + dlo, lat - dla), (lon + dlo, lat + dla), (lon - dlo, lat + dla),
                (lon - dlo, lat - dla)]
        body = {"wkt": "POLYGON((" + ",".join(f"{x:.7f} {y:.7f}" for x, y in ring) + "))", "srid": 4326,
                "layer": "urban,urban-r,wide-area,urban-g", "crop": "bounding_box", "image-format": "jpeg",
                "destination-dimensions": "1400,1400"}
        mp_client.load_env()
        key = os.environ.get("VEXCEL_API_KEY")
        if not key:
            return "missing (VEXCEL_API_KEY not set)"
        r = self.client._send("POST", VEXCEL_ORTHO, json=body, headers={"X-API-KEY": key})
        if r.status_code != 200 or r.content[:2] != b"\xff\xd8":
            return f"failed (Vexcel HTTP {r.status_code})"
        (self.raw / "vexcel_ortho.jpg").write_bytes(r.content)
        return "pulled"

    def step_index_row(self) -> str:
        if (self.raw / "index_row.json").exists():
            return "cached"
        with INDEX_CSV.open(newline="", encoding="utf-8") as f:
            row = next((r for r in csv.DictReader(f) if r["sid"] == self.sid), None)
        _write(self.raw / "index_row.json", row or {"none": True})
        return "pulled" if row else "missing (not in models_index.csv)"

    def step_costar(self) -> str:
        if (self.raw / "costar.json").exists():
            return "cached"
        pid = (_read(self.raw / "index_row.json").get("costar_property_id") or "").strip()
        if not pid.isdigit():
            _write(self.raw / "costar.json", {"none": True})
            return "none (no CoStar property id)"
        _write(self.raw / "costar.json", costar_record(int(pid)))
        return "pulled"

    def run(self) -> dict[str, str]:
        steps = [
            ("basics", lambda: self.step_json("basics.json", Q_BASICS)),
            ("rooms", lambda: self.step_json("rooms.json", Q_ROOMS)),
            ("panos", lambda: self.step_json("panos.json", Q_PANOS)),
            ("defurnished", self.step_defurnished),
            ("faces", lambda: self.step_faces("panos.json", "faces", Q_PANOS)),
            ("faces_def", lambda: self.step_faces("panos_defurnished.json", "faces_def", Q_PANOS_DEF,
                                                  _defurnished_view(self.raw))),
            ("floorplan", self.step_floorplan),
            ("matterpak", self.step_matterpak),
            ("cloud", self.step_cloud),
            ("vexcel", self.step_vexcel),
            ("index_row", self.step_index_row),
            ("costar", self.step_costar),
        ]
        report: dict[str, str] = {}
        for name, fn in steps:
            try:
                report[name] = fn()
            except (MatterportError, OSError, KeyError, StopIteration, zipfile.BadZipFile, ValueError) as e:
                report[name] = f"failed ({type(e).__name__}: {str(e)[:120]})"
        return report


def _defurnished_view(raw: Path) -> str | None:
    p = raw / "panos.json"
    return ((_read(p).get("model") or {}).get("view") or {}).get("id") if p.exists() else None


def costar_record(pid: int) -> dict:
    """Property, tenancies, tenant names and linked models for one CoStar id, from the local kit zip."""
    mp_client.load_env()
    path = Path(os.environ.get("COSTAR_KIT_ZIP") or DATA / "costar" / "costar_kit.zip")
    if not path.is_absolute():
        path = ROOT / path
    pw = (os.environ.get("COSTAR_ZIP_PASSWORD") or "").encode()
    z = zipfile.ZipFile(path)
    z.setpassword(pw)
    key = str(pid).encode()

    def scan(member: str, pred) -> list[dict]:
        out = []
        with z.open(member) as f:
            for line in f:
                if key in line:
                    r = json.loads(line)
                    if pred(r):
                        out.append(r)
        return out

    prop = scan("data/commercial-property.jsonl", lambda r: r.get("id") == pid)
    occ = scan("data/location-occupancy.jsonl", lambda r: r.get("propertyId") == pid)
    tids = {o["tenantLocationId"] for o in occ if o.get("tenantLocationId")}
    tenants = []
    if tids:
        with z.open("data/company-detail.jsonl") as f:
            for line in f:
                r = json.loads(line)
                if r.get("id") in tids:
                    tenants.append(r)
    with z.open("commercial-properties.csv") as f:
        rows = [r for r in csv.DictReader(line.decode("utf-8") for line in f) if r["PropertyId"] == str(pid)]
    return {"property": prop[0] if prop else None, "occupancies": occ, "tenants": tenants,
            "models": [r["MatterportModelId"] for r in rows]}


def pull(sid: str, data_root: Path = DATA, client: MPClient | None = None) -> dict[str, str]:
    raw = Path(data_root) / sid / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    return Puller(sid, raw, client).run()


def status(sid: str, data_root: Path = DATA) -> dict[str, str]:
    """One line per layer from the cache, for the Task 0 decision and docs/DATA_STATUS.md."""
    raw = Path(data_root) / sid / "raw"
    out: dict[str, str] = {}
    basics = (_read(raw / "basics.json").get("model") or {}) if (raw / "basics.json").exists() else {}
    rooms = (_read(raw / "rooms.json").get("model") or {}) if (raw / "rooms.json").exists() else {}
    edges = [e.get("type") for f in rooms.get("floors") or [] for e in f.get("edges") or []]
    out["walls"] = f"{len(edges)} edges, types {sorted(set(map(str, edges)))}"
    labels: dict[str, int] = {}
    for r in rooms.get("rooms") or []:
        lab = ((r.get("classifications") or [{}])[0]).get("label", "?")
        if lab != "Void":
            labels[lab] = labels.get(lab, 0) + 1
    out["rooms (non Void)"] = f"{sum(labels.values())}, labels {labels}"
    panos = (_read(raw / "panos.json").get("model") or {}) if (raw / "panos.json").exists() else {}
    pl = panos.get("panoLocations") or []
    sky = sum(1 for p in pl if len((p.get("skybox") or {}).get("children") or []) == 6)
    faces = len(list((raw / "faces").glob("*.jpg"))) if (raw / "faces").exists() else 0
    out["panos with skyboxes"] = f"{sky} of {len(pl)} ({faces} horizon faces cached)"
    out["defurnished view"] = "yes" if panos.get("view") else "no"
    mpak = _read(raw / "matterpak.json") if (raw / "matterpak.json").exists() else {}
    cloud = raw / "cloud_sample.xyz"
    out["MatterPak"] = (f"{mpak.get('availability')}, "
                        f"{'point cloud sample cached' if cloud.exists() else 'no point cloud sample'}")
    out["floor plan"] = "yes" if (raw / "floorplan.jpg").exists() else "no"
    out["Vexcel ortho"] = "yes" if (raw / "vexcel_ortho.jpg").exists() else "no"
    out["visibility"] = str(basics.get("visibility"))
    cs = _read(raw / "costar.json") if (raw / "costar.json").exists() else {}
    out["CoStar record"] = "yes" if cs.get("property") else "no"
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m dr.probe")
    ap.add_argument("command", choices=["pull", "status"])
    ap.add_argument("--model", required=True)
    a = ap.parse_args(argv)
    if a.command == "pull":
        c = mp_client.client()
        for k, v in pull(a.model, client=c).items():
            print(f"{k:<12} {v}")
        print(f"downloaded {c.downloaded / 1e6:.1f} MB")
    for k, v in status(a.model).items():
        print(f"{k:<20} {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
