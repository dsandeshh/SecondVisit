"""export_pano_faces: cached horizon faces -> one GL cube map folder per pano plus an index the web projects from."""
import importlib.util
import json
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "engine" / "scripts" / "export_pano_faces.py"
spec = importlib.util.spec_from_file_location("export_pano_faces", SCRIPT)
epf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(epf)

COLORS = {1: (255, 0, 0), 2: (0, 255, 0), 3: (0, 0, 255), 4: (255, 255, 0)}
CUBE = ("px", "nx", "py", "ny", "pz", "nz")


def _raw(tmp: Path, ids=("a", "b"), faces=(1, 2, 3, 4)) -> Path:
    raw = tmp / "raw"
    (raw / "faces").mkdir(parents=True)
    locs = [{"id": i, "position": {"x": 1.0 + k, "y": -2.0, "z": 1.3}} for k, i in enumerate(ids)]
    rots = [{"id": i, "rotation": {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0}} for i in ids]
    (raw / "panos.json").write_text(json.dumps({"model": {"panoLocations": locs}}))
    (raw / "pano_rotations.json").write_text(json.dumps({"model": {"panoLocations": rots}}))
    for i in ids:
        for f in faces:
            Image.new("RGB", (64, 64), COLORS[f]).save(raw / "faces" / f"{i}_{f}.jpg")
    return raw


def _near(px, rgb):
    return all(abs(a - b) < 24 for a, b in zip(px, rgb))


def test_horizon_faces_land_on_the_gl_cube_faces_that_keep_them_unflipped(tmp_path):
    # GL cube faces run +X -> -Z -> -X -> +Z going right with +Y up, the same way Matterport faces 1..4 run
    # clockwise, so face 1 = px, 2 = nz, 3 = nx, 4 = pz and no image is flipped.
    raw = _raw(tmp_path)
    out = tmp_path / "pano"
    epf.export(raw, out, face_px=32, yaw0_deg=90.0, clockwise=True)
    for name, f in (("px", 1), ("nz", 2), ("nx", 3), ("pz", 4)):
        with Image.open(out / "a" / f"{name}.jpg") as im:
            assert im.size == (32, 32)
            assert _near(im.getpixel((16, 16)), COLORS[f]), name


def test_every_pano_gets_all_six_cube_faces_up_and_down_are_marked_placeholders(tmp_path):
    raw = _raw(tmp_path)
    out = tmp_path / "pano"
    idx = epf.export(raw, out, face_px=32, yaw0_deg=90.0, clockwise=True)
    for p in idx["panos"]:
        for name in CUBE:
            with Image.open(out / p["id"] / f"{name}.jpg") as im:
                im.load()
                assert im.size == (32, 32)
        assert p["real_faces"] == ["px", "nx", "pz", "nz"]


def test_manifest_has_full_position_quaternion_and_calibrated_yaw0(tmp_path):
    raw = _raw(tmp_path)
    out = tmp_path / "pano"
    idx = epf.export(raw, out, face_px=32, yaw0_deg=90.0, clockwise=True)
    assert idx["face_yaw0_deg"] == 90.0 and idx["face_px"] == 32
    a = next(p for p in idx["panos"] if p["id"] == "a")
    assert a["pos"] == [1.0, -2.0, 1.3]
    assert a["quat"] == [0.0, 0.0, 0.0, 1.0]
    assert a["yaw_deg"] == 0.0
    assert a["dir"] == "pano/a/"
    assert json.loads((out / "index.json").read_text()) == idx


def test_panos_missing_a_face_are_skipped(tmp_path):
    raw = _raw(tmp_path)
    (raw / "faces" / "b_3.jpg").unlink()
    idx = epf.export(raw, tmp_path / "pano", face_px=32, yaw0_deg=90.0, clockwise=True)
    assert [p["id"] for p in idx["panos"]] == ["a"]
    assert idx["skipped"] == ["b"]


def test_counter_clockwise_faces_are_refused(tmp_path):
    raw = _raw(tmp_path)
    with pytest.raises(ValueError):
        epf.export(raw, tmp_path / "pano", face_px=32, yaw0_deg=90.0, clockwise=False)


def test_clinic_export_matches_panos_json_when_present():
    """On a machine with the clinic cache and an export: 20 panos x 6 faces, each parses, xyz and yaw match the raw data."""
    sid = "x37LjPx62VA"
    raw, out = ROOT / "data" / sid / "raw", ROOT / "web" / "public" / "buildings" / sid / "pano"
    if not (out / "index.json").exists() or not (raw / "panos.json").exists():
        pytest.skip("clinic cache or export not on this machine (gitignored sponsor data)")
    from dr.annotate import load_pano_yaws
    idx = json.loads((out / "index.json").read_text())
    locs = {p["id"]: p["position"] for p in json.loads((raw / "panos.json").read_text())["model"]["panoLocations"]}
    yaws = load_pano_yaws(raw)
    assert len(idx["panos"]) == len(locs) == 20
    for p in idx["panos"]:
        loc = locs[p["id"]]
        assert p["pos"] == pytest.approx([loc["x"], loc["y"], loc["z"]])
        assert p["yaw_deg"] == pytest.approx(yaws[p["id"]], abs=1e-3)
        for name in CUBE:
            with Image.open(out / p["id"] / f"{name}.jpg") as im:
                im.load()
                assert im.size == (idx["face_px"], idx["face_px"])
