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
