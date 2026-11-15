import pytest
from fastapi.testclient import TestClient

from dr import api, voice_lines

client = TestClient(api.app)


@pytest.fixture(autouse=True)
def cache(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "TTS_CACHE", tmp_path)
    return tmp_path


def test_cached_file_served_without_node(cache, monkeypatch):
    text = "Walk 14   steps."
    d = cache / "af_heart"
    d.mkdir()
    (d / f"{voice_lines.line_id('Walk 14 steps.')}.wav").write_bytes(b"RIFFfake")
    monkeypatch.setattr(api.subprocess, "run", lambda *a, **k: pytest.fail("node was called"))
    r = client.post("/api/tts", json={"text": text, "voice": "af_heart"})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/wav" and r.content == b"RIFFfake"


def test_miss_renders_via_node_and_caches(cache, monkeypatch):
    calls = []

    def fake(cmd, **kw):
        calls.append((cmd, kw))
        open(cmd[-1], "wb").write(b"RIFFnew")

    monkeypatch.setattr(api.subprocess, "run", fake)
    r = client.post("/api/tts", json={"text": "Hello", "voice": "bf_emma"})
    assert r.status_code == 200 and r.content == b"RIFFnew"
    assert calls[0][1]["timeout"] == 10 and "--render" in calls[0][0]
    assert (cache / "bf_emma" / f"{voice_lines.line_id('Hello')}.wav").read_bytes() == b"RIFFnew"
    client.post("/api/tts", json={"text": "Hello", "voice": "bf_emma"})
    assert len(calls) == 1


def test_default_voice_bad_voice_and_failure(cache, monkeypatch):
    monkeypatch.setenv("SV_VOICE", "am_michael")
    monkeypatch.setattr(api.subprocess, "run", lambda cmd, **k: open(cmd[-1], "wb").write(b"x"))
    assert client.post("/api/tts", json={"text": "Hi"}).status_code == 200
    assert (cache / "am_michael").is_dir()
    assert client.post("/api/tts", json={"text": "Hi", "voice": "../x"}).status_code == 422
    assert client.post("/api/tts", json={"text": "  "}).status_code == 422

    def boom(cmd, **k):
        raise api.subprocess.TimeoutExpired(cmd, 10)
    monkeypatch.setattr(api.subprocess, "run", boom)
    assert client.post("/api/tts", json={"text": "Other"}).status_code == 503
