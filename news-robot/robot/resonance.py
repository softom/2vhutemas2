"""Линия «Резонанс» (Р-118, Р-119): кто ещё написал об истории и что к ней добавил.

Решение пользователя 2026-10-13: «по нескольким маркерам новости найти круг
сайтов, которые сделали публикацию… увидеть, какие новости быстро охватывают
интернет и какие оттенки они собирают. Это шанс не повторять чужие новости, а
дать анализ и тренд». Сбор нужен, чтобы «Мнение редакции» было острым.

Карточка истории — .state/resonance/<ключ>.json:
1. search — поисковые модели (Perplexity Sonar через Polza.AI) по маркерам
   называют публикации: издание, адрес, дата, угол.
2. verify — робот открывает каждую страницу сам (robots.txt соблюдается):
   адрес и дата из ответа модели — заявка, а не факт. Страница без маркеров
   истории — «не о том».
3. shades — LLM сводит проверенные публикации в оттенки (что добавилось к
   первой версии) и вопросы для мнения редакции.
4. Издания круга, которых нет в обходе, копятся в index.json; встретившееся в
   двух историях предлагается в «Рекомендации» (через ящик, решает редактор).

Запросы со страницы — inbox/resonance/*.json; карточка обновляется раз в сутки,
пока ей меньше недели. Состояние робота линия не меняет.
"""

from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from bs4 import BeautifulSoup

from .article import html_text
from .fetch import Fetcher
from .llm import _note_call, parse_json, prompt

DEFAULTS = {
    "models": ["perplexity/sonar", "perplexity/sonar-pro"],  # круги у моделей почти не пересекаются (замер 2026-10-13)
    "days": 7,              # сколько дней следить за историей
    "every_hours": 20,      # не чаще одного поиска в сутки
    "verify_per_run": 12,   # страниц за одно минутное задание
    "propose_after": 2,     # в скольких историях должно встретиться издание, чтобы пойти в «Рекомендации»
}
# Не издания: сам проект, хранилища кода, соцсети и агрегаторы ссылок.
NOT_OUTLETS = ("github.com", "reddit.com", "x.com", "twitter.com", "youtube.com", "youtu.be", "linkedin.com",
               "facebook.com", "t.me", "news.ycombinator.com", "ground.news", "medium.com")
KEY = re.compile(r"^[a-z0-9][a-z0-9-]{0,99}$")


def settings(cfg: dict) -> dict:
    return {k: (cfg.get(f"news.resonance.{k}") if cfg.get(f"news.resonance.{k}") is not None else v)
            for k, v in DEFAULTS.items()}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _read(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _write(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)


def domain_of(url: str) -> str:
    return urlsplit(url).netloc.lower().removeprefix("www.")


def _norm(url: str) -> str:
    p = urlsplit(url.strip())
    return f"{p.netloc.lower().removeprefix('www.')}{p.path.rstrip('/')}"


# ── 1. Поиск круга ───────────────────────────────────────────────────────────

def search(card: dict, cfg: dict, s: dict, log) -> int:
    """Спрашивает поисковые модели, кто написал об истории. Возвращает число новых публикаций."""
    key = os.environ.get(cfg.get("news.llm.api_key_env") or "POLZA_API_KEY")
    base = (cfg.get("news.llm.base_url") or "https://api.polza.ai/api/v1").rstrip("/")
    if not key:
        raise RuntimeError("нет ключа Polza.AI")
    known = {_norm(p["url"]) for p in card["publications"]}
    ask = prompt("resonance_search", title=card["title"], markers=", ".join(card["markers"]),
                 known="\n".join(sorted({p["domain"] for p in card["publications"]})) or "—")
    added = 0
    for model in s["models"]:
        started = time.time()
        note = {"ts": now(), "stage": "resonance", "model": model, "where": "resonance"}
        try:
            r = httpx.post(f"{base}/chat/completions", headers={"Authorization": f"Bearer {key}"}, timeout=180,
                           json={"model": model, "messages": [{"role": "user", "content": ask}],
                                 "max_tokens": 4000, "temperature": 0.1})
            r.raise_for_status()
            data = r.json()
            found = parse_json(data["choices"][0]["message"].get("content") or "").get("publications") or []
        except Exception as e:  # noqa: BLE001 — одна модель не ответила: остаются другие
            _note_call({**note, "ok": False, "error": str(e)[:200], "ms": int((time.time() - started) * 1000)})
            log("warn", "resonance", "поиск не ответил", story=card["key"], model=model, error=str(e)[:150])
            card["searches"].append({"at": now(), "model": model, "error": str(e)[:150]})
            continue
        usage = data.get("usage") or {}
        _note_call({**note, "ok": True, "ms": int((time.time() - started) * 1000),
                    "prompt_tokens": usage.get("prompt_tokens", 0), "completion_tokens": usage.get("completion_tokens", 0)})
        new = 0
        for f in found:
            url = str(f.get("url") or "").strip()
            if not url.startswith("http") or _norm(url) in known:
                continue
            known.add(_norm(url))
            card["publications"].append({
                "url": url, "domain": domain_of(url), "outlet": str(f.get("outlet") or domain_of(url))[:80],
                "claimed_date": (str(f.get("date"))[:10] if f.get("date") else None), "date": None,
                "lang": str(f.get("lang") or "")[:5] or None, "angle": str(f.get("angle") or "")[:400],
                "found_by": model, "found_at": now(), "check": "не проверена"})
            new += 1
        added += new
        card["searches"].append({"at": now(), "model": model, "named": len(found), "new": new,
                                 "cost_rub": usage.get("cost_rub")})
        log("info", "resonance", "поиск круга", story=card["key"], model=model, named=len(found), new=new,
            cost_rub=usage.get("cost_rub"))
    card["searched_at"] = now()
    return added


# ── 2. Проверка страниц ──────────────────────────────────────────────────────

def _meta(soup: BeautifulSoup, *props: str) -> str | None:
    for prop in props:
        m = soup.find("meta", attrs={"property": prop}) or soup.find("meta", attrs={"name": prop})
        if m and m.get("content"):
            return m["content"]
    return None


def _page_date(soup: BeautifulSoup) -> str | None:
    raw = _meta(soup, "article:published_time", "og:article:published_time", "datePublished", "date", "pubdate")
    if not raw:
        for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
            m = re.search(r'"datePublished"\s*:\s*"([^"]+)"', tag.string or "")
            if m:
                raw = m.group(1)
                break
    if not raw:
        t = soup.find("time", attrs={"datetime": True})
        raw = t["datetime"] if t else None
    m = re.match(r"(\d{4}-\d{2}-\d{2})", raw or "")
    return m.group(1) if m else None


def verify(card: dict, fetcher: Fetcher, limit: int, log) -> int:
    """Открывает непроверенные страницы: есть ли там история, заголовок, дата со страницы."""
    markers = [m.lower() for m in card["markers"] if len(m) >= 4]
    done = 0
    for p in card["publications"]:
        if p["check"] != "не проверена" or done >= limit:
            continue
        done += 1
        p["checked_at"] = now()
        if p["domain"].endswith(NOT_OUTLETS):
            p["check"] = "не издание"
            continue
        try:
            r = fetcher.get(p["url"])
        except Exception as e:  # noqa: BLE001 — запрет robots.txt, защита от ботов, 404: говорим как есть
            p["check"] = f"не открылась: {str(e)[:120]}"
            continue
        html = r.content.decode("utf-8", "replace")
        soup = BeautifulSoup(html, "lxml")
        text = html_text(html).lower()
        hits = [m for m in markers if m in text]
        p["title"] = (_meta(soup, "og:title") or (soup.title.get_text(strip=True) if soup.title else ""))[:200]
        p["date"] = _page_date(soup)
        p["words"] = len(text.split())
        p["excerpt"] = (_meta(soup, "og:description", "description") or "")[:500]
        # Одного маркера мало: название продукта встречается и в чужих списках ссылок.
        p["check"] = "открыта" if len(hits) >= min(2, len(markers)) else "не о том"
    if done:
        log("info", "resonance", "страницы проверены", story=card["key"], checked=done,
            ok=sum(1 for p in card["publications"] if p["check"] == "открыта"))
    return done


# ── 3. Оттенки ───────────────────────────────────────────────────────────────

def shades(card: dict, llm, log) -> None:
    pubs = [p for p in card["publications"] if p["check"] == "открыта"]
    if len(pubs) < 3 or not getattr(llm, "live", False):
        return
    listing = [{"n": i, "outlet": p["outlet"], "date": p.get("date") or p.get("claimed_date"), "lang": p.get("lang"),
                "title": p.get("title"), "angle": p.get("angle"), "excerpt": p.get("excerpt")} for i, p in enumerate(pubs)]
    try:
        res = llm.chat_json("resonance", prompt("resonance_shades", title=card["title"], ours=card.get("ours") or "—",
                                                publications=json.dumps(listing, ensure_ascii=False, indent=1)),
                            "Сведи публикации.", max_tokens=6000)
    except Exception as e:  # noqa: BLE001
        log("warn", "resonance", "оттенки не сведены", story=card["key"], error=str(e)[:150])
        return
    for sh in res.get("shades") or []:
        sh["outlets"] = [pubs[n]["outlet"] for n in sh.pop("n", []) if isinstance(n, int) and 0 <= n < len(pubs)]
    card["shades"] = {"at": now(), "by": len(pubs), "shades": res.get("shades") or [],
                      "questions": res.get("questions") or [], "summary": res.get("summary")}


# ── Сводка карточки, издания круга ───────────────────────────────────────────

def _summarize(card: dict) -> None:
    ok = [p for p in card["publications"] if p["check"] == "открыта"]
    by_day: dict[str, int] = {}
    for p in ok:
        day = p.get("date") or p.get("claimed_date") or "без даты"
        by_day[day] = by_day.get(day, 0) + 1
    card["reach"] = {"outlets": len({p["domain"] for p in ok}), "by_day": dict(sorted(by_day.items())),
                     "langs": sorted({p["lang"] for p in ok if p.get("lang")}),
                     "unchecked": sum(1 for p in card["publications"] if p["check"] == "не проверена")}


def _known_domains(root: Path) -> set[str]:
    rows = _read(root / ".state" / "sources.json", []) or []
    return {domain_of(r.get("site") or r.get("feed") or "") for r in rows if isinstance(r, dict)} - {""}


def circle(root: Path, s: dict, log) -> None:
    """Издания круга по всем карточкам; встретившееся в нескольких историях — в «Рекомендации»."""
    rdir = root / ".state" / "resonance"
    known = _known_domains(root)
    index = _read(rdir / "index.json", {}) or {}
    proposed = set(index.get("proposed") or [])
    outlets: dict[str, dict] = {}
    for path in rdir.glob("*.json"):
        if path.name == "index.json":
            continue
        card = _read(path, {}) or {}
        for p in card.get("publications") or []:
            if p.get("check") != "открыта":
                continue
            o = outlets.setdefault(p["domain"], {"domain": p["domain"], "outlet": p["outlet"], "stories": [],
                                                 "in_sources": p["domain"] in known})
            if card["key"] not in o["stories"]:
                o["stories"].append(card["key"])
    for o in outlets.values():
        if len(o["stories"]) >= s["propose_after"] and not o["in_sources"] and o["domain"] not in proposed:
            line = {"action": "propose", "url": f"https://{o['domain']}/", "by": "Робот: линия «Резонанс»", "ts": now(),
                    "note": f"В круге {len(o['stories'])} историй: {', '.join(o['stories'][:4])}"}
            with open(root / "inbox" / "inbox.jsonl", "a", encoding="utf-8") as f:
                f.write(json.dumps(line, ensure_ascii=False) + "\n")
            proposed.add(o["domain"])
            log("info", "resonance", "издание круга предложено в источники", domain=o["domain"], stories=len(o["stories"]))
    _write(rdir / "index.json", {"updated_at": now(), "proposed": sorted(proposed),
                                 "outlets": sorted(outlets.values(), key=lambda o: (-len(o["stories"]), o["domain"]))})


# ── Запросы и суточное обновление ────────────────────────────────────────────

def _ours(root: Path, story_key: str | None) -> str | None:
    """Наша версия истории — чтобы оттенки считались от неё."""
    rec = _read(root / ".state" / "prepared" / f"{story_key}.json", {}) if story_key else None
    news = ((rec or {}).get("story") or {}).get("news") or {}
    if not news:
        return None
    return "\n".join([news.get("title") or "", news.get("lead") or "", *(news.get("paragraphs") or [])])[:6000]


def run(root: Path, cfg: dict, llm, log) -> int:
    s = settings(cfg)
    rdir = root / ".state" / "resonance"
    idir = root / "inbox" / "resonance"
    touched = 0
    for req_path in sorted(idir.glob("*.json")) if idir.exists() else []:
        req = _read(req_path, {}) or {}
        req_path.unlink(missing_ok=True)
        key = str(req.get("key") or "")
        if not KEY.match(key):
            continue
        path = rdir / f"{key}.json"
        card = _read(path)
        if req.get("action") == "open" and card is None:
            markers = [str(m).strip()[:60] for m in req.get("markers") or [] if str(m).strip()][:8]
            if not markers:
                continue
            card = {"key": key, "title": str(req.get("title") or key)[:200], "markers": markers,
                    "story_key": req.get("story_key") or None, "opened_at": now(), "opened_by": req.get("by"),
                    "status": "идёт", "publications": [], "searches": [], "searched_at": None}
            log("info", "resonance", "карточка открыта", story=key, markers=len(markers))
        elif card is None:
            continue
        elif req.get("action") == "refresh":
            card["searched_at"] = None
            card["status"] = "идёт"
        elif req.get("action") == "close":
            card["status"] = "закрыта"
        _write(path, card)
    fetcher = None
    for path in sorted(rdir.glob("*.json")) if rdir.exists() else []:
        if path.name == "index.json":
            continue
        card = _read(path, {}) or {}
        if card.get("status") != "идёт":
            continue
        changed = False
        age = datetime.now(timezone.utc) - datetime.fromisoformat(card["opened_at"])
        last = card.get("searched_at")
        due = last is None or datetime.now(timezone.utc) - datetime.fromisoformat(last) > timedelta(hours=s["every_hours"])
        if due and age <= timedelta(days=s["days"]):
            try:
                search(card, cfg, s, log)
            except Exception as e:  # noqa: BLE001
                log("error", "resonance", "поиск не удался", story=card["key"], error=str(e)[:150])
                card["searched_at"] = now()
            changed = True
        pending = any(p["check"] == "не проверена" for p in card["publications"])
        if pending:
            fetcher = fetcher or Fetcher()
            verify(card, fetcher, s["verify_per_run"], log)
            changed = True
            pending = any(p["check"] == "не проверена" for p in card["publications"])
        opened = sum(1 for p in card["publications"] if p["check"] == "открыта")
        if not pending and card.get("shades_tried_for") != opened:
            # Одна попытка на состав круга: сбой LLM не должен повторяться каждую минуту.
            card["shades_tried_for"] = opened
            card["ours"] = _ours(root, card.get("story_key"))
            shades(card, llm, log)
            card.pop("ours", None)
            changed = True
        if not pending and age > timedelta(days=s["days"]):
            card["status"] = "закрыта"
            changed = True
        if changed:
            _summarize(card)
            _write(path, card)
            touched += 1
    if fetcher is not None:
        fetcher.close()
    if touched:
        circle(root, s, log)
    return touched
