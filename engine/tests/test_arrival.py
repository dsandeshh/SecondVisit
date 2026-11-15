import json
import re

import pytest

from dr import arrival as A

JPEG = b"\xff\xd8\xff\xe0tiny"


class FakeResp:
    def __init__(self, code, content=JPEG):
        self.status_code, self.content = code, content


class FakeClient:
    def __init__(self, code):
        self.code, self.sent = code, []

    def _send(self, method, url, **kw):
        self.sent.append(kw)
        return FakeResp(self.code)


@pytest.fixture(autouse=True)
def key(monkeypatch):
    monkeypatch.setenv("VEXCEL_API_KEY", "k")


def test_wkt_lon_lat_order():
    c = FakeClient(200)
    assert A.vexcel_ortho(29.9666, -95.5394, client=c) == JPEG
    body = c.sent[0]["json"]
    nums = [float(n) for n in re.findall(r"-?\d+\.\d+", body["wkt"])]
    assert nums[0] < -90 and 29 < nums[1] < 30
    assert body["destination-dimensions"] == "1400,1400"


def test_403_raises_coverage_error():
    with pytest.raises(A.VexcelCoverageError):
        A.vexcel_ortho(40.0, -74.0, client=FakeClient(403))


def test_side_from_bearing():
    lat, lon = 29.9666, -95.5394
    b = A.bearing_deg(lat, lon, lat, lon + 0.0001)
    assert A.side_from_bearing(b) == "east"
    assert A.side_from_bearing(0) == "north" and A.side_from_bearing(359) == "north"


def _site(tmp_path):
    raw = tmp_path / "data" / "S" / "raw"
    raw.mkdir(parents=True)
    (raw / "basics.json").write_text(json.dumps({"model": {"name": "Medical Office", "geolocation": {
        "lat": "29.9666", "long": "-95.5394"}, "address": {"address": "7400 FM-1960 W, Houston"}}}))
    (raw / "vexcel_ortho.jpg").write_bytes(JPEG)
    return dict(data_dir=tmp_path / "data", web_dir=tmp_path / "web")


def test_unconfirmed_without_pins(tmp_path):
    kw = _site(tmp_path)
    r = A.build("S", {}, **kw)
    assert r.arrival.confirmed is False and r.curb_to_door_m is None
    assert (tmp_path / "web" / "S" / "arrival.jpg").read_bytes() == JPEG
    half = A.build("S", {"arrival": {"door_lat": 1, "door_lon": 2}}, **kw)
    assert half.arrival.confirmed is False


def test_confirmed_with_pins(tmp_path):
    kw = _site(tmp_path)
    lat, lon = 29.9666, -95.5394
    ov = {"arrival": {"door_lat": lat, "door_lon": lon + 0.0001, "curb_lat": lat - 0.0001, "curb_lon": lon + 0.0001}}
    r = A.build("S", ov, **kw)
    a = r.arrival
    assert a.confirmed and a.entrance_side == "east"
    assert a.driver_message == "Please drop me at the east entrance of Medical Office, 7400 FM-1960 W, Houston."
    assert r.curb_to_door_m == pytest.approx(11.1, abs=0.3)
    assert r.curb_summary == "From the drop off, the entrance is about 16 steps 1 o'clock."
    assert r.prov["arrival.dropoff"].src == "hand" and r.prov["arrival.curb_to_door_m"].src == "calc"


def test_clock_and_pixels():
    assert A.clock_hour(0) == 12 and A.clock_hour(90) == 3 and A.clock_hour(-90) == 9
    lat, lon = A.px_to_latlon(700, 0, 30.0, -95.0)
    assert lat > 30.0 and lon == pytest.approx(-95.0)


def test_contract_fields_and_null_arrival(tmp_path):
    kw = _site(tmp_path)
    assert A.build("S", {"arrival": None}, **kw).arrival.curb_to_door_m is None
    lat, lon = 29.9666, -95.5394
    r = A.build("S", {"arrival": {"door_lat": lat, "door_lon": lon + 0.0001, "curb_lat": lat - 0.0001,
                                  "curb_lon": lon + 0.0001}}, **kw)
    assert r.arrival.curb_to_door_m == pytest.approx(r.curb_to_door_m)
    assert r.arrival.dropoff_plan[1] < 0 < r.arrival.dropoff_plan[0]
    assert r.geo_anchor.plan_north_deg == 0 and "frames.geo_anchor" in r.prov


def test_fresh_fetch_matches_pixel_mapping(tmp_path, monkeypatch):
    kw = _site(tmp_path)
    (tmp_path / "data" / "S" / "raw" / "vexcel_ortho.jpg").unlink()
    seen = {}
    c = FakeClient(200)
    monkeypatch.setattr(A.probe, "client", lambda: c, raising=False)
    monkeypatch.setattr(A.probe.mp_client, "client", lambda: c)
    r = A.build("S", {}, **kw)
    wkt = c.sent[0]["json"]["wkt"]
    nums = [float(n) for n in re.findall(r"-?\d+\.\d+", wkt)]
    span_m = (max(nums[1::2]) - min(nums[1::2])) * 111_320
    assert span_m == pytest.approx(2 * A.ORTHO_HALF_M, abs=0.5)
    assert A.px_to_latlon.__defaults__[0] == A.ORTHO_HALF_M
    assert "60 m" in r.prov["arrival.image"].ref
    assert r.arrival.entrance_side == "unknown" and "the main entrance" in r.arrival.driver_message
