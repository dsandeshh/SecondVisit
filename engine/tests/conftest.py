import pytest


@pytest.fixture(autouse=True)
def _no_live_services(monkeypatch):
    """dr.api loads .env at import. Tests never trace to LangSmith or call a live model."""
    monkeypatch.setenv("LANGSMITH_TRACING", "false")
    monkeypatch.setenv("LANGCHAIN_TRACING_V2", "false")
