"""Fetch the MatterPak mesh for a model and extract the OBJ plus its textures.

The MatterPak zip also holds a large point cloud; we read the zip over HTTP range requests
(sponsor rule 5) and extract only the members we need, so the cloud never crosses the wire.

    cd engine && .venv/bin/python scripts/fetch_matterpak.py x37LjPx62VA

Writes data/<sid>/raw/matterpak/ (gitignored, sponsor data: never commit or publish).
Secrets come from .env and are never printed.
"""
from __future__ import annotations

import io
import sys
import zipfile
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dr.mp_client import ROOT, graph  # noqa: E402

QUERY = """query MatterPak($id: ID!) { model(id: $id) {
  bundle(id: "mp:matterpak") { availability assets { ... on Resource { format status filename url } } } } }"""
KEEP_SUFFIXES = (".obj", ".mtl", ".jpg", ".jpeg", ".png")


class HttpFile(io.RawIOBase):
    """Read-only seekable file over HTTP range requests, so zipfile can open a remote zip in place."""

    def __init__(self, url: str, block: int = 8 * 2**20) -> None:
        self.url, self.pos, self.block, self.buf, self.buf_at = url, 0, block, b"", -1
        head = httpx.get(url, headers={"Range": "bytes=0-0"}, timeout=60, follow_redirects=True)
        head.raise_for_status()
        self.size = int(head.headers["Content-Range"].split("/")[1])

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
            r = httpx.get(self.url, headers={"Range": f"bytes={self.pos}-{end}"}, timeout=120,
                          follow_redirects=True)
            r.raise_for_status()
            self.buf_at, self.buf = self.pos, r.content
        out = self.buf[self.pos - self.buf_at: self.pos - self.buf_at + n]
        self.pos += len(out)
        return out

    def readinto(self, b) -> int:  # type: ignore[no-untyped-def]
        data = self.read(len(b))
        b[: len(data)] = data
        return len(data)


def matterpak_url(sid: str) -> str:
    data = graph(QUERY, {"id": sid})
    bundle = (data["model"] or {}).get("bundle") or {}
    for asset in bundle.get("assets") or []:
        if asset.get("url"):
            print(f"bundle {bundle.get('availability')}: {asset.get('filename')} ({asset.get('status')})")
            return asset["url"]
    raise SystemExit(f"no MatterPak url for {sid} (availability {bundle.get('availability')!r})")


def main(sid: str) -> None:
    out = ROOT / "data" / sid / "raw" / "matterpak"
    out.mkdir(parents=True, exist_ok=True)
    remote = HttpFile(matterpak_url(sid))
    print(f"zip size {remote.size / 2**20:.0f} MB; reading the directory over range requests")
    with zipfile.ZipFile(remote) as zf:
        members = zf.infolist()
        for m in members:
            print(f"  {m.filename:60s} {m.file_size / 2**20:8.1f} MB")
        wanted = [m for m in members
                  if m.filename.lower().endswith(KEEP_SUFFIXES) and not m.is_dir()]
        got = 0
        for m in wanted:
            dest = out / Path(m.filename).name
            if dest.exists() and dest.stat().st_size == m.file_size:
                print(f"have {dest.name}")
                continue
            dest.write_bytes(zf.read(m))
            got += m.file_size
            print(f"wrote {dest.name} ({m.file_size / 2**20:.1f} MB)")
    print(f"fetched {got / 2**20:.1f} MB into {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "x37LjPx62VA")
