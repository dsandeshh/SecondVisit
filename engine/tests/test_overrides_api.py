import json

import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from dr import api, mp_import
    monkeypatch.setattr(mp_import, "DATA", tmp_path)
    (tmp_path / "abc").mkdir()
    (tmp_path / "abc" / "overrides.json").write_text(json.dumps(
        {"destination": {"pos": [1, 2], "label": "Reception desk"}, "face_yaw0_deg": 90}))
    return TestClient(api.app), tmp_path / "abc" / "overrides.json"


LM = {"id": "chair1", "kind": "seating", "label": "Chair", "pos": [1.0, 2.0], "confidence": 0.9, "fixed": False}


def test_add_rename_remove_and_keep_other_keys(client):
    c, path = client
    assert c.post("/api/overrides/abc/landmarks", json={"op": "add", "landmark": LM}).status_code == 200
    r = c.post("/api/overrides/abc/landmarks", json={"op": "rename", "id": "chair1", "label": "Waiting chair"})
    assert r.json()["extra_landmarks"][0]["label"] == "Waiting chair"
    r = c.post("/api/overrides/abc/landmarks", json={"op": "rename", "id": "dest", "label": "Front desk"})
    assert r.json()["label_overrides"]["dest"] == "Front desk"
    d = json.loads(path.read_text())
    assert d["destination"]["label"] == "Front desk" and d["face_yaw0_deg"] == 90
    assert c.post("/api/overrides/abc/landmarks", json={"op": "remove", "id": "chair1"}).json()["extra_landmarks"] == []
    assert "chair1" in json.loads(path.read_text())["deleted_landmark_ids"]
    assert c.get("/api/overrides/abc").json()["deleted_landmark_ids"] == ["chair1"]


def test_rejects_bad_input(client):
    c, _ = client
    assert c.post("/api/overrides/abc/landmarks", json={"op": "remove", "id": "dest"}).status_code == 409
    assert c.post("/api/overrides/abc/landmarks", json={"op": "rename", "id": "x", "label": " "}).status_code == 422
    assert c.post("/api/overrides/abc/landmarks", json={"op": "nope"}).status_code == 422
    assert c.post("/api/overrides/..%2Fetc/landmarks", json={"op": "remove", "id": "x"}).status_code in (400, 404, 422)
