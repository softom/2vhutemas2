"""Обучение ранжирования на выборе редактора (Р-93).

Редактор отмечает истории: «выпустил бы» / «нет» (страница робота, позже —
«В очередь» / «Отклонить»). Каждое решение хранится с признаками истории:
тема, вид, оценка LLM, число изданий, доверие, конкурс. Калибровка
делает две вещи:

1. Статистика без LLM — поправки ранжирования: для каждого вида и темы —
   насколько чаще или реже редактор их берёт, чем в среднем; вес повторения
   истории в разных изданиях — по тому, как растёт доля выбранных с числом
   изданий. Поправки ограничены, чтобы десяток решений не перевернул всё.
2. LLM — профиль вкуса редактора: что он берёт и что отсеивает, словами.
   Профиль подставляется в промпт отбора вместо общего описания и
   обновляется по мере новых решений; прежние версии сохраняются.

Мера качества — совпадение: из трёх лучших историй дня робота сколько
редактор выбрал. Она считается до и после калибровки.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from .llm import LLM, LLMError, prompt

MAX_ADJUST = 15          # поправка вида или темы — не больше ±15 баллов
MIN_GROUP = 4            # группа меньше — поправку не считаем
PRIOR = 6                # сглаживание к средней доле


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ── Повторение истории в разных изданиях ─────────────────────────────────────

def track_stories(state, candidates: list[dict], days: int = 7) -> None:
    """Копит издания каждой истории между прогонами: новость, которую через день
    подхватили ещё три издания, весит больше, чем в первом прогоне."""
    stories = state.data.setdefault("stories", {})
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    for key in [k for k, v in stories.items() if v.get("last_seen", "") < cutoff]:
        del stories[key]
    for c in candidates:
        st = stories.setdefault(c["story_key"], {"first_seen": now(), "sources": []})
        st["sources"] = sorted(set(st["sources"]) | {s["source"] for s in c["sources"]})
        st["last_seen"] = now()
        c["sources_total"] = len(st["sources"])


# ── Решения редактора ────────────────────────────────────────────────────────

def record(state, run_summary: dict | None, story_key: str, verdict: str, by: str | None, note: str | None) -> dict:
    """Решение по истории с её признаками (из итога прогона, где её показали)."""
    cand = next((c for c in (run_summary or {}).get("candidates", []) if c["story_key"] == story_key), {})
    j = {"story_key": story_key, "verdict": verdict, "by": by, "note": note, "at": now(),
         "title": cand.get("title_ru"), "topic": cand.get("topic"), "kind": cand.get("kind"),
         "interest": cand.get("interest"), "final": cand.get("final"),
         "sources": cand.get("sources_total") or len(cand.get("sources", [])) or None,
         "competition": cand.get("competition"), "students_eligible": cand.get("students_eligible"),
         "reason": cand.get("reason"), "run_id": (run_summary or {}).get("id")}
    judgments = state.data.setdefault("judgments", {})
    judgments[story_key] = j
    return j


def judgments(state) -> list[dict]:
    return list(state.data.get("judgments", {}).values())


# ── Калибровка: статистика ───────────────────────────────────────────────────

def _rate(items: list[dict]) -> float:
    return sum(1 for j in items if j["verdict"] == "yes") / len(items) if items else 0.0


def adjustments(items: list[dict]) -> dict:
    """Поправки ранжирования по решениям: вид, тема, вес повторения в изданиях."""
    scored = [j for j in items if j.get("kind") or j.get("topic")]
    base = _rate(scored)
    result: dict = {"base_rate": round(base, 3), "n": len(scored), "kind": {}, "topic": {}}
    for field in ("kind", "topic"):
        groups = defaultdict(list)
        for j in scored:
            if j.get(field):
                groups[j[field]].append(j)
        for name, group in groups.items():
            if len(group) < MIN_GROUP:
                continue
            # Сглаженная доля: маленькая группа тянется к средней.
            smoothed = (sum(1 for j in group if j["verdict"] == "yes") + PRIOR * base) / (len(group) + PRIOR)
            result[field][name] = max(-MAX_ADJUST, min(MAX_ADJUST, round((smoothed - base) * 60)))
    by_sources = defaultdict(list)
    for j in scored:
        if j.get("sources"):
            by_sources[min(int(j["sources"]), 4)].append(j)
    one, many = by_sources.get(1, []), [j for k, v in by_sources.items() if k >= 2 for j in v]
    if len(one) >= MIN_GROUP and len(many) >= MIN_GROUP:
        # Насколько повторение в нескольких изданиях повышает долю выбранных — в баллы на издание.
        lift = _rate(many) - _rate(one)
        result["per_extra_source"] = max(0, min(10, round(4 + lift * 20)))
    return result


def agreement(items: list[dict], top: int = 3) -> dict:
    """Совпадение с редактором: из top лучших историй каждого прогона — сколько выбрано."""
    by_run = defaultdict(list)
    for j in items:
        if j.get("run_id") and j.get("final") is not None:
            by_run[j["run_id"]].append(j)
    hits = total = 0
    for group in by_run.values():
        best = sorted(group, key=lambda j: j["final"], reverse=True)[:top]
        hits += sum(1 for j in best if j["verdict"] == "yes")
        total += len(best)
    yes = [j for j in items if j["verdict"] == "yes"]
    return {"top": top, "runs": len(by_run), "hits": hits, "total": total,
            "precision": round(hits / total, 3) if total else None, "chosen": len(yes), "judged": len(items)}


# ── Калибровка: профиль вкуса через LLM ──────────────────────────────────────

def profile(llm: LLM, items: list[dict], seed: dict, current: str | None) -> dict:
    lines = []
    for j in sorted(items, key=lambda j: j["at"])[-120:]:
        lines.append({"выбор": "ДА" if j["verdict"] == "yes" else "НЕТ", "заголовок": j.get("title") or j["story_key"],
                      "тема": j.get("topic"), "вид": j.get("kind"), "изданий": j.get("sources"),
                      "оценка робота": j.get("interest"), "пояснение редактора": j.get("note")})
    for t in seed.get("chosen", []):
        lines.append({"выбор": "ДА", "заголовок": t, "из": "первый блок"})
    for t in seed.get("rejected", []):
        lines.append({"выбор": "НЕТ", "заголовок": t, "из": "первый блок"})
    return llm.chat_json("calibrate", prompt("calibrate", current=current or "—",
                                             decisions=json.dumps(lines, ensure_ascii=False, indent=1)),
                         "Опиши вкус редактора.", max_tokens=2000)


def calibrate(state, llm: LLM | None, seed: dict, log, force: bool = False, min_new: int = 15) -> dict | None:
    """Пересчитать поправки и профиль, если накопилось min_new новых решений (или force)."""
    items = judgments(state)
    learned = state.data.setdefault("learned", {"history": []})
    new = len(items) - learned.get("judged_at_calibration", 0)
    if not force and new < min_new:
        return None
    before = agreement(items)
    adj = adjustments(items)
    entry = {"at": now(), "judged": len(items), "adjustments": adj, "agreement": before}
    if llm is not None and llm.live:
        try:
            prof = profile(llm, items, seed, learned.get("profile_text"))
            entry["profile"] = prof
            learned["profile_text"] = prof.get("profile_text")
            learned["profile"] = prof
        except LLMError as e:
            log("warn", "learn", "профиль не обновлён", error=str(e))
    learned["adjustments"] = adj
    learned["judged_at_calibration"] = len(items)
    learned["history"] = (learned["history"] + [entry])[-30:]
    log("info", "learn", "калибровка", judged=len(items), precision=before["precision"],
        kinds=len(adj["kind"]), topics=len(adj["topic"]))
    return entry


def apply(c: dict, learned: dict) -> int:
    """Поправка к оценке истории по выученному: вид и тема."""
    adj = learned.get("adjustments") or {}
    return int((adj.get("kind") or {}).get(c.get("kind"), 0)) + int((adj.get("topic") or {}).get(c.get("topic"), 0))
