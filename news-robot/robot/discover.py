"""Поиск новых источников: кандидат → проба сайта → оценка LLM → решение редактора.

Кандидаты приходят двумя путями: домены, на которые статьи ссылаются как
на первоисточник или другое издание (pipeline.link_domains), и адреса,
которые редактор предложил сам. Робот находит у сайта ленту (ссылка
rel=alternate на главной или обычные адреса /feed/, /rss), проверяет
robots.txt, считает частоту и берёт примеры заголовков; LLM оценивает,
подходит ли издание сайту. Включает источник только редактор.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup

from .feeds import NotAFeed, parse
from .fetch import FetchError, Fetcher
from .llm import LLM, LLMError, prompt

FEED_GUESSES = ["/feed/", "/rss", "/rss.xml", "/feed.xml", "/atom.xml", "/rss/", "/index.xml"]


def domain_of(url: str) -> str:
    netloc = urlsplit(url if "//" in url else "https://" + url).netloc
    return netloc.lower().removeprefix("www.")


def probe(fetcher: Fetcher, url: str) -> dict:
    """Что за сайт и можно ли его читать: лента, частота, примеры заголовков."""
    origin = f"https://{urlsplit(url if '//' in url else 'https://' + url).netloc}"
    result = {"domain": domain_of(url), "site": origin, "title": None, "lang": None, "feed": None,
              "per_week": 0, "newest": None, "samples": [], "note": None}
    feeds: list[str] = []
    try:
        r = fetcher.get(origin + "/")
        soup = BeautifulSoup(r.content, "lxml")
        site_name = soup.find("meta", property="og:site_name")
        result["title"] = (site_name.get("content") if site_name else None) or \
            (soup.title.get_text(strip=True)[:120] if soup.title else None)
        html = soup.find("html")
        result["lang"] = html.get("lang") if html else None
        for link in soup.find_all("link", rel="alternate"):
            kind = (link.get("type") or "").lower()
            if ("rss" in kind or "atom" in kind) and link.get("href"):
                href = urljoin(r.url, link["href"])
                if "comments" not in href:
                    feeds.append(href)
    except FetchError as e:
        result["note"] = f"главная не открылась: {e.reason}"
    feeds += [origin + g for g in FEED_GUESSES]
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    for feed_url in dict.fromkeys(feeds):
        try:
            r = fetcher.get(feed_url)
            items = parse({"id": "probe"}, r.content, r.headers)
        except (FetchError, NotAFeed) as e:
            if isinstance(e, FetchError) and "robots" in e.reason:
                result["note"] = "лента закрыта robots.txt"
            continue
        if not items:
            continue
        dated = [i for i in items if i.published]
        result.update(
            feed=feed_url,
            newest=max((i.published for i in dated), default=None),
            per_week=sum(1 for i in dated if datetime.fromisoformat(i.published) >= week_ago),
            samples=[i.title for i in items[:8]],
            note=None,
        )
        break
    if not result["feed"] and not result["note"]:
        result["note"] = "ленты не найдено — нужен разбор страницы-списка"
    return result


def assess(llm: LLM, candidate: dict) -> dict:
    """Оценка LLM: подходит ли издание сайту, темы, доверие, рекомендация."""
    payload = {k: candidate.get(k) for k in ("domain", "probe", "count", "kinds", "examples", "proposed_by")}
    return llm.chat_json("source", prompt("source", candidate=json.dumps(payload, ensure_ascii=False, indent=1)),
                         "Оцени источник.", max_tokens=800)


def to_source(c: dict) -> dict:
    """Запись для списка источников из принятого кандидата."""
    p, a = c.get("probe") or {}, c.get("assessment") or {}
    sid = re.sub(r"[^a-z0-9]+", "-", c["domain"]).strip("-")
    src = {"id": sid, "title": a.get("title") or p.get("title") or c["domain"], "site": p.get("site"),
           "lang": (p.get("lang") or "en")[:2], "topics": a.get("topics") or [], "trust": a.get("trust", 6),
           "note": f"добавлен по решению редактора {datetime.now(timezone.utc):%Y-%m-%d}"}
    if p.get("feed"):
        src["feed"] = p["feed"]
    else:
        src["list_url"] = p.get("site")
        src["enabled"] = False
        src["note"] += "; ленты нет — нужен шаблон адресов статей (link_pattern)"
    if a.get("keywords"):
        src["keywords"] = a["keywords"]
    return src


def refresh(state, fetcher: Fetcher, llm: LLM | None, limit: int, log) -> int:
    """Пробует и оценивает новых кандидатов, не больше limit за прогон."""
    done = 0
    for c in state.candidates_pending():
        if done >= limit:
            break
        if not c.get("probe"):
            c["probe"] = probe(fetcher, c.get("url") or c["domain"])
        if llm is not None and llm.live and not c.get("assessment"):
            try:
                c["assessment"] = assess(llm, c)
            except LLMError as e:
                log("warn", "discover", "кандидат не оценён", domain=c["domain"], error=str(e))
        c["status"] = "ждёт решения"
        done += 1
        log("info", "discover", "кандидат проверен", domain=c["domain"], feed=c["probe"].get("feed"))
    return done


def apply_inbox(state, inbox: Path, log) -> int:
    """Решения и предложения со страницы робота (API пишет их в inbox.jsonl, робот применяет).

    Робот — единственный, кто меняет своё состояние; страница только кладёт
    решение в ящик. Применённые строки уходят в inbox.done.jsonl.
    """
    if not inbox.exists():
        return 0
    lines = [ln for ln in inbox.read_text(encoding="utf-8").splitlines() if ln.strip()]
    inbox.unlink()
    applied = 0
    done = inbox.with_name("inbox.done.jsonl")
    with open(done, "a", encoding="utf-8") as out:
        for ln in lines:
            try:
                msg = json.loads(ln)
                if msg.get("action") == "propose":
                    state.propose(msg["url"], domain_of(msg["url"]), msg.get("note"))
                elif msg.get("action") == "judge":
                    from .learn import record
                    run_dir = inbox.parent.parent / "out" / str(msg.get("run_id", ""))
                    summary = json.loads((run_dir / "summary.json").read_text(encoding="utf-8")) \
                        if (run_dir / "summary.json").exists() else None
                    if msg["verdict"] not in ("yes", "no"):
                        raise ValueError("verdict: yes или no")
                    record(state, summary, msg["story_key"], msg["verdict"], msg.get("by"), msg.get("note"))
                elif msg.get("action") == "decide":
                    domain = domain_of(msg["domain"])
                    decision = {"include": "включён", "once": "разово", "reject": "отклонён"}[msg["decision"]]
                    c = state.candidates()[domain]
                    state.decide(domain, decision, to_source(c) if decision == "включён" else None,
                                 f"{msg.get('by') or ''}: {msg.get('note') or ''}".strip(": "))
                msg["result"] = "применено"
                applied += 1
            except (KeyError, ValueError) as e:
                msg = {"raw": ln, "result": f"ошибка: {type(e).__name__} {e}"}
                log("warn", "inbox", "решение не применено", error=msg["result"])
            out.write(json.dumps(msg, ensure_ascii=False) + "\n")
    return applied
