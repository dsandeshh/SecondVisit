"""Thin Anthropic wrapper. Model id from env only; any failure returns ''."""
from __future__ import annotations

import os


def complete(system: str, user: str, max_tokens: int = 300) -> str:
    try:
        model = os.environ.get("DR_FAST_MODEL", "")
        if not model:
            return ""
        model = model.split(":", 1)[1] if model.startswith("anthropic:") else model
        import anthropic

        msg = anthropic.Anthropic(timeout=25, max_retries=1).messages.create(
            model=model, max_tokens=max_tokens, system=system,
            messages=[{"role": "user", "content": user}])
        return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()
    except Exception:
        return ""
