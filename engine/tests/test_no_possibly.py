"""Human decision 15 Nov: the word "possibly" is never spoken or shown. Low confidence shows only as the AI chip
value. Both real buildings are built and every spoken string is checked."""
import re
from pathlib import Path

import pytest

from dr import names, pipeline, voice_lines

ROOT = Path(__file__).resolve().parents[2]
BAD = re.compile(r"possibly", re.I)


@pytest.mark.parametrize("sid", ["x37LjPx62VA", "hpGRjK5uFPW"])
def test_no_possibly_in_built_package(sid, tmp_path):
    d = ROOT / "data" / sid
    if not (d / "landmarks.json").exists() or not (d / "raw").exists():
        pytest.skip(f"local data for {sid} absent")
    pkg = pipeline.build_package(sid, web_root=tmp_path / "buildings", arrival=False)
    assert any(lm.confidence < names.POSSIBLE_BELOW for lm in pkg.landmarks)  # the case that used to say it
    if not pkg.voice_lines:
        voice_lines.add_voice_lines(pkg)
    for v in pkg.voice_lines:
        assert not BAD.search(v.text), v.text
    for lm in pkg.landmarks:
        assert not BAD.search(lm.spoken or ""), lm.spoken
    for r in pkg.routes:
        for s in r.segments:
            assert not BAD.search(s.instruction or ""), s.instruction


def test_confidence_words_never_reach_a_spoken_name():
    assert names.spoken_name("possibly exterior column", "pillar") == "Exterior column"
