import pytest
from fastapi.testclient import TestClient

from dr import probe
from dr.api import app

c = TestClient(app)
pytestmark = pytest.mark.skipif(not (probe.INDEX_CSV if hasattr(probe, "INDEX_CSV") else None), reason="no index")


def test_empty_is_400():
    assert c.get("/api/resolve?q=").status_code == 400


def test_nonsense_is_404(tmp_path, monkeypatch):
    monkeypatch.setenv("DR_BUILDINGS", str(tmp_path))
    assert c.get("/api/resolve?q=zzzz qqqq").status_code == 404


def test_clinic_address_and_name_resolve_offline(tmp_path, monkeypatch):
    for sid in ("x37LjPx62VA", "fixture"):
        (tmp_path / sid).mkdir()
        (tmp_path / sid / "package.json").write_text("{}")
    monkeypatch.setenv("DR_BUILDINGS", str(tmp_path))
    for q in ("7400 FM-1960 W", "7400 FM 1960 W Houston", "Medical Office"):
        r = c.get("/api/resolve", params={"q": q})
        if r.status_code == 503:
            pytest.skip("sponsor index CSV absent")
        assert r.status_code == 200 and r.json()["sid"] == "x37LjPx62VA", q


def _small(tmp_path, monkeypatch, sids=("x37LjPx62VA", "hpGRjK5uFPW", "fixture")):
    for sid in sids:
        (tmp_path / sid).mkdir()
        (tmp_path / sid / "package.json").write_text("{}")
    monkeypatch.setenv("DR_BUILDINGS", str(tmp_path))
    monkeypatch.setenv("DR_INDEX_CSV", str(probe.ROOT / "data" / "fixtures" / "index_small.csv"))


def test_three_tiers(tmp_path, monkeypatch):
    from dr.voice_lines import FIXED_UI_LINES, NO_INDOOR_LINE, NOT_AVAILABLE_LINE
    _small(tmp_path, monkeypatch)
    r = c.get("/api/resolve", params={"q": "Office B"})
    assert r.status_code == 200 and r.json()["tier"] == "ready" and r.json()["sid"] == "hpGRjK5uFPW"
    r = c.get("/api/resolve", params={"q": "Alpha Studio"})
    j = r.json()
    assert r.status_code == 200 and j["tier"] == "outdoor" and j["sid"] == "fixAAAAAAA1"
    assert j["city"] == "Los Angeles" and j["message"] == NO_INDOOR_LINE == "No indoor scan yet for this building."
    for q in ("Gamma Works", "zzzz qqqq"):
        r = c.get("/api/resolve", params={"q": q})
        assert r.status_code == 404 and r.json()["tier"] == "none", q
        assert r.json()["message"] == NOT_AVAILABLE_LINE == "This building is not available yet."
    assert NO_INDOOR_LINE in FIXED_UI_LINES and NOT_AVAILABLE_LINE in FIXED_UI_LINES
