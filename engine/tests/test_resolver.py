import zipfile
import json
import socket

import pytest

from dr import resolver

FIX = resolver.ROOT / "data" / "fixtures"


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    monkeypatch.setenv("DR_OFFLINE", "1")
    monkeypatch.setenv("DR_INDEX_CSV", str(FIX / "index_small.csv"))

    def boom(*a, **k):
        raise AssertionError("network call")
    monkeypatch.setattr(socket, "create_connection", boom)


@pytest.fixture
def kit(tmp_path, monkeypatch):
    p = tmp_path / "kit.zip"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("commercial-properties.csv", (FIX / "costar_small.csv").read_text())
        z.writestr("data/commercial-property.jsonl", json.dumps({"id": 5615020, "name": "Invented"}) + "\n")
        z.writestr("data/location-occupancy.jsonl", json.dumps({"propertyId": 5615020, "tenantLocationId": 9}) + "\n")
        z.writestr("data/company-detail.jsonl", json.dumps({"id": 9, "name": "Invented Tenant"}) + "\n")
    monkeypatch.setenv("COSTAR_KIT_ZIP", str(p))
    monkeypatch.setenv("COSTAR_ZIP_PASSWORD", "")


def test_medical_office_houston_resolves(kit):
    r = resolver.resolve("medical office houston")
    assert r["best"]["sid"] == "x37LjPx62VA"
    assert not r["ambiguous"]
    assert r["costar"]["property"]["id"] == 5615020


def test_suite_106_is_ambiguous():
    r = resolver.resolve("suite 106")
    assert r["ambiguous"]
    assert len(r["candidates"]) >= 2
    assert {c["sid"] for c in r["candidates"][:2]} == {"fixAAAAAAA1", "fixBBBBBBB2"}


def test_city_filter():
    got = resolver.search_index("suite 106", city="Houston")
    assert got[0]["sid"] == "fixBBBBBBB2" and all(c["city"] == "Houston" for c in got)


def test_costar_joins_to_fixture_rows(kit):
    rec = resolver.costar_record("5615020")
    assert rec["models"] == ["x37LjPx62VA", "hpGRjK5uFPW"]
    assert rec["tenants"][0]["name"] == "Invented Tenant"
    assert resolver.costar_record("999") is None


def _ref(r):
    return r["prov_entries"]["resolver.suite"].ref


@pytest.mark.parametrize("setup", ["missing", "badpw", "corrupt", "nomember"])
def test_kit_unavailable_never_crashes(tmp_path, monkeypatch, setup):
    monkeypatch.setattr(resolver.probe, "DATA", tmp_path / "nodata")  # no cached costar.json
    p = tmp_path / "kit.zip"
    monkeypatch.setenv("COSTAR_KIT_ZIP", str(p))
    monkeypatch.setenv("COSTAR_ZIP_PASSWORD", "s3cretpw")
    if setup == "corrupt":
        p.write_bytes(b"not a zip")
    elif setup == "nomember":
        with zipfile.ZipFile(p, "w") as z:
            z.writestr("other.txt", "x")
    elif setup == "badpw":
        import shutil
        import subprocess
        if not shutil.which("zip"):
            pytest.skip("zip CLI absent")
        (tmp_path / "a.txt").write_text("x")
        subprocess.run(["zip", "-q", "-P", "otherpw", str(p), "a.txt"], cwd=tmp_path, check=True)
    r = resolver.resolve("medical office houston")
    assert r["best"]["sid"] == "x37LjPx62VA" and r["costar"] is None
    assert "kit unavailable:" in _ref(r)
    assert "s3cretpw" not in _ref(r)


def test_cached_costar_json_preferred(tmp_path, monkeypatch):
    monkeypatch.setenv("COSTAR_KIT_ZIP", str(tmp_path / "absent.zip"))
    monkeypatch.setattr(resolver.probe, "DATA", tmp_path)
    raw = tmp_path / "x37LjPx62VA" / "raw"
    raw.mkdir(parents=True)
    (raw / "costar.json").write_text(json.dumps({"property": {"id": 5615020}, "tenants": [], "models": []}))
    r = resolver.resolve("medical office houston")
    assert r["costar"]["property"]["id"] == 5615020
    assert "kit unavailable" not in _ref(r)


def test_missing_index_names_path_and_override(tmp_path, monkeypatch):
    monkeypatch.setenv("DR_INDEX_CSV", str(tmp_path / "nope.csv"))
    with pytest.raises(FileNotFoundError) as e:
        resolver.search_index("x")
    assert "nope.csv" in str(e.value) and "DR_INDEX_CSV" in str(e.value)
    assert "\n" not in str(e.value)
