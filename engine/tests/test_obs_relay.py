import pytest
from starlette.websockets import WebSocketDisconnect
from fastapi.testclient import TestClient

from dr.api import app


OK = lambda t: '{"v":1,"t":"%s"}' % t


def test_relay_fans_out_within_session_only_and_never_echoes():
    c = TestClient(app)
    with c.websocket_connect("/ws/obs/s1") as a, c.websocket_connect("/ws/obs/s1") as b, \
            c.websocket_connect("/ws/obs/s2") as other:
        a.send_text(OK("hello"))
        assert b.receive_text() == OK("hello")
        # drain order: send a second message from b; a must get only that, never its own "hello"
        b.send_text(OK("back"))
        assert a.receive_text() == OK("back")
        other.send_text(OK("x"))
        a.send_text(OK("tail"))
        assert b.receive_text() == OK("tail")


def test_relay_drops_oversize_messages():
    c = TestClient(app)
    with c.websocket_connect("/ws/obs/s3") as a, c.websocket_connect("/ws/obs/s3") as b:
        a.send_text("y" * 5000)
        a.send_text(OK("ok"))
        assert b.receive_text() == OK("ok")


def test_health():
    assert TestClient(app).get("/api/health").json() == {"ok": True}


def test_invalid_and_binary_not_forwarded_and_other_session_silent():
    c = TestClient(app)
    with c.websocket_connect("/ws/obs/s5") as o1, c.websocket_connect("/ws/obs/s5") as o2, \
            c.websocket_connect("/ws/obs/s4") as a, c.websocket_connect("/ws/obs/s4") as b:
        a.send_text("not json")
        a.send_text('{"v":2,"t":"say"}')
        a.send_text('{"v":1}')
        a.send_text("[1]")
        a.send_bytes(b"\x00\x01")
        a.send_text(OK("good"))
        assert b.receive_text() == OK("good")  # nothing bad arrived before it
        o1.send_text(OK("m"))
        # in-order delivery: a leak from s4 would arrive before the marker
        assert o2.receive_text() == OK("m")


def test_bad_session_id_rejected_and_empty_rooms_removed():
    from dr import api
    c = TestClient(app)
    with pytest.raises(WebSocketDisconnect):
        with c.websocket_connect("/ws/obs/" + "x" * 65):
            pass
    with pytest.raises(WebSocketDisconnect):
        with c.websocket_connect("/ws/obs/bad.id"):
            pass
    with c.websocket_connect("/ws/obs/clean1") as a:
        a.send_text(OK("x"))
    assert "clean1" not in api._rooms
