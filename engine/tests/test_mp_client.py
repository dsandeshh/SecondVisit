import base64
import json

import httpx
import pytest

from dr import mp_client


def _client(handler):
    return mp_client.MPClient("the-key", "the-token", transport=httpx.MockTransport(handler), min_interval=0)


def test_graph_auth_header():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["Authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"data": {"model": {"id": "abc"}}})

    data = _client(handler).graph("query($id:ID!){model(id:$id){id}}", {"id": "abc"})
    assert data == {"model": {"id": "abc"}}
    assert seen["url"] == "https://api.matterport.com/api/models/graph"
    assert seen["auth"] == "Basic " + base64.b64encode(b"the-key:the-token").decode()
    assert seen["body"]["variables"] == {"id": "abc"}


def test_graph_auth_from_env(monkeypatch):
    monkeypatch.setenv("MATTERPORT_API_KEY", "env-key")
    monkeypatch.setenv("MATTERPORT_API_TOKEN", "env-token")
    c = mp_client.MPClient.from_env(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"data": {}})))
    assert c.auth == ("env-key", "env-token")


def test_graph_error_code():
    def handler(request):
        return httpx.Response(200, json={"errors": [{"message": "Not Found", "extensions": {"code": "not.found"}}]})

    with pytest.raises(mp_client.MatterportError) as e:
        _client(handler).graph("{x}")
    assert e.value.code == "not.found"


def test_graph_tolerates_ok_codes():
    def handler(request):
        return httpx.Response(200, json={"data": {"model": {"name": "M"}},
                                         "errors": [{"message": "Not Found", "extensions": {"code": "not.found"}}]})

    assert _client(handler).graph("{x}", ok_codes=("not.found",)) == {"model": {"name": "M"}}


def test_graph_rejected_key():
    with pytest.raises(mp_client.MatterportError) as e:
        _client(lambda r: httpx.Response(403, text="invalid key/secret")).graph("{x}")
    assert e.value.code == "auth"


def test_graph_retries_once():
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(502) if len(calls) == 1 else httpx.Response(200, json={"data": {"ok": 1}})

    assert _client(handler).graph("{x}") == {"ok": 1}
    assert len(calls) == 2


def test_fetch_signed_requeries_expired_url():
    urls = iter(["https://cdn.example/a?t=old", "https://cdn.example/a?t=new"])
    asked = []

    def handler(request):
        asked.append(str(request.url))
        return httpx.Response(403) if "old" in str(request.url) else httpx.Response(200, content=b"img")

    assert _client(handler).fetch_signed(lambda: next(urls)) == b"img"
    assert asked == ["https://cdn.example/a?t=old", "https://cdn.example/a?t=new"]


def test_httpfile_range_reads():
    blob = bytes(range(256)) * 40

    def handler(request):
        rng = request.headers.get("Range")
        a, b = rng.removeprefix("bytes=").split("-")
        a, b = int(a), int(b) if b else len(blob) - 1
        return httpx.Response(206, content=blob[a:b + 1], headers={"Content-Range": f"bytes {a}-{b}/{len(blob)}"})

    f = mp_client.HttpFile(_client(handler), lambda: "https://cdn.example/z", block=1000)
    assert f.size == len(blob)
    f.seek(5000)
    assert f.read(10) == blob[5000:5010]
    f.seek(-3, 2)
    assert f.read() == blob[-3:]
