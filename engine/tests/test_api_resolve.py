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
