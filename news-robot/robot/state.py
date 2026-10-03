"""Состояние робота между прогонами.

Пока таблиц news_sources и записей «Новость» нет, состояние — локальный
JSON: условные заголовки лент, ошибки обхода и уже виденные адреса.
После миграции его заменят news_sources и import_items (WIKI/Новости.md).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class State:
    def __init__(self, path: Path):
        self.path = path
        self.data = {"feeds": {}, "seen": {}}
        if path.exists():
            self.data = json.loads(path.read_text(encoding="utf-8"))

    def feed(self, source_id: str) -> dict:
        return self.data["feeds"].setdefault(source_id, {"fail_count": 0})

    def ok(self, source_id: str, etag: str | None, modified: str | None, newest: str | None) -> None:
        f = self.feed(source_id)
        f.update(last_checked=now(), fail_count=0, last_error=None)
        if etag:
            f["etag"] = etag
        if modified:
            f["modified"] = modified
        if newest and (not f.get("last_item") or newest > f["last_item"]):
            f["last_item"] = newest

    def fail(self, source_id: str, error: str) -> int:
        f = self.feed(source_id)
        f.update(last_checked=now(), last_error=error, fail_count=f.get("fail_count", 0) + 1)
        return f["fail_count"]

    def seen(self, item_id: str) -> bool:
        return item_id in self.data["seen"]

    def mark(self, item_id: str, url: str, source_id: str) -> None:
        self.data["seen"].setdefault(item_id, {"url": url, "source": source_id, "first_seen": now()})

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(self.path)

    # ── Кандидаты в источники (robot/discover.py) ─────────────────────────

    def candidates(self) -> dict:
        return self.data.setdefault("candidates", {})

    def add_link_candidates(self, domains: list[dict]) -> int:
        """Домены из ссылок статей: новые — в кандидаты, известные — счёт растёт."""
        added = 0
        for d in domains:
            if d.get("known"):
                continue
            c = self.candidates().get(d["domain"])
            if c is None:
                c = self.candidates()[d["domain"]] = {
                    "domain": d["domain"], "count": 0, "kinds": {}, "examples": [],
                    "first_seen": now(), "status": "новый", "proposed_by": "robot"}
                added += 1
            c["count"] += d["count"]
            for k, v in d["kinds"].items():
                c["kinds"][k] = c["kinds"].get(k, 0) + v
            c["examples"] = (c["examples"] + d["examples"])[-6:]
            c["last_seen"] = now()
        return added

    def propose(self, url: str, domain: str, note: str | None = None) -> dict:
        """Редактор предлагает сайт сам: кандидат сразу идёт на пробу."""
        c = self.candidates().setdefault(domain, {
            "domain": domain, "count": 0, "kinds": {}, "examples": [], "first_seen": now()})
        c.update(url=url, proposed_by="editor", status="новый", note=note, probe=None, assessment=None)
        return c

    def candidates_pending(self) -> list[dict]:
        return [c for c in self.candidates().values() if c.get("status") == "новый"]

    def decide(self, domain: str, decision: str, source: dict | None = None, note: str | None = None) -> dict:
        c = self.candidates()[domain]
        c.update(status=decision, decided_at=now(), decision_note=note)
        if source is not None:
            added = self.data.setdefault("added_sources", [])
            added[:] = [s for s in added if s["id"] != source["id"]] + [source]
        return c

    def added_sources(self) -> list[dict]:
        return list(self.data.get("added_sources", []))
