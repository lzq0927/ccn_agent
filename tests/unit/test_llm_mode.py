# tests/unit/test_llm_mode.py
from agents.shared.llm_client import LLMConfig, _resolve_mode

def test_resolve_mode_explicit_stub():
    cfg = LLMConfig(mode="stub")
    assert _resolve_mode(cfg) == "stub"

def test_resolve_mode_explicit_live():
    cfg = LLMConfig(mode="live")
    assert _resolve_mode(cfg) == "live"

def test_resolve_mode_auto_with_key(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.delenv("CC_LIVE_LLM_MODE", raising=False)
    cfg = LLMConfig(mode="auto")
    assert _resolve_mode(cfg) == "live"

def test_resolve_mode_auto_without_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("CC_LIVE_LLM_MODE", raising=False)
    cfg = LLMConfig(mode="auto")
    assert _resolve_mode(cfg) == "stub"

def test_resolve_mode_env_override(monkeypatch):
    monkeypatch.setenv("CC_LIVE_LLM_MODE", "stub")
    cfg = LLMConfig(mode="live")
    assert _resolve_mode(cfg) == "stub"
