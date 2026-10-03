"""Цепочка робота: сбор → отбор → склейка и ранжирование → статья → факты → текст → сверка.

Каждый этап пишет свой результат в папку прогона out/<run>/, поэтому
прогон можно разобрать по шагам и повторить с любого места. В БД робот
пока ничего не пишет: записи «Новость» появятся после миграции, и тогда
последний шаг станет созданием черновиков через API (WIKI/Новости.md).
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

import httpx
import yaml

from . import checks, discover, learn, lists
from .article import fetch_article
from .feeds import Item, NotAFeed, item_id, parse, passes_filters
from .fetch import FetchError, Fetcher
from .llm import LLM, LLMError, NoLLM, prompt
from .state import State

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent

RANK_DEFAULTS = {
    "trust_weight": 2,        # за каждый балл доверия выше 7
    "per_extra_source": 4,    # за каждое следующее издание той же истории, до трёх
    "students_competition": 10,
    "stale_after_days": 2,
    "stale_penalty": 3,       # за каждый день сверх stale_after_days
}


def llm_extra(cfg: dict) -> dict:
    """Рассуждение модели — настройка news.llm.reasoning: off, low или пусто (как у модели)."""
    mode = os.environ.get("NEWS_LLM_REASONING") or cfg.get("news.llm.reasoning")
    return {"off": {"reasoning": {"enabled": False}}, "low": {"reasoning": {"effort": "low"}}}.get(mode or "", {})


def log(run: "Run", level: str, stage: str, msg: str, **extra) -> None:
    rec = {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"), "level": level,
           "run_id": run.id, "stage": stage, "msg": msg, **extra}
    line = json.dumps(rec, ensure_ascii=False)
    print(line)
    with open(run.dir / "log.jsonl", "a", encoding="utf-8") as f:
        f.write(line + "\n")
    # Живое состояние для страницы робота: этап, последнее сообщение, счёт.
    progress = {"run_id": run.id, "stage": stage, "msg": msg, "ts": rec["ts"], "level": level,
                "feeds": len(run.feeds), "items": len(run.items), "candidates": len(run.candidates),
                "news": len(run.news),
                "stages": {"crawl": [len(run.feeds), run.feeds_total],
                           "triage": [run.triage_done, run.triage_total],
                           "write": [run.write_done, run.write_total]}}
    tmp = run.dir / "progress.json.tmp"
    tmp.write_text(json.dumps(progress, ensure_ascii=False), encoding="utf-8")
    tmp.replace(run.dir / "progress.json")


def notify(run: "Run", text: str) -> None:
    """Неудача прогона — уведомлением в Telegram (правило 13), если бот настроен."""
    token, chat = os.environ.get("NEWS_TELEGRAM_BOT_TOKEN"), os.environ.get("NEWS_TELEGRAM_CHAT_ID")
    if not (token and chat):
        log(run, "warn", "notify", "уведомление не настроено", text=text)
        return
    try:
        httpx.post(f"https://api.telegram.org/bot{token}/sendMessage",
                   json={"chat_id": chat, "text": f"Робот новостей Вх², прогон {run.id}\n{text}"}, timeout=20)
    except httpx.HTTPError as e:
        log(run, "error", "notify", "уведомление не отправлено", error=type(e).__name__)


def load_config() -> dict:
    data = yaml.safe_load((REPO / "config" / "project.parameters.yaml").read_text(encoding="utf-8"))
    return {k: v.get("value") for k, v in data["parameters"].items() if k.startswith("news.")}


def all_sources(state: State | None = None) -> list[dict]:
    """Список из sources.yaml и источники, включённые редактором из кандидатов."""
    data = yaml.safe_load((ROOT / "sources.yaml").read_text(encoding="utf-8"))["sources"]
    if state is not None:
        ids = {s["id"] for s in data}
        data += [s for s in state.added_sources() if s["id"] not in ids]
    return data


def load_sources(only: list[str] | None, state: State | None = None) -> list[dict]:
    data = all_sources(state)
    if only:
        return [s for s in data if s["id"] in only]
    return [s for s in data if s.get("enabled", True) and (s.get("feed") or s.get("list_url"))]


@dataclass
class Run:
    id: str
    dir: Path
    since: datetime
    feeds: list[dict] = field(default_factory=list)
    items: list[Item] = field(default_factory=list)
    filtered_out: int = 0
    already_seen: int = 0
    candidates: list[dict] = field(default_factory=list)
    link_domains: list[dict] = field(default_factory=list)
    # Прогресс по этапам для пульта: сколько всего и сколько сделано.
    feeds_total: int = 0
    triage_total: int = 0
    triage_done: int = 0
    write_total: int = 0
    write_done: int = 0
    news: list[dict] = field(default_factory=list)
    llm_note: str | None = None


# ── 1. Сбор ──────────────────────────────────────────────────────────────────

def crawl(run: Run, sources: list[dict], fetcher: Fetcher, state: State, ignore_seen: bool,
          remember: bool) -> None:
    """remember=False — не запоминать etag: без отбора материалы иначе пропали бы при следующем 304."""
    run.feeds_total = len(sources)
    for src in sources:
        f = state.feed(src["id"])
        rec = {"id": src["id"], "title": src["title"], "feed": src.get("feed") or _first(src["list_url"]),
               "status": "ok", "items": 0, "new": 0, "newest": None}
        if not src.get("feed"):
            _crawl_list(run, src, rec, fetcher, state, ignore_seen)
            continue
        try:
            r = fetcher.get(src["feed"], etag=None if ignore_seen else f.get("etag"),
                            modified=None if ignore_seen else f.get("modified"))
            if r.not_modified:
                rec["status"] = "не изменилась"
                state.ok(src["id"], None, None, None)
                run.feeds.append(rec)
                continue
            items = parse(src, r.content, r.headers)
        except NotAFeed as e:
            fails = state.fail(src["id"], str(e))
            rec.update(status=f"ошибка: {e}", fail_count=fails)
            log(run, "warn", "crawl", "источник не прочитан", source=src["id"], error=str(e), fails=fails)
            run.feeds.append(rec)
            continue
        except FetchError as e:
            fails = state.fail(src["id"], e.reason)
            rec.update(status=f"ошибка: {e.reason}", fail_count=fails)
            log(run, "warn", "crawl", "источник не прочитан", source=src["id"], error=e.reason, fails=fails)
            run.feeds.append(rec)
            continue
        rec["items"] = len(items)
        if not items:
            rec["status"] = "лента пуста"
        newest = max((i.published for i in items if i.published), default=None)
        rec["newest"] = newest
        for it in items:
            if it.published and datetime.fromisoformat(it.published) < run.since:
                continue
            if not passes_filters(src, it):
                run.filtered_out += 1
                continue
            if not ignore_seen and state.seen(it.id):
                run.already_seen += 1
                continue
            run.items.append(it)
            rec["new"] += 1
        state.ok(src["id"], r.headers.get("etag") if remember else None,
                 r.headers.get("last-modified") if remember else None, newest)
        run.feeds.append(rec)
        log(run, "info", "crawl", "источник прочитан", source=src["id"], items=len(items), new=rec["new"])
    # Один адрес из двух лент одного издания (Dezeen: архитектура и ИИ) — один материал.
    unique: dict[str, Item] = {}
    for it in run.items:
        unique.setdefault(it.id, it)
    run.items = list(unique.values())


def _first(value):
    return value[0] if isinstance(value, list) else value


def _crawl_list(run: Run, src: dict, rec: dict, fetcher: Fetcher, state: State, ignore_seen: bool) -> None:
    """Источник без ленты: страница-список и разметка самих статей (robot/lists.py)."""
    seen = (lambda _id: False) if ignore_seen else state.seen
    try:
        items, old, count = lists.read(src, fetcher, seen, run.since, limit=src.get("max_pages", 15))
    except FetchError as e:
        fails = state.fail(src["id"], e.reason)
        rec.update(status=f"ошибка: {e.reason}", fail_count=fails)
        log(run, "warn", "crawl", "источник не прочитан", source=src["id"], error=e.reason, fails=fails)
        run.feeds.append(rec)
        return
    # Старые статьи помечаются сразу: иначе каждый прогон заново открывал бы их страницы.
    for url in old:
        state.mark(item_id(url), url, src["id"])
    kept = [it for it in items if passes_filters(src, it)]
    run.filtered_out += len(items) - len(kept)
    run.items.extend(kept)
    newest = max((i.published for i in items if i.published), default=None)
    rec.update(status="список", items=count["links"], new=len(kept), newest=newest)
    state.ok(src["id"], None, None, newest)
    run.feeds.append(rec)
    log(run, "info", "crawl", "список прочитан", source=src["id"], new=len(kept), old=len(old), **count)


# ── 2. Отбор ─────────────────────────────────────────────────────────────────

def seed_examples() -> dict:
    return yaml.safe_load((ROOT / "prompts" / "examples.yaml").read_text(encoding="utf-8"))


def examples_text(state: State | None = None) -> str:
    """Образцы: последние решения редактора (до 20 «да» и 20 «нет») и первый блок."""
    ex = seed_examples()
    chosen, rejected = list(ex["chosen"]), list(ex["rejected"])
    if state is not None:
        recent = sorted(learn.judgments(state), key=lambda j: j["at"], reverse=True)
        chosen = [j["title"] for j in recent if j["verdict"] == "yes" and j.get("title")][:20] + chosen
        rejected = [j["title"] for j in recent if j["verdict"] == "no" and j.get("title")][:20] + rejected
    return "\n".join([f"ДА — {t}" for t in chosen[:40]] + [f"НЕТ — {t}" for t in rejected[:40]])


def profile_text(state: State | None = None) -> str:
    learned = (state.data.get("learned") or {}) if state is not None else {}
    if learned.get("profile_text"):
        return learned["profile_text"]
    text = (ROOT / "prompts" / "profile_default.md").read_text(encoding="utf-8")
    return "\n".join(ln for ln in text.splitlines() if not ln.startswith("<!--")).strip()


def triage(run: Run, llm: LLM, sources: dict[str, dict], batch: int, state: State | None = None) -> dict[str, dict]:
    system = prompt("triage", examples=examples_text(state), profile=profile_text(state))
    scores: dict[str, dict] = {}
    run.triage_total = len(run.items)
    for i in range(0, len(run.items), batch):
        part = run.items[i:i + batch]
        payload = [{"id": it.id, "source": sources[it.source_id]["title"], "date": (it.published or "")[:10],
                    "republished_from": it.republished_from,
                    "title": it.title, "summary": it.summary[:600], "url": it.url} for it in part]
        user = "Материалы:\n" + json.dumps(payload, ensure_ascii=False, indent=1)
        try:
            result = llm.chat_json("triage", system, user, max_tokens=16000)
        except LLMError as e:
            log(run, "error", "triage", "пачка не оценена", error=str(e), first=part[0].id)
            continue
        for rec in result.get("items", []):
            if rec.get("id") in {p.id for p in part}:
                scores[rec["id"]] = rec
        run.triage_done = min(run.triage_total, i + len(part))
        # Промежуточный итог отбора — пульт показывает оценки, не дожидаясь конца.
        by_id = {it.id: it for it in run.items}
        _dump(run.dir / "triage_partial.json", sorted(
            [{**s, "source": sources[by_id[k].source_id]["title"], "url": by_id[k].url, "title": by_id[k].title}
             for k, s in scores.items() if k in by_id], key=lambda s: -(s.get("interest") or 0)))
        log(run, "info", "triage", "пачка оценена", size=len(part), got=len(result.get("items", [])))
    return scores


# ── 3. Склейка и ранжирование ────────────────────────────────────────────────

def rank(run: Run, scores: dict[str, dict], sources: dict[str, dict], weights: dict,
         state: State | None = None) -> list[dict]:
    stories: dict[str, dict] = {}
    for it in run.items:
        s = scores.get(it.id)
        if not s or not s.get("relevant"):
            continue
        key = s.get("story_key") or it.id
        st = stories.setdefault(key, {"story_key": key, "items": [], "score": s})
        st["items"].append(it)
        if (s.get("interest") or 0) > (st["score"].get("interest") or 0):
            st["score"] = s
    now = datetime.now(timezone.utc)
    result = []
    for st in stories.values():
        s, items = st["score"], st["items"]
        interest = int(s.get("interest") or 0)
        trust = max(sources[i.source_id].get("trust", 5) for i in items)
        # Перепечатка стареет с даты первой публикации, а не с даты в ленте (Р-98).
        dated = [datetime.fromisoformat(i.republished_from + "T00:00:00+00:00") if i.republished_from
                 else datetime.fromisoformat(i.published) for i in items if i.published or i.republished_from]
        age = (now - min(dated)).days if dated else 0
        final = interest
        final += (trust - 7) * weights["trust_weight"]
        final += min(len({i.source_id for i in items}) - 1, 3) * weights["per_extra_source"]
        if s.get("competition") and s.get("students_eligible"):
            final += weights["students_competition"]
        final -= max(0, age - weights["stale_after_days"]) * weights["stale_penalty"]
        # Главный материал истории — из самого надёжного издания.
        lead = max(items, key=lambda i: (sources[i.source_id].get("trust", 5), len(i.summary)))
        result.append({
            "story_key": st["story_key"], "final": max(0, min(100, final)), "interest": interest,
            "title_ru": s.get("title_ru") or lead.title, "topic": s.get("topic"), "kind": s.get("kind"),
            "competition": bool(s.get("competition")), "students_eligible": s.get("students_eligible"),
            "reason": s.get("reason"), "lead_item": lead.id,
            "republished_from": next((i.republished_from for i in items if i.republished_from), None),
            "sources": [{"source": sources[i.source_id]["title"], "url": i.url, "title": i.title,
                         "date": (i.published or "")[:10]} for i in items],
        })
    if state is not None:
        # Повторение истории за неделю: издания, подхватившие её в прошлых прогонах, тоже считаются.
        learn.track_stories(state, result)
        learned = state.data.get("learned") or {}
        for c in result:
            run_n = len({s["source"] for s in c["sources"]})
            earlier = min(max(c.get("sources_total", run_n) - run_n, 0), max(0, 3 - (run_n - 1)))
            c["adjust"] = learn.apply(c, learned)
            c["final"] = max(0, min(100, c["final"] + earlier * weights["per_extra_source"] + c["adjust"]))
    result.sort(key=lambda c: c["final"], reverse=True)
    return result


# ── 4–6. Статья → факты → текст → сверка ─────────────────────────────────────

def write_story(run: Run, cand: dict, items: dict[str, Item], sources: dict[str, dict],
                fetcher: Fetcher, llm: LLM) -> dict:
    it = items[cand["lead_item"]]
    src = sources[it.source_id]
    art = fetch_article(fetcher, it, bool(src.get("full_text")))
    meta = {"издание": src["title"], "адрес": it.url, "дата": (it.published or "")[:10],
            "заголовок": it.title, "автор": it.author or art.get("author"), "откуда текст": art["text_origin"],
            "производитель о своём продукте": bool(src.get("vendor"))}
    article = (json.dumps(meta, ensure_ascii=False) + "\n\nТекст статьи:\n" + art["text"]
               + "\n\nФотографии:\n" + json.dumps(art["images"], ensure_ascii=False, indent=1)
               + "\n\nСсылки из статьи:\n" + json.dumps(art["links"], ensure_ascii=False, indent=1))
    story = {"candidate": cand, "source": meta, "warnings": list(art["warnings"])}
    facts = llm.chat_json("facts", prompt("facts", article=article), "Выпиши факты.", max_tokens=16000)
    if src.get("vendor"):
        facts["vendor_claims"] = True
    story["facts"] = facts
    story["raw_links"] = art["links"]
    # Интервью — если так решил отбор, если первоисточник — интервью, лекция, подкаст или
    # видео-беседа, или если это сказано в заголовке (Р-98: отбор мог пройти до правила).
    work = facts.get("primary_work") or {}
    said = re.search(r"interview|in conversation|talks? (?:to|with)|интервью|беседа|разговор", f"{it.title} {work.get('title', '')}", re.I)
    genre = "interview" if (cand.get("kind") == "interview" or work.get("kind") in ("interview", "lecture", "podcast")
                            or (work.get("kind") == "video" and facts.get("quotes")) or said) else "news"
    story["genre"] = genre
    if art.get("republished_from"):
        facts["republished_from"] = art["republished_from"]
    genre_rules = (ROOT / "prompts" / f"genre_{genre}.md").read_text(encoding="utf-8")
    write_sys = prompt("write", source_title=src["title"], source_url=it.url, source_date=meta["дата"],
                       facts=json.dumps(facts, ensure_ascii=False, indent=1), genre_rules=genre_rules)
    news = llm.chat_json("write", write_sys, "Напиши новость.", max_tokens=12000)
    verdict = llm.chat_json("verify", prompt("verify", facts=json.dumps(facts, ensure_ascii=False),
                                             news=json.dumps(news, ensure_ascii=False)),
                            "Проверь новость.", max_tokens=8000)
    if verdict.get("verdict") == "fix":
        fix = "Исправь новость. Замечания проверки:\n" + json.dumps(verdict, ensure_ascii=False, indent=1)
        news = llm.chat_json("rewrite", write_sys, fix, max_tokens=12000)
        verdict = llm.chat_json("verify", prompt("verify", facts=json.dumps(facts, ensure_ascii=False),
                                                 news=json.dumps(news, ensure_ascii=False)),
                                "Проверь новость.", max_tokens=8000)
    story["news"] = news
    story["verify"] = verdict
    story["issues"] = checks.check(news, facts, art["text"], genre)
    hard = [x for x in story["issues"] if x.startswith("интервью:") or x.startswith("цитата не найдена")]
    if hard:
        fix = "Исправь новость. Нарушены правила:\n" + "\n".join(hard)
        news = llm.chat_json("rewrite", write_sys, fix, max_tokens=12000)
        story["news"] = news
        story["issues"] = checks.check(news, facts, art["text"], genre)
    return story


# ── Внешние ссылки → кандидаты в источники ───────────────────────────────────

def link_domains(news: list[dict], sources: dict[str, dict]) -> list[dict]:
    """Домены, на которые ссылаются статьи: первоисточники и другие издания.

    Издание, которого нет в sources.yaml и на которое ссылаются как на
    первоисточник или соседнюю новость, — кандидат в список источников.
    """
    known = {urlsplit(s.get("site") or "").netloc.removeprefix("www.") for s in sources.values()}
    stats: dict[str, dict] = {}
    for st in news:
        for link in (st.get("facts") or {}).get("links") or []:
            kind = link.get("kind")
            if kind not in ("primary", "news_portal", "research"):
                continue
            domain = urlsplit(link.get("url", "")).netloc.removeprefix("www.")
            if not domain:
                continue
            d = stats.setdefault(domain, {"domain": domain, "count": 0, "kinds": {}, "examples": [],
                                          "known": domain in known})
            d["count"] += 1
            d["kinds"][kind] = d["kinds"].get(kind, 0) + 1
            if len(d["examples"]) < 3:
                d["examples"].append({"url": link["url"], "about": link.get("about"),
                                      "story": st["candidate"]["story_key"]})
    return sorted(stats.values(), key=lambda d: (d["known"], -d["count"]))


# ── Прогон ───────────────────────────────────────────────────────────────────

def run(args) -> Run:
    cfg = load_config()
    since = (datetime.fromisoformat(args.since).replace(tzinfo=timezone.utc) if args.since
             else datetime.now(timezone.utc) - timedelta(hours=args.hours))
    run_id = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = Path(args.out) / run_id
    out.mkdir(parents=True, exist_ok=True)
    r = Run(id=run_id, dir=out, since=since)
    state = State(ROOT / ".state" / "state.json")
    src_list = load_sources(args.sources, state)
    sources = {s["id"]: s for s in all_sources(state)}
    fetcher = Fetcher(delay=args.delay)
    llm = LLM(cfg.get("news.llm.base_url") or "https://api.polza.ai/api/v1",
              args.model or os.environ.get("NEWS_LLM_MODEL") or cfg.get("news.llm.model"),
              cfg.get("news.llm.api_key_env") or "POLZA_API_KEY", out / "llm",
              token_limit=args.token_limit, extra=llm_extra(cfg))
    log(r, "info", "run", "старт", since=since.isoformat(), sources=len(src_list), llm=llm.live)
    status = "ok"
    try:
        applied = discover.apply_inbox(state, ROOT / "inbox" / "inbox.jsonl",
                                       lambda lvl, st, msg, **kw: log(r, lvl, st, msg, **kw))
        if applied:
            log(r, "info", "inbox", "решения со страницы применены", count=applied)
            src_list = load_sources(args.sources, state)
            sources = {s["id"]: s for s in all_sources(state)}
        learn.calibrate(state, llm, seed_examples(), lambda lvl, st, msg, **kw: log(r, lvl, st, msg, **kw),
                        min_new=args.learn_min_new, default_profile=profile_text(None))
        crawl(r, src_list, fetcher, state, args.ignore_seen, remember=llm.live and not args.no_llm)
        _dump(out / "items.json", [i.to_dict() for i in r.items])
        log(r, "info", "crawl", "сбор закончен", new=len(r.items), filtered=r.filtered_out, seen=r.already_seen)
        failed = [f for f in r.feeds if f["status"].startswith("ошибка") and f.get("fail_count", 0) >= 3]
        if failed:
            notify(r, "Источники молчат 3 прогона подряд: " + ", ".join(f["id"] for f in failed))
        if args.no_llm or not r.items:
            r.llm_note = "LLM не вызывалась (--no-llm)" if args.no_llm else "новых материалов нет"
            return r
        try:
            scores = triage(r, llm, sources, args.batch, state)
        except NoLLM:
            r.llm_note = ("Ключа или модели нет: запросы отбора сохранены в llm/ — "
                          "их можно отправить вручную. Остальные этапы ждут ответа.")
            log(r, "warn", "triage", r.llm_note)
            return r
        weights = {k: (cfg.get(f"news.rank.{k}") if cfg.get(f"news.rank.{k}") is not None else v)
                   for k, v in RANK_DEFAULTS.items()}
        learned_w = ((state.data.get("learned") or {}).get("adjustments") or {}).get("per_extra_source")
        if learned_w is not None:
            weights["per_extra_source"] = learned_w
        r.candidates = rank(r, scores, sources, weights, state)
        _dump(out / "candidates.json", r.candidates)
        for it in r.items:
            if it.id in scores:
                state.mark(it.id, it.url, it.source_id)
        by_id = {i.id: i for i in r.items}
        chosen = [c for c in r.candidates if c["interest"] >= args.threshold][:args.top]
        r.write_total = len(chosen)
        for cand in chosen:
            try:
                story = write_story(r, cand, by_id, sources, fetcher, llm)
                r.news.append(story)
                r.write_done += 1
                _dump(out / "news.json", r.news)
                log(r, "info", "write", "новость написана", story=cand["story_key"], issues=len(story["issues"]))
            except LLMError as e:
                r.write_done += 1
                log(r, "error", "write", "новость не написана", story=cand["story_key"], error=str(e))
        _dump(out / "news.json", r.news)
        r.link_domains = link_domains(r.news, sources)
        _dump(out / "link_domains.json", r.link_domains)
        added = state.add_link_candidates(r.link_domains)
        checked = discover.refresh(state, fetcher, llm, limit=args.probe_limit,
                                   log=lambda lvl, st, msg, **kw: log(r, lvl, st, msg, **kw))
        log(r, "info", "discover", "кандидаты в источники", new=added, checked=checked)
        r.llm_note = (f"LLM: {llm.model}, вызовов {llm.used['calls']}, "
                      f"токенов {llm.used['prompt']} + {llm.used['completion']}")
        return r
    except Exception as e:
        status = f"прерван: {type(e).__name__}: {e}"
        log(r, "error", "run", "прогон прерван", error=f"{type(e).__name__}: {e}")
        notify(r, f"Прогон прерван: {type(e).__name__}: {e}")
        raise
    finally:
        state.save()
        fetcher.close()
        write_sources_snapshot(state)
        _dump(out / "summary.json", summary(r, status, state))
        log(r, "info", "run", "конец", status=status)


def sources_snapshot(state: State) -> list[dict]:
    """Список источников для страницы робота: настройка и состояние обхода каждого."""
    rows = []
    added = {s["id"] for s in state.added_sources()}
    for s in all_sources(state):
        f = state.data.get("feeds", {}).get(s["id"], {})
        rows.append({
            "id": s["id"], "title": s.get("title"), "site": s.get("site"), "feed": s.get("feed"),
            "list_url": s.get("list_url"), "lang": s.get("lang"), "topics": s.get("topics", []),
            "trust": s.get("trust"), "enabled": s.get("enabled", True), "vendor": bool(s.get("vendor")),
            "filters": {k: s[k] for k in ("path", "keywords", "link_pattern") if s.get(k)},
            "note": s.get("note"), "origin": "редактор" if s["id"] in added else "список",
            "last_checked": f.get("last_checked"), "last_item": f.get("last_item"),
            "fail_count": f.get("fail_count", 0), "last_error": f.get("last_error"),
        })
    return rows


def write_sources_snapshot(state: State) -> None:
    path = ROOT / ".state" / "sources.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(sources_snapshot(state), ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)


def summary(r: Run, status: str, state: State) -> dict:
    """Итог прогона для страницы робота (SU): то же, что report.html, но данными."""
    return {
        "id": r.id, "finished_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "since": r.since.isoformat(), "status": status, "llm_note": r.llm_note,
        "counts": {"feeds": len(r.feeds), "feeds_failed": sum(1 for f in r.feeds if f["status"].startswith("ошибка")),
                   "items": len(r.items), "filtered": r.filtered_out, "seen": r.already_seen,
                   "candidates": len(r.candidates), "news": len(r.news)},
        "feeds": r.feeds,
        "candidates": r.candidates[:60],
        "news": [{"candidate": st["candidate"], "news": st.get("news"), "issues": st.get("issues", []),
                  "warnings": st.get("warnings", []), "verify": st.get("verify")} for st in r.news],
        "link_domains": r.link_domains,
        "learned": {k: v for k, v in (state.data.get("learned") or {}).items() if k != "history"},
        "agreement": learn.agreement(learn.judgments(state)),
        "judged": {j["story_key"]: j["verdict"] for j in learn.judgments(state)},
        "source_candidates": sorted(state.candidates().values(),
                                    key=lambda c: (c.get("status") != "ждёт решения", -c.get("count", 0))),
    }


def _dump(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
