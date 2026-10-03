"""Клиент LLM: OpenAI-совместимый API (Polza.AI, Р-88).

Адрес, модель и имя переменной ключа — из настроек; ключ — только из
окружения. Без ключа клиент не ходит в сеть, а складывает готовые запросы
в папку прогона: их можно отправить вручную и сверить промпты.
Ответ обязан быть JSON; ответ, который не разобрался, — ошибка этапа,
а не черновик.
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path

import httpx

PROMPTS = Path(__file__).resolve().parent.parent / "prompts"


class NoLLM(Exception):
    """Ключа нет: запрос сохранён, ответа не будет."""


class LLMError(Exception):
    pass


def prompt(name: str, **values: str) -> str:
    text = (PROMPTS / f"{name}.md").read_text(encoding="utf-8")
    for key, value in values.items():
        text = text.replace("{{" + key + "}}", value)
    return text


class LLM:
    def __init__(self, base_url: str, model: str | None, key_env: str, dump_dir: Path,
                 token_limit: int, temperature: float = 0.2, extra: dict | None = None):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.key = os.environ.get(key_env) or None
        self.dump_dir = dump_dir
        self.token_limit = token_limit
        self.temperature = temperature
        # Дополнительные поля запроса: у рассуждающих моделей (DeepSeek v4) — управление
        # рассуждением, {"reasoning": {"enabled": false}} или {"reasoning": {"effort": "low"}}.
        self.extra = extra or {}
        self.used = {"prompt": 0, "completion": 0, "calls": 0}
        self._n = 0
        self.client = httpx.Client(timeout=180)

    @property
    def live(self) -> bool:
        return bool(self.key and self.model)

    def chat_json(self, stage: str, system: str, user: str, max_tokens: int = 4000) -> dict:
        self._n += 1
        body = {
            "model": self.model or "<модель не выбрана: news.llm.model>",
            "temperature": self.temperature,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            **self.extra,
        }
        self.dump_dir.mkdir(parents=True, exist_ok=True)
        stem = f"{self._n:03d}-{stage}"
        (self.dump_dir / f"{stem}.request.json").write_text(
            json.dumps(body, ensure_ascii=False, indent=1), encoding="utf-8")
        if not self.live:
            raise NoLLM(stage)
        if self.used["prompt"] + self.used["completion"] >= self.token_limit:
            raise LLMError(f"исчерпан предел токенов прогона ({self.token_limit})")
        data = self._post(body)
        usage = data.get("usage") or {}
        self.used["prompt"] += usage.get("prompt_tokens", 0)
        self.used["completion"] += usage.get("completion_tokens", 0)
        self.used["calls"] += 1
        choice = data["choices"][0]
        content = choice["message"].get("content") or ""
        (self.dump_dir / f"{stem}.response.json").write_text(content, encoding="utf-8")
        if choice.get("finish_reason") == "length":
            reasoning = ((usage.get("completion_tokens_details") or {}).get("reasoning_tokens")) or 0
            raise LLMError(f"ответ обрезан на {max_tokens} токенах (из них рассуждение {reasoning}) — "
                           "поднять max_tokens или ограничить рассуждение (news.llm.reasoning)")
        return parse_json(content)

    def _post(self, body: dict) -> dict:
        delay = 5.0
        for attempt in range(4):
            try:
                r = self.client.post(f"{self.base_url}/chat/completions", json=body,
                                     headers={"Authorization": f"Bearer {self.key}"})
            except httpx.HTTPError as e:
                err = f"сеть: {type(e).__name__}"
            else:
                if r.status_code == 200:
                    return r.json()
                err = f"HTTP {r.status_code}: {r.text[:300]}"
                if r.status_code not in (408, 429, 500, 502, 503, 504):
                    raise LLMError(err)
            if attempt < 3:
                time.sleep(delay)
                delay *= 2
        raise LLMError(err)


def parse_json(content: str) -> dict:
    text = content.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fenced:
        text = fenced.group(1)
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < start:
        raise LLMError("ответ не JSON")
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError as e:
        raise LLMError(f"ответ не JSON: {e}") from e
