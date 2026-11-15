"""Matterport Model API client, ported from vendor/matterport/matterport_quickstart.py (graph, HttpFile).

Basic auth from .env (key = user, token = password), production URL only, at most one request per
`min_interval` seconds (default 0.25 s, under the 5 per second limit in CLAUDE.md rule 5), one retry on
transport errors and 5xx/429, and signed URLs re queried when they expire. Never logs the keys.
"""

from __future__ import annotations

import io
import os
import threading
import time
from pathlib import Path
from typing import Callable, Iterable

import httpx

API = "https://api.matterport.com/api/models/graph"  # production only: other hosts reject the hackathon keys
ROOT = Path(__file__).resolve().parents[2]


class MatterportError(RuntimeError):
    def __init__(self, message: str, code: str = ""):
        super().__init__(message)
        self.code = code


def load_env() -> None:
    """Load the repo's .env into os.environ (existing variables win)."""
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env", override=False)


def secret(name: str, required: bool = True) -> str | None:
    load_env()
    value = os.environ.get(name) or None
    if required and not value:
        raise MatterportError(f"{name} is not set; put it in {ROOT / '.env'}", code="config")
    return value


class MPClient:
    def __init__(self, key: str, token: str, transport: httpx.BaseTransport | None = None,
                 min_interval: float = 0.25, timeout: float = 120.0):
        self.auth = (key, token)
        self.min_interval = min_interval
        self._last = 0.0
        self._lock = threading.Lock()
        self._http = httpx.Client(transport=transport, timeout=timeout, follow_redirects=True)
        self.downloaded = 0

    @classmethod
    def from_env(cls, **kw) -> "MPClient":
        return cls(secret("MATTERPORT_API_KEY"), secret("MATTERPORT_API_TOKEN"), **kw)

    def _wait(self) -> None:
        with self._lock:
            delay = self._last + self.min_interval - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            self._last = time.monotonic()

    def _send(self, method: str, url: str, **kw) -> httpx.Response:
        for attempt in (0, 1):
            self._wait()
            try:
                r = self._http.request(method, url, **kw)
            except httpx.TransportError:
                if attempt:
                    raise
                continue
            if (r.status_code >= 500 or r.status_code == 429) and not attempt:
                time.sleep(1.0)
                continue
            return r
        raise AssertionError("unreachable")

    def graph(self, query: str, variables: dict | None = None, ok_codes: Iterable[str] = ()) -> dict:
        """Run a Model API query and return its `data`.

        Raises MatterportError with the GraphQL error code. Errors whose code is in `ok_codes` are
        tolerated when data came back (for example `not.found` on `view(type: defurnished)`).
        """
        r = self._send("POST", API, json={"query": query, "variables": variables or {}}, auth=self.auth)
        if r.status_code in (401, 403):
            raise MatterportError(f"Matterport rejected the key (HTTP {r.status_code}). Check MATTERPORT_API_KEY "
                                  f"and MATTERPORT_API_TOKEN; the keys work on production only.", code="auth")
        r.raise_for_status()
        body = r.json()
        ok = set(ok_codes)
        for e in body.get("errors") or []:
            code = (e.get("extensions") or {}).get("code", "")
            if code in ok and body.get("data"):
                continue
            raise MatterportError(f"GraphQL error ({code or 'no code'}): {e.get('message')}", code=code)
        return body.get("data") or {}

    def get(self, url: str, start: int | None = None, end: int | None = None) -> httpx.Response:
        headers = {}
        if start is not None or end is not None:
            headers["Range"] = f"bytes={start or 0}-{'' if end is None else end}"
        return self._send("GET", url, headers=headers)

    def fetch_signed(self, get_url: Callable[[], str], start: int | None = None, end: int | None = None) -> bytes:
        """GET a signed URL; on 401/403/410 (expired) ask `get_url` for a fresh one and try once more."""
        for attempt in (0, 1):
            r = self.get(get_url(), start, end)
            if r.status_code in (401, 403, 410) and not attempt:
                continue
            r.raise_for_status()
            self.downloaded += len(r.content)
            return r.content
        raise AssertionError("unreachable")


class HttpFile(io.RawIOBase):
    """Read only, seekable file over HTTP range requests, so zipfile can open a remote zip in place.

    `get_url` returns a (possibly fresh) signed URL; it is called again if the link expires.
    """

    def __init__(self, client: MPClient, get_url: Callable[[], str], block: int = 8 * 2**20):
        self.client, self.get_url, self.block = client, get_url, block
        self.pos, self.buf, self.buf_at = 0, b"", -1
        self._url = get_url()
        r = client.get(self._url, 0, 0)
        if r.status_code in (401, 403, 410):
            self._url = get_url()
            r = client.get(self._url, 0, 0)
        r.raise_for_status()
        self.size = int(r.headers["Content-Range"].split("/")[1])

    def _refresh(self) -> str:
        self._url = self.get_url()
        return self._url

    def seekable(self) -> bool:
        return True

    def readable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.pos

    def seek(self, off: int, whence: int = 0) -> int:
        self.pos = {0: off, 1: self.pos + off, 2: self.size + off}[whence]
        return self.pos

    def read(self, n: int = -1) -> bytes:
        n = self.size - self.pos if n is None or n < 0 else min(n, self.size - self.pos)
        if n <= 0:
            return b""
        if not (self.buf_at <= self.pos and self.pos + n <= self.buf_at + len(self.buf)):
            end = min(self.size, self.pos + max(n, self.block)) - 1
            urls = iter([self._url])
            self.buf = self.client.fetch_signed(lambda: next(urls, None) or self._refresh(), self.pos, end)
            self.buf_at = self.pos
        out = self.buf[self.pos - self.buf_at: self.pos - self.buf_at + n]
        self.pos += len(out)
        return out

    def readinto(self, b) -> int:
        data = self.read(len(b))
        b[:len(data)] = data
        return len(data)


_default: MPClient | None = None


def client() -> MPClient:
    global _default
    if _default is None:
        _default = MPClient.from_env()
    return _default


def graph(query: str, variables: dict | None = None, ok_codes: Iterable[str] = ()) -> dict:
    return client().graph(query, variables, ok_codes)
