"""Load :class:`~agents.shared.llm_client.LLMConfig` from YAML config files.

Resolution order: ``config/llm.local.yaml`` (gitignored, holds real keys) →
``config/llm.yaml`` (tracked, provider/model templates) → ``LLMConfig()``
defaults (OpenAI). This is the single place the LLM provider/model/key are
configured, so agents just call :func:`load_llm_config` instead of hard-coding
OpenAI defaults.
"""

from __future__ import annotations

import logging
from pathlib import Path

import yaml

from agents.shared.llm_client import LLMConfig

logger = logging.getLogger(__name__)

_CONFIG_DIR = Path(__file__).resolve().parents[2] / "config"
_CONFIG_FILES = ("llm.local.yaml", "llm.yaml")


def load_llm_config(explicit_model: str | None = None) -> LLMConfig:
    """Build an LLMConfig from the first available YAML config file.

    Args:
        explicit_model: Override the selected model (provider/base_url/key still
            come from the config). ``None`` uses the config's ``default.model``.
    """
    for name in _CONFIG_FILES:
        path = _CONFIG_DIR / name
        if not path.exists():
            continue
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError as e:
            logger.warning("Failed to parse %s: %s", path, e)
            continue
        return _build(data, explicit_model)
    return LLMConfig()  # fallback: OpenAI defaults


def _build(data: dict, explicit_model: str | None) -> LLMConfig:
    default = data.get("default") or {}
    providers = data.get("providers") or {}

    provider_name = default.get("provider") or (next(iter(providers)) if providers else "openai")
    provider = providers.get(provider_name) or {}

    base_url = provider.get("base_url", "https://api.openai.com/v1")
    api_key_env = provider.get("api_key_env", "OPENAI_API_KEY")
    api_key = provider.get("api_key", "")

    models = provider.get("models") or []
    model_name = explicit_model or default.get("model")
    if not model_name and models:
        model_name = models[0].get("name")
    model_name = model_name or "gpt-4o"

    max_tokens = 4096
    for m in models:
        if m.get("name") == model_name:
            max_tokens = int(m.get("max_tokens", max_tokens))
            break

    return LLMConfig(
        provider=provider_name,
        model=model_name,
        base_url=base_url,
        api_key=api_key,
        api_key_env=api_key_env,
        max_tokens=max_tokens,
    )
