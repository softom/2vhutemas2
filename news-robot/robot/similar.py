"""Повторы историй и сверка с сайтом (Р-115).

Решение пользователя 2026-10-12: «в списке на просмотр стали попадаться дубли
новостей с других источников… надо проверять на повтор и на темы уже на нашем
сайте». Ключ истории (story_key) придумывает LLM отбора, и в разных прогонах и
пачках одна история получает разные ключи. Здесь истории сравниваются по
смыслу:

1. unify — между собой. Заголовок истории превращается в вектор (та же модель,
   что у поиска сайта, Polza.AI /embeddings); близкая к уже известной история
   получает её ключ. Сходство от `hi` — повтор без вопросов, от `lo` до `hi` —
   решает LLM («одно ли это событие»), ниже — разные истории.
2. site — с сайтом, через его поиск (GET /search, Р-109): есть ли уже такая
   новость и какие записи сайта близки по теме.

Пороги выверены на 457 историях 3–11 октября 2026 (WIKI, раздел Р-115).
Векторы — .state/story_vectors.json; итог для страницы — .state/similar.json.
Сбой модели или поиска прогон не останавливает: истории остаются как были.
"""

from __future__ import annotations

import json
import math
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

from .llm import LLMError, prompt

DEFAULTS = {
    "model": "openai/text-embedding-3-large",
    "dimensions": 512,
    "same": 0.90,          # от этого сходства — та же история
    "maybe": 0.75,         # от этого — спросить LLM
    "window_days": 21,     # сколько помнить истории
    "site_same": 0.78,     # новость сайта с таким сходством — уже вышла
    "site_maybe": 0.68,    # спросить LLM
    "site_related": 0.58,  # запись сайта близка по теме
    "site_min_final": 40,  # сверять с сайтом истории не ниже этой оценки
    "site_limit": 60,      # и не больше стольких за раз
}


def settings(cfg: dict) -> dict:
    return {k: (cfg.get(f"news.similar.{k}") if cfg.get(f"news.similar.{k}") is not None else v)
            for k, v in DEFAULTS.items()}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _read(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _write(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def embed(texts: list[str], cfg: dict, s: dict) -> list[list[float]]:
    """Единичные векторы текстов; косинус двух таких — просто скалярное произведение."""
    base = (cfg.get("news.llm.base_url") or "https://api.polza.ai/api/v1").rstrip("/")
    key = os.environ.get(cfg.get("news.llm.api_key_env") or "POLZA_API_KEY")
    if not key:
        raise LLMError("нет ключа модели — векторы не посчитать")
    out: list[list[float]] = []
    for i in range(0, len(texts), 64):
        r = httpx.post(f"{base}/embeddings", headers={"Authorization": f"Bearer {key}"}, timeout=120,
                       json={"model": s["model"], "input": texts[i:i + 64], "dimensions": s["dimensions"]})
        if r.status_code >= 400:
            raise LLMError(f"embeddings HTTP {r.status_code}: {r.text[:200]}")
        for d in sorted(r.json()["data"], key=lambda d: d["index"]):
            v = d["embedding"]
            n = math.sqrt(sum(x * x for x in v)) or 1.0
            out.append([round(x / n, 5) for x in v])
    return out


def cos(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def same_event(llm, pairs: list[tuple[str, str]], log) -> list[bool]:
    """LLM решает спорные пары: одно ли это событие. Без LLM или при сбое — «нет»: не склеиваем."""
    if not pairs:
        return []
    if not llm or not llm.live:
        return [False] * len(pairs)
    verdicts = [False] * len(pairs)
    for i in range(0, len(pairs), 40):
        part = pairs[i:i + 40]
        payload = [{"n": n, "a": a, "b": b} for n, (a, b) in enumerate(part)]
        try:
            res = llm.chat_json("similar", prompt("similar"), json.dumps(payload, ensure_ascii=False, indent=1),
                                max_tokens=4000)
        except Exception as e:  # noqa: BLE001 — спорные пары остаются разными историями
            log("warn", "similar", "спорные пары не проверены", error=str(e)[:150])
            continue
        for rec in res.get("pairs", []):
            n = rec.get("n")
            if isinstance(n, int) and 0 <= n < len(part):
                verdicts[i + n] = bool(rec.get("same"))
    return verdicts


def _store(root: Path, s: dict) -> dict:
    store = _read(root / ".state" / "story_vectors.json", {})
    if store.get("model") != s["model"] or store.get("dimensions") != s["dimensions"]:
        store = {"model": s["model"], "dimensions": s["dimensions"], "stories": {}}
    cutoff = (datetime.now(timezone.utc) - timedelta(days=s["window_days"])).isoformat()
    store["stories"] = {k: v for k, v in store["stories"].items() if v.get("last_seen", "") >= cutoff}
    return store


def match(new: list[dict], root: Path, cfg: dict, llm, log) -> dict[str, dict]:
    """Истории [{key, title, text}] → {ключ: {to, similarity, title, by}} для повторов.

    Порядок списка важен: первая из одинаковых остаётся главной, поэтому старые идут раньше.
    """
    s = settings(cfg)
    store = _store(root, s)
    known = store["stories"]
    # Уже решённый повтор второй раз не проверяем: решение LLM по спорной паре не должно меняться от прогона к прогону.
    prior = _read(root / ".state" / "similar.json", {}).get("aliases", {})
    fresh = [n for n in new if n["key"] not in known and n["key"] not in prior]
    for n in new:
        if n["key"] in known:
            known[n["key"]]["last_seen"] = now()
    aliases: dict[str, dict] = {n["key"]: prior[n["key"]] for n in new if n["key"] in prior and n["key"] not in known}
    if not fresh:
        _write(root / ".state" / "story_vectors.json", store)
        return aliases
    vecs = embed([n["text"] for n in fresh], cfg, s)
    grey: list[tuple[dict, str, float]] = []
    pool = {k: v["vec"] for k, v in known.items()}
    titles = {k: v.get("title", "") for k, v in known.items()}
    pending: list[tuple[dict, list[float]]] = []
    for n, vec in zip(fresh, vecs):
        best_key, best = None, 0.0
        for k, v in pool.items():
            c = cos(vec, v)
            if c > best:
                best_key, best = k, c
        if best_key and best >= s["same"]:
            aliases[n["key"]] = {"to": best_key, "similarity": round(best, 3), "title": n["title"], "by": "вектор"}
            continue
        if best_key and best >= s["maybe"]:
            grey.append((n, best_key, best))
        # Спорная история остаётся в сравнении: следующая может повторять именно её.
        pool[n["key"]] = vec
        titles[n["key"]] = n["title"]
        pending.append((n, vec))
    for (n, to, sim), same in zip(grey, same_event(llm, [(n["title"], titles[to]) for n, to, _ in grey], log)):
        if same:
            aliases[n["key"]] = {"to": to, "similarity": round(sim, 3), "title": n["title"], "by": "LLM"}
    # Цепочки (А → Б, Б → В) сводим к главной истории.
    for key, a in aliases.items():
        seen = {key}
        while a["to"] in aliases and a["to"] not in seen:
            seen.add(a["to"])
            a["to"] = aliases[a["to"]]["to"]
    for n, vec in pending:
        if n["key"] not in aliases:
            known[n["key"]] = {"title": n["title"], "vec": vec, "first_seen": now(), "last_seen": now()}
    for a in aliases.values():
        if a["to"] in known:
            known[a["to"]]["last_seen"] = now()
    _write(root / ".state" / "story_vectors.json", store)
    return aliases


def _note(root: Path, aliases: dict[str, dict] | None = None, site: dict[str, dict] | None = None) -> None:
    data = _read(root / ".state" / "similar.json", {})
    data.setdefault("aliases", {}).update(aliases or {})
    data.setdefault("site", {}).update(site or {})
    data["updated_at"] = now()
    _write(root / ".state" / "similar.json", data)


def unify(scores: dict[str, dict], items: list, root: Path, cfg: dict, llm, log) -> int:
    """Перед ранжированием: повторы известных историй получают их ключ (и сливаются между собой)."""
    by_id = {i.id: i for i in items}
    stories: dict[str, dict] = {}
    for item_id, sc in scores.items():
        if not sc.get("relevant") or item_id not in by_id:
            continue
        key = sc.get("story_key") or item_id
        st = stories.get(key)
        if st is None or (sc.get("interest") or 0) > st["interest"]:
            title = sc.get("title_ru") or by_id[item_id].title
            stories[key] = {"key": key, "title": title, "interest": sc.get("interest") or 0,
                            "text": f"{title}. {by_id[item_id].title}"}
    try:
        aliases = match(list(stories.values()), root, cfg, llm, log)
    except Exception as e:  # noqa: BLE001 — без проверки повторов прогон идёт как раньше
        log("warn", "similar", "повторы не проверены", error=f"{type(e).__name__}: {e}"[:200])
        return 0
    for sc in scores.values():
        key = sc.get("story_key")
        if key in aliases:
            sc["repeat_of"], sc["story_key"] = key, aliases[key]["to"]
    _note(root, aliases=aliases)
    log("info", "similar", "повторы историй", stories=len(stories), repeats=len(aliases),
        by_llm=sum(1 for a in aliases.values() if a["by"] == "LLM"))
    return len(aliases)


def _own_entities(root: Path) -> dict[str, str]:
    """Запись сайта → история робота: своя же новость — не повтор."""
    own = {}
    for p in (root / ".state" / "prepared").glob("*.json"):
        rec = _read(p, {})
        if rec.get("entity_id"):
            own[str(rec["entity_id"])] = rec.get("story_key", "")
    return own


def site(cands: list[dict], root: Path, cfg: dict, api, llm, log) -> dict[str, dict]:
    """Сверка историй с сайтом: {ключ: {news: уже вышедшая новость | None, related: [близкие записи]}}."""
    s = settings(cfg)
    if not api or not api.live:
        return {}
    own = _own_entities(root)
    picked = [c for c in cands if c.get("final", 0) >= s["site_min_final"]][:s["site_limit"]]
    found: dict[str, dict] = {}
    grey: list[tuple[str, dict]] = []
    for c in picked:
        try:
            res = api.call("GET", "/search", params={"q": (c.get("title_ru") or "")[:300], "limit": 8})
        except Exception as e:  # noqa: BLE001
            log("warn", "similar", "поиск сайта не ответил", error=str(e)[:150])
            break
        rec = {"news": None, "related": [], "checked_at": now()}
        for it in res.get("items", []):
            sim = it.get("similarity")
            if sim is None or own.get(str(it["id"])) == c["story_key"]:
                continue
            hit = {"id": it["id"], "slug": it.get("slug"), "title": it.get("title_ru"), "type": it.get("type"),
                   "type_title": it.get("type_title"), "status": it.get("status"), "similarity": round(float(sim), 3),
                   "story_key": own.get(str(it["id"])) or None}
            if it.get("type") == "news" and rec["news"] is None and hit["similarity"] >= s["site_same"]:
                rec["news"] = hit
            elif it.get("type") == "news" and rec["news"] is None and hit["similarity"] >= s["site_maybe"]:
                grey.append((c["story_key"], hit))
                rec["related"].append(hit)
            elif hit["similarity"] >= s["site_related"]:
                rec["related"].append(hit)
        rec["related"] = sorted(rec["related"], key=lambda h: -h["similarity"])[:4]
        found[c["story_key"]] = rec
    titles = {c["story_key"]: c.get("title_ru") or "" for c in picked}
    for (key, hit), same in zip(grey, same_event(llm, [(titles[k], h["title"] or "") for k, h in grey], log)):
        if same and found[key]["news"] is None:
            found[key]["news"] = {**hit, "by": "LLM"}
            found[key]["related"] = [h for h in found[key]["related"] if h["id"] != hit["id"]]
    for c in cands:
        if c["story_key"] in found:
            c["site"] = found[c["story_key"]]
    _note(root, site=found)
    log("info", "similar", "сверка с сайтом", checked=len(found),
        on_site=sum(1 for f in found.values() if f["news"]), related=sum(1 for f in found.values() if f["related"]))
    return found


def backfill(root: Path, cfg: dict, api, llm, log, days: int = 14) -> dict:
    """Разовый проход по уже собранным прогонам: повторы среди историй и сверка с сайтом."""
    cutoff = datetime.now() - timedelta(days=days)
    stories: dict[str, dict] = {}
    for d in sorted((root / "out").glob("2026*")):
        try:
            if datetime.strptime(d.name, "%Y%m%d-%H%M%S") < cutoff:
                continue
        except ValueError:
            continue
        summary = _read(d / "summary.json", {})
        for c in summary.get("candidates") or _read(d / "candidates.json", []) or []:
            if c["story_key"] not in stories:
                first = (c.get("sources") or [{}])[0]
                stories[c["story_key"]] = {**c, "key": c["story_key"], "title": c.get("title_ru") or "",
                                           "text": f"{c.get('title_ru') or ''}. {first.get('title') or ''}"}
    aliases = match(list(stories.values()), root, cfg, llm, log)
    _note(root, aliases=aliases)
    log("info", "similar", "повторы в прошлых прогонах", stories=len(stories), repeats=len(aliases))
    main = sorted((c for k, c in stories.items() if k not in aliases), key=lambda c: -(c.get("final") or 0))
    found = site(main, root, cfg, api, llm, log)
    return {"stories": len(stories), "repeats": len(aliases), "site_checked": len(found),
            "on_site": sum(1 for f in found.values() if f["news"])}
