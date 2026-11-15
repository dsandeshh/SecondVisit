import pytest
from starlette.websockets import WebSocketDisconnect
from fastapi.testclient import TestClient

from dr.api import app


def test_relay_fans_out_within_session_only_and_never_echoes():
    c = TestClient(app)
    with c.websocket_connect("/ws/obs/s1") as a, c.websocket_connect("/ws/obs/s1") as b, \
            c.websocket_connect("/ws/obs/s2") as other:
        a.send_text("hello")
        assert b.receive_text() == "hello"
        # drain order: send a second message from b; a must get only that, never its own "hello"
        b.send_text("back")
        assert a.receive_text() == "back"
        other.send_text("x")  # other session: nobody else there; must not reach a or b
        a.send_text("tail")
        assert b.receive_text() == "tail"


def test_relay_drops_oversize_messages():
    c = TestClient(app)
    with c.websocket_connect("/ws/obs/s3") as a, c.websocket_connect("/ws/obs/s3") as b:
        a.send_text("y" * 5000)
        a.send_text("ok")
        assert b.receive_text() == "ok"


def test_health():
    assert TestClient(app).get("/api/health").json() == {"ok": True}
