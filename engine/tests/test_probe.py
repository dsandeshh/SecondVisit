import json

import httpx

from dr import mp_client, probe


def _no_network(request):
    raise AssertionError(f"unexpected HTTP call to {request.url}")


def _seed_cache(raw):
    """Every file a finished pull leaves behind, for a model with one pano and no defurnished view."""
    (raw / "faces").mkdir(parents=True)
    files = {
        "basics.json": {"model": {"id": "S", "name": "M", "visibility": "public"}},
        "rooms.json": {"model": {"floors": [], "rooms": []}},
        "panos.json": {"model": {"panoLocations": [{"id": "p1"}]}},
        "panos_defurnished.json": {"none": True},
        "floorplan.json": {"origin": {"x": 0, "y": 0}, "resolution": 50},
        "matterpak.json": {"availability": "unlocked"},
        "index_row.json": {"sid": "S"},
        "costar.json": {"property": {"id": 1}},
    }
    for name, obj in files.items():
        (raw / name).write_text(json.dumps(obj))
    for name in ["floorplan.jpg", "cloud_sample.xyz", "vexcel_ortho.jpg"] + [f"faces/p1_{k}.jpg" for k in (1, 2, 3, 4)]:
        (raw / name).write_bytes(b"x")


def test_pull_skips_cached(tmp_path):
    raw = tmp_path / "S" / "raw"
    _seed_cache(raw)
    client = mp_client.MPClient("k", "t", transport=httpx.MockTransport(_no_network), min_interval=0)
    report = probe.pull("S", data_root=tmp_path, client=client)
    # The transport raises on any request, so reaching here means no HTTP calls were made.
    # "none" is the defurnished faces step for a model without a defurnished view.
    assert report and all(s == "cached" or s.startswith("none") for s in report.values()), report
    assert sum(s == "cached" for s in report.values()) == len(report) - 1


def test_expected_files_follow_panos(tmp_path):
    raw = tmp_path / "S" / "raw"
    _seed_cache(raw)
    (raw / "faces" / "p1_3.jpg").unlink()
    assert "faces/p1_3.jpg" in probe.missing_files(raw)
