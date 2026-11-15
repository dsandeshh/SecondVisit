import json

from dr import pipeline


def _raw(tmp_path, sid="s1"):
    raw = tmp_path / "data" / sid / "raw"
    raw.mkdir(parents=True)
    return raw


def test_panos_json_written_in_load_panos_shape(tmp_path):
    raw = _raw(tmp_path)
    (raw / "panos.json").write_text(json.dumps({"model": {"panoLocations": [
        {"id": "a", "position": {"x": -1.5, "y": 2.0, "z": 1.3}, "skybox": {}},
        {"id": "b", "position": {"x": 3.0, "y": -4.25, "z": 1.3}}]}}))
    web = tmp_path / "web"
    assert pipeline.write_panos(web_root=web, sid="s1", data_root=tmp_path / "data") == 2
    got = json.loads((web / "s1" / "panos.json").read_text())
    assert got == [{"id": "a", "position": {"x": -1.5, "y": 2.0}},
                   {"id": "b", "position": {"x": 3.0, "y": -4.25}}]


def test_panos_json_skipped_with_note_when_raw_missing(tmp_path):
    (tmp_path / "data" / "s1" / "raw").mkdir(parents=True)
    web = tmp_path / "web"
    assert pipeline.write_panos(web_root=web, sid="s1", data_root=tmp_path / "data") == 0
    assert not (web / "s1" / "panos.json").exists()


def test_build_package_notes_missing_panos(tmp_path):
    import pytest
    clinic = pipeline.DATA / "x37LjPx62VA" / "raw" / "rooms.json"
    if not clinic.exists():
        pytest.skip("no cached clinic data")
    web = tmp_path / "b"
    pkg = pipeline.build_package("x37LjPx62VA", web_root=web, arrival=False)
    assert len(json.loads((web / "x37LjPx62VA" / "panos.json").read_text())) == 20
    assert not any("panos.json missing" in n for n in pkg.notes)
