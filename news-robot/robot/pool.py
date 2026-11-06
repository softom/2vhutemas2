"""Промежуточная база собранных новостей для оценки и переоценки (.state/pool.json).

1. Все собранные при обходе лент материалы складываются в промежуточную БД (.state/pool.json).
2. Материалы и истории старше 30 дней (1 месяца) автоматически удаляются из БД для оценки.
3. Промпт отбора (train / triage) можно прочитать и изменить на странице робота, после чего
   переоценить промежуточную базу новостей новым промптом без повторного обхода сайтов.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import learn, similar
from .feeds import Item, passes_filters
from .llm import LLM, LLMError

WINDOW_DAYS = 30


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


def pool_path(root: Path) -> Path:
    return root / ".state" / "pool.json"


def status_path(root: Path) -> Path:
    return root / ".state" / "retriage_status.json"


def prompt_snapshot_path(root: Path) -> Path:
    return root / ".state" / "triage_prompt.json"


def _item_date(it: dict) -> datetime | None:
    for field in ("republished_from", "published", "first_seen"):
        val = it.get(field)
        if not val:
            continue
        try:
            s = str(val).strip()
            if len(s) == 10:
                s += "T00:00:00+00:00"
            dt = datetime.fromisoformat(s)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue
    return None


def _cand_date(c: dict) -> datetime | None:
    dates = [s.get("date") for s in (c.get("sources") or []) if s.get("date")]
    first = c.get("republished_from") or c.get("first_date") or (min(dates) if dates else None)
    if not first:
        return None
    try:
        s = str(first).strip()
        if len(s) == 10:
            s += "T00:00:00+00:00"
        dt = datetime.fromisoformat(s)
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    except ValueError:
        return None


def load(root: Path) -> dict:
    data = _read(pool_path(root))
    if not isinstance(data, dict):
        data = {"updated_at": now(), "window_days": WINDOW_DAYS, "items": {}, "scores": {}, "candidates": []}
    data.setdefault("window_days", WINDOW_DAYS)
    data.setdefault("items", {})
    data.setdefault("scores", {})
    data.setdefault("candidates", [])
    return data


def save(root: Path, data: dict) -> None:
    data["updated_at"] = now()
    data["window_days"] = WINDOW_DAYS
    _write(pool_path(root), data)


def prune(data: dict, sources: dict[str, dict] | None = None, days: int = WINDOW_DAYS) -> int:
    """Удаляет из промежуточной БД материалы и истории старше days дней (по умолчанию 30 дней),
    а также материалы, не проходящие актуальные фильтры источников (sources.yaml)."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    items = data.get("items") or {}
    scores = data.get("scores") or {}
    removed = 0
    for item_id in list(items.keys()):
        it = items[item_id]
        dt = _item_date(it)
        if dt is not None and dt < cutoff:
            del items[item_id]
            scores.pop(item_id, None)
            removed += 1
            continue
        if sources and it.get("source_id") in sources:
            src = sources[it["source_id"]]
            obj = Item(
                id=it["id"],
                source_id=it["source_id"],
                url=it.get("url") or "",
                title=it.get("title") or "",
                summary=it.get("summary") or "",
                published=it.get("published"),
                author=it.get("author"),
                republished_from=it.get("republished_from"),
            )
            if not passes_filters(src, obj):
                del items[item_id]
                scores.pop(item_id, None)
                removed += 1
    kept_cands = []
    for c in data.get("candidates") or []:
        dt = _cand_date(c)
        if dt is not None and dt < cutoff:
            continue
        # Если у кандидата lead_item был удалён фильтрами или по возрасту — убираем кандидата
        if c.get("lead_item") and items and c["lead_item"] not in items:
            continue
        kept_cands.append(c)
    data["candidates"] = kept_cands
    data["pruned_count"] = removed
    return removed


def bootstrap_from_runs(root: Path, data: dict, sources: dict[str, dict] | None = None, days: int = WINDOW_DAYS) -> int:
    """Подтягивает материалы и оценки из папок out/<run_id>/ за последние 30 дней в промежуточную БД."""
    out_dir = root / "out"
    if not out_dir.exists():
        return 0
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    items = data.setdefault("items", {})
    scores = data.setdefault("scores", {})
    added = 0
    run_dirs = sorted(
        [d for d in out_dir.iterdir() if d.is_dir() and re.fullmatch(r"\d{8}-\d{6}", d.name)],
        key=lambda d: d.name,
    )
    written_keys: set[str] = set()
    for rdir in run_dirs:
        try:
            r_dt = datetime.strptime(rdir.name[:8], "%Y%m%d").replace(tzinfo=timezone.utc)
            if r_dt < cutoff - timedelta(days=2):
                continue
        except ValueError:
            continue
        raw_items = _read(rdir / "items.json", []) or []
        summary = _read(rdir / "summary.json", {}) or {}
        cands = summary.get("candidates") or _read(rdir / "candidates.json", []) or []
        partials = _read(rdir / "triage_partial.json", []) or []
        news_list = summary.get("news") or _read(rdir / "news.json", []) or []
        for n in news_list:
            if n.get("news") and (n.get("candidate") or {}).get("story_key"):
                written_keys.add(str(n["candidate"]["story_key"]))
        cand_by_lead = {c.get("lead_item"): c for c in cands if c.get("lead_item")}
        part_by_id = {p.get("id"): p for p in partials if p.get("id")}
        for raw in raw_items:
            iid = raw.get("id")
            if not iid:
                continue
            rec = {
                "id": iid,
                "source_id": raw.get("source_id"),
                "url": raw.get("url"),
                "title": raw.get("title"),
                "summary": (raw.get("summary") or "")[:1000],
                "published": raw.get("published"),
                "author": raw.get("author"),
                "republished_from": raw.get("republished_from"),
                "run_id": rdir.name,
                "first_seen": (items.get(iid) or {}).get("first_seen") or raw.get("published") or now(),
            }
            dt = _item_date(rec)
            if dt is not None and dt < cutoff:
                continue
            if iid not in items:
                added += 1
            items[iid] = rec
            if iid not in scores:
                if iid in part_by_id:
                    scores[iid] = part_by_id[iid]
                elif iid in cand_by_lead:
                    c = cand_by_lead[iid]
                    scores[iid] = {
                        "id": iid,
                        "relevant": True,
                        "topic": c.get("topic"),
                        "kind": c.get("kind"),
                        "competition": bool(c.get("competition")),
                        "students_eligible": c.get("students_eligible"),
                        "interest": c.get("interest"),
                        "reason": c.get("reason"),
                        "story_key": c.get("story_key"),
                        "title_ru": c.get("title_ru"),
                    }
    data["written_keys"] = sorted(set(data.get("written_keys") or []) | written_keys)
    prune(data, sources=sources, days=days)
    return added


def ingest_run(root: Path, run_id: str, run_items: list[Item], run_scores: dict[str, dict],
               run_candidates: list[dict], written_keys: set[str], sources: dict[str, dict]) -> dict:
    """Добавляет материалы и оценки свежего прогона в промежуточную БД и пересчитывает общий пул за 30 дней."""
    data = load(root)
    bootstrap_from_runs(root, data, sources=sources, days=WINDOW_DAYS)
    items = data.setdefault("items", {})
    scores = data.setdefault("scores", {})
    for it in run_items:
        items[it.id] = {
            "id": it.id,
            "source_id": it.source_id,
            "url": it.url,
            "title": it.title,
            "summary": (it.summary or "")[:1000],
            "published": it.published,
            "author": it.author,
            "republished_from": it.republished_from,
            "run_id": run_id,
            "first_seen": (items.get(it.id) or {}).get("first_seen") or it.published or now(),
        }
    for iid, sc in run_scores.items():
        if iid in items:
            scores[iid] = sc
    data["written_keys"] = sorted(set(data.get("written_keys") or []) | set(written_keys))
    prune(data, sources=sources, days=WINDOW_DAYS)
    # Обновляем список кандидатов в пуле: свежие кандидаты + кандидаты из пула за 30 дней
    by_key: dict[str, dict] = {}
    for c in data.get("candidates") or []:
        if c.get("story_key"):
            by_key[c["story_key"]] = c
    for c in run_candidates:
        if c.get("story_key"):
            by_key[c["story_key"]] = {**c, "run_id": run_id, "written": c["story_key"] in data["written_keys"]}
    data["candidates"] = sorted(by_key.values(), key=lambda x: x.get("final") or 0, reverse=True)
    save(root, data)
    return data


def to_items(data: dict, sources: dict[str, dict]) -> list[Item]:
    res: list[Item] = []
    for raw in (data.get("items") or {}).values():
        sid = raw.get("source_id")
        if not sid or sid not in sources:
            continue
        res.append(
            Item(
                id=raw["id"],
                source_id=sid,
                url=raw.get("url") or "",
                title=raw.get("title") or "",
                summary=raw.get("summary") or "",
                published=raw.get("published"),
                author=raw.get("author"),
                republished_from=raw.get("republished_from"),
            )
        )
    return res


def write_prompt_snapshot(root: Path, state, pipeline_mod) -> dict:
    """Пишет в .state/triage_prompt.json текущий промпт train (triage), профиль, примеры и статистику БД."""
    default_tpl = (root / "prompts" / "triage.md").read_text(encoding="utf-8").strip()
    learned = (state.data.get("learned") or {}) if state is not None else {}
    custom_tpl = (learned.get("custom_triage_prompt") or "").strip()
    tpl = custom_tpl or default_tpl
    prof = pipeline_mod.profile_text(state)
    ex = pipeline_mod.examples_text(state)
    full_prompt = tpl.replace("{{profile}}", prof).replace("{{examples}}", ex)
    pdata = load(root)
    snap = {
        "updated_at": now(),
        "template": tpl,
        "default_template": default_tpl,
        "is_custom_template": bool(custom_tpl),
        "profile_text": prof,
        "examples_text": ex,
        "full_prompt": full_prompt,
        "pool": {
            "window_days": WINDOW_DAYS,
            "items_count": len(pdata.get("items") or {}),
            "scored_count": len(pdata.get("scores") or {}),
            "candidates_count": len(pdata.get("candidates") or []),
            "pruned_count": pdata.get("pruned_count") or 0,
            "last_retriage_at": pdata.get("last_retriage_at"),
            "updated_at": pdata.get("updated_at"),
        },
    }
    _write(prompt_snapshot_path(root), snap)
    return snap


def run_retriage(root: Path, llm: LLM, log, pipeline_mod, beat=None, force_request: dict | None = None) -> bool:
    """Выполняет запрос на изменение промпта / калибровку и переоценку промежуточной базы новостей за 30 дней."""
    req_path = root / "inbox" / "retriage.json"
    req = force_request
    if req is None:
        if not req_path.exists():
            return False
        req = _read(req_path) or {}
        req_path.unlink(missing_ok=True)

    from .state import State
    state = State(root / ".state" / "state.json")
    learned = state.data.setdefault("learned", {"history": []})

    # 1. Применяем новые решения из ящика, если они ждут
    from . import discover
    applied = discover.apply_inbox(state, root / "inbox" / "inbox.jsonl", log)
    if applied:
        log("info", "retriage", "решения из ящика применены перед переоценкой", count=applied)

    # 2. Обновляем промпт или профиль, если редактор передал их со страницы
    if isinstance(req.get("profile_text"), str):
        pt = req["profile_text"].strip()
        if pt:
            learned["profile_text"] = pt
            log("info", "retriage", "профиль вкуса обновлён редактором вручную")
    if isinstance(req.get("triage_template"), str):
        tt = req["triage_template"].strip()
        default_tpl = (root / "prompts" / "triage.md").read_text(encoding="utf-8").strip()
        if not tt or tt == default_tpl:
            learned.pop("custom_triage_prompt", None)
        else:
            learned["custom_triage_prompt"] = tt
            log("info", "retriage", "шаблон промпта отбора обновлён редактором")

    # 3. Если запрошена перекалибровка по решениям (+ / -)
    if (req.get("recalibrate") or req.get("calibrate")) and llm.live:
        if beat:
            beat("калибровка профиля по решениям +/−")
        _write(status_path(root), {"running": True, "stage": "калибровка профиля по решениям", "done": 0, "total": 0, "started_at": now()})
        learn.calibrate(
            state,
            llm,
            pipeline_mod.seed_examples(),
            log,
            force=True,
            default_profile=pipeline_mod.profile_text(None),
        )
    else:
        # Даже без LLM-калибровки пересчитываем статистические поправки с новым потолком MAX_ADJUST
        items_j = learn.judgments(state)
        if items_j:
            learned["adjustments"] = learn.adjustments(items_j)

    state.save()

    # 4. Загружаем промежуточную БД, подтягиваем прогоны за 30 дней и удаляем всё старше 30 дней
    sources = {s["id"]: s for s in pipeline_mod.all_sources(state)}
    pdata = load(root)
    bootstrap_from_runs(root, pdata, sources=sources, days=WINDOW_DAYS)
    pruned = prune(pdata, sources=sources, days=WINDOW_DAYS)
    log("info", "retriage", "промежуточная БД подготовлена", items=len(pdata["items"]), pruned_30d=pruned)

    if req.get("prompt_only"):
        save(root, pdata)
        write_prompt_snapshot(root, state, pipeline_mod)
        _write(status_path(root), {"running": False, "stage": "промпт сохранён", "done": 0, "total": 0, "finished_at": now()})
        return True

    if not llm.live:
        save(root, pdata)
        write_prompt_snapshot(root, state, pipeline_mod)
        _write(status_path(root), {"running": False, "error": "LLM не настроена", "finished_at": now()})
        return False

    # 5. Определяем материалы для переоценки через LLM
    mode = req.get("mode") or "unjudged"
    judged_keys = set((state.data.get("judgments") or {}).keys())
    queued_keys = {q.get("story_key") for q in (_read(root / "inbox" / "queue.json") or {}).get("items", []) if q.get("story_key")}
    skip_keys = set() if mode == "all" else (judged_keys | queued_keys)

    all_items_dict = pdata.get("items") or {}
    old_scores = pdata.get("scores") or {}
    to_eval: list[Item] = []
    for iid, raw in all_items_dict.items():
        sid = raw.get("source_id")
        if not sid or sid not in sources:
            continue
        old_sc = old_scores.get(iid)
        if old_sc is not None:
            if skip_keys and old_sc.get("story_key") in skip_keys:
                continue
            # В режиме по умолчанию переоцениваем кандидатов (relevant=True) и ещё не оценённые материалы,
            # не тратя токены повторно на явный нецелевой шум (relevant=False), если не запрошен mode="all".
            if mode != "all" and not old_sc.get("relevant"):
                continue
        to_eval.append(
            Item(
                id=iid,
                source_id=sid,
                url=raw.get("url") or "",
                title=raw.get("title") or "",
                summary=raw.get("summary") or "",
                published=raw.get("published"),
                author=raw.get("author"),
                republished_from=raw.get("republished_from"),
            )
        )

    # Сортируем от новых к старым, чтобы свежие оценивались первыми
    to_eval.sort(key=lambda x: x.published or "", reverse=True)
    batch_size = 15
    total = len(to_eval)
    started = now()
    _write(status_path(root), {"running": True, "stage": "переоценка базы новостей", "done": 0, "total": total, "started_at": started})
    log("info", "retriage", "старт переоценки базы", total=total, mode=mode)

    # Для полной переоценки 30-дневного пула кандидатов поднимаем лимит токенов на прогон
    if hasattr(llm, "token_limit") and llm.token_limit:
        llm.token_limit = max(int(llm.token_limit), 800_000)

    system = pipeline_mod.build_triage_prompt(state)
    new_scores = dict(old_scores)
    aborted: str | None = None
    done_n = total

    for i in range(0, total, batch_size):
        part = to_eval[i:i + batch_size]
        if beat:
            beat(f"переоценка базы: {i}/{total}")
        _write(status_path(root), {"running": True, "stage": "переоценка базы новостей", "done": i, "total": total, "started_at": started})
        payload = [
            {
                "id": it.id,
                "source": sources[it.source_id]["title"],
                "date": (it.published or "")[:10],
                "republished_from": it.republished_from,
                "title": it.title,
                "summary": (it.summary or "")[:600],
                "url": it.url,
            }
            for it in part
        ]
        try:
            resp = llm.chat_json("retriage", system, "Материалы:\n" + json.dumps(payload, ensure_ascii=False, indent=1), max_tokens=16000)
        except LLMError as e:
            err_str = str(e)
            log("error", "retriage", "пачка не переоценена", error=err_str, first=part[0].id)
            if "предел токенов" in err_str or "402" in err_str or "INSUFFICIENT_BALANCE" in err_str:
                aborted = ("на Polza.AI кончились деньги — пополните баланс и повторите переоценку"
                           if ("402" in err_str or "INSUFFICIENT_BALANCE" in err_str)
                           else "исчерпан предел токенов — повторите переоценку")
                done_n = i
                break
            continue
        valid_ids = {p.id for p in part}
        for rec in resp.get("items", []):
            if rec.get("id") in valid_ids:
                rec["scored_at"] = now()
                new_scores[rec["id"]] = rec
        log("info", "retriage", "пачка переоценена", done=min(total, i + len(part)), total=total)

    pdata["scores"] = new_scores

    # 6. Пересчитываем склейку и ранжирование по всей промежуточной БД за 30 дней
    cfg = pipeline_mod.load_config()
    weights = {k: (cfg.get(f"news.rank.{k}") if cfg.get(f"news.rank.{k}") is not None else v)
               for k, v in pipeline_mod.RANK_DEFAULTS.items()}
    learned_w = ((state.data.get("learned") or {}).get("adjustments") or {}).get("per_extra_source")
    if learned_w is not None:
        weights["per_extra_source"] = learned_w

    pool_items = to_items(pdata, sources)
    holder = pipeline_mod.Run(id="retriage", dir=root / "out" / "prepare", since=datetime.now(timezone.utc) - timedelta(days=WINDOW_DAYS))
    holder.items = pool_items

    # Подтягиваем известные сопоставления с сайтом из .state/similar.json
    sim_data = _read(root / ".state" / "similar.json", {}) or {}
    site_map = sim_data.get("site") or {}
    aliases = sim_data.get("aliases") or {}
    for sc in new_scores.values():
        sk = sc.get("story_key")
        if sk and sk in aliases and aliases[sk].get("to"):
            sc["story_key"] = aliases[sk]["to"]

    ranked = pipeline_mod.rank(holder, new_scores, sources, weights, state)
    written_keys = set(pdata.get("written_keys") or [])
    item_runs = {iid: (raw.get("run_id") or "") for iid, raw in all_items_dict.items()}

    for c in ranked:
        if c["story_key"] in site_map:
            c["site"] = site_map[c["story_key"]]
        if (c.get("site") or {}).get("news"):
            c["final"] = max(0, c["final"] - weights["on_site_penalty"])
        lead_run = item_runs.get(c.get("lead_item") or "")
        if lead_run:
            c["run_id"] = lead_run
        c["written"] = c["story_key"] in written_keys

    ranked.sort(key=lambda c: c["final"], reverse=True)
    pdata["candidates"] = ranked
    pdata["last_retriage_at"] = now()
    save(root, pdata)
    state.save()
    write_prompt_snapshot(root, state, pipeline_mod)
    status = {
        "running": False,
        "stage": "прервано" if aborted else "готово",
        "done": done_n,
        "total": total,
        "candidates": len(ranked),
        "started_at": started,
        "finished_at": now(),
    }
    if aborted:
        status["error"] = aborted
    _write(status_path(root), status)
    log("warn" if aborted else "info", "retriage",
        "переоценка базы прервана" if aborted else "переоценка базы завершена",
        evaluated=done_n, total=total, candidates=len(ranked), reason=aborted)
    return True
