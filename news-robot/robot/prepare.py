"""Подготовка новостей из стека к публикации (Р-97).

Решение пользователя 2026-10-03: подтверждать на отдельной странице не нужно.
«В стек» — это решение редактора; после него робот переводит и готовит
новость, а в колонке «Публикация» появляется её слот и ссылка на превью.

Запускается каждую минуту (cron, flock): берёт из стека (inbox/queue.json)
истории без готового текста. Если прогон уже перевёл историю, текст берётся
из прогона без запросов к LLM; иначе — полная цепочка: статья → факты →
текст → сверка. Результат — .state/prepared/<история>.json; состояние робота
(state.json) подготовка не меняет, поэтому идёт рядом с прогоном.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .feeds import Item
from .fetch import Fetcher
from .llm import LLM, LLMError
from .state import State

MAX_ATTEMPTS = 3


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


def _run_story(run_dir: Path, key: str) -> tuple[dict | None, dict | None]:
    """Кандидат истории и уже написанная новость из прогона, где её показали."""
    summary = _read(run_dir / "summary.json") or {}
    cands = summary.get("candidates") or _read(run_dir / "candidates.json", []) or []
    cand = next((c for c in cands if c.get("story_key") == key), None)
    written = _read(run_dir / "news.json", []) or summary.get("news") or []
    story = next((s for s in written if (s.get("candidate") or {}).get("story_key") == key and s.get("news")), None)
    return cand, story


def _story_inputs(root: Path, run_id: str, key: str, pipeline):
    run_dir = root / "out" / str(run_id or "")
    cand, _ = _run_story(run_dir, key)
    items = {d["id"]: Item(**{k: v for k, v in d.items() if k in Item.__dataclass_fields__})
             for d in _read(run_dir / "items.json", []) or []}
    sources = {s["id"]: s for s in pipeline.all_sources(State(root / ".state" / "state.json"))}
    return cand, items, sources


def regenerate(root: Path, llm: LLM, log, pipeline, fetcher: Fetcher) -> int:
    """Запросы «Перегенерировать» со страницы превью (inbox/regenerate/<история>.json, Р-101)."""
    rdir = root / "inbox" / "regenerate"
    done = 0
    for req_path in sorted(rdir.glob("*.json")) if rdir.exists() else []:
        req = _read(req_path) or {}
        req_path.unlink(missing_ok=True)
        key = req.get("story_key", "")
        path = root / ".state" / "prepared" / f"{key}.json"
        rec = _read(path)
        if not rec or not llm.live:
            log("warn", "regenerate", "нечего перегенерировать или LLM не настроена", story=key)
            continue
        cand, items, sources = _story_inputs(root, rec.get("run_id"), key, pipeline)
        if cand is None or cand.get("lead_item") not in items:
            rec.update(status="ошибка", error="история не найдена в прогоне — перегенерировать нельзя")
            _write(path, rec)
            continue
        old = rec.get("story") or {}
        notes = [*(old.get("issues") or []), *(old.get("warnings") or [])]
        instructions = "\n".join(f"- {x}" for x in notes)
        if req.get("note"):
            instructions += f"\nУказание редактора: {req['note']}"
        history = rec.get("history", [])
        if old:
            history = (history + [{"at": rec.get("ready_at"), "story": old}])[-5:]
        rec.update(status="переделывается", started_at=now(), history=history, error=None)
        _write(path, rec)
        log("info", "regenerate", "перегенерация начата", story=key, urls=len(req.get("urls") or []))
        holder = pipeline.Run(id=f"regenerate-{key}", dir=root / "out" / "prepare", since=datetime.now(timezone.utc))
        try:
            story = pipeline.write_story(holder, cand, items, sources, fetcher, llm, extra_urls=req.get("urls") or [],
                                         extra_text=req.get("text") or None, instructions=instructions or None)
        except Exception as e:  # noqa: BLE001
            rec.update(status="готово", error=f"перегенерация не удалась: {type(e).__name__}: {e}"[:300])
            _write(path, rec)
            log("error", "regenerate", "перегенерация не удалась", story=key, error=str(e)[:200])
            continue
        rec.update(status="готово", ready_at=now(), origin="перегенерация по замечаниям", story=story,
                   regenerated_by=req.get("by"), editor_input={k: req.get(k) for k in ("urls", "text", "note")})
        _write(path, rec)
        log("info", "regenerate", "новость перегенерирована", story=key, issues=len(story.get("issues", [])))
        done += 1
    return done


def run(root: Path, llm: LLM, log, pipeline) -> int:
    queue = (_read(root / "inbox" / "queue.json") or {}).get("items", [])
    pdir = root / ".state" / "prepared"
    done = 0
    fetcher: Fetcher | None = Fetcher()
    try:
        done += regenerate(root, llm, log, pipeline, fetcher)
        for q in queue:
            key = q["story_key"]
            path = pdir / f"{key}.json"
            rec = _read(path) or {"story_key": key, "attempts": 0}
            if rec.get("status") == "готово":
                continue
            if rec.get("attempts", 0) >= MAX_ATTEMPTS and rec.get("status") != "готово":
                # Три попытки не удались (в том числе прерванные на полпути) — очередь идёт дальше.
                if rec.get("status") != "ошибка":
                    rec.update(status="ошибка", error=rec.get("error") or "три попытки не удались")
                    _write(path, rec)
                continue
            run_dir = root / "out" / str(q.get("run_id") or "")
            cand, story = _run_story(run_dir, key)
            if story is not None:
                rec.update(status="готово", ready_at=now(), origin="прогон", story=story, run_id=q.get("run_id"))
                _write(path, rec)
                log("info", "prepare", "новость готова (из прогона)", story=key)
                done += 1
                continue
            if cand is None:
                rec.update(status="ошибка", error="история не найдена в прогоне", attempts=MAX_ATTEMPTS)
                _write(path, rec)
                log("warn", "prepare", "история не найдена в прогоне", story=key, run=q.get("run_id"))
                continue
            if not llm.live:
                rec.update(status="ждёт", error="LLM не настроена")
                _write(path, rec)
                continue
            rec.update(status="переводится", started_at=now(), attempts=rec.get("attempts", 0) + 1)
            _write(path, rec)
            log("info", "prepare", "перевод начат", story=key)
            items = {d["id"]: Item(**{k: v for k, v in d.items() if k in Item.__dataclass_fields__})
                     for d in _read(run_dir / "items.json", []) or []}
            if cand.get("lead_item") not in items:
                rec.update(status="ошибка", error="материал истории не сохранён в прогоне", attempts=MAX_ATTEMPTS)
                _write(path, rec)
                continue
            fetcher = fetcher or Fetcher()
            sources = {s["id"]: s for s in pipeline.all_sources(State(root / ".state" / "state.json"))}
            holder = pipeline.Run(id=f"prepare-{key}", dir=root / "out" / "prepare", since=datetime.now(timezone.utc))
            holder.dir.mkdir(parents=True, exist_ok=True)
            try:
                story = pipeline.write_story(holder, cand, items, sources, fetcher, llm)
            except Exception as e:  # noqa: BLE001 — сбой одной новости не держит очередь
                rec.update(status="ошибка", error=f"{type(e).__name__}: {e}"[:300])
                _write(path, rec)
                log("error", "prepare", "перевод не удался", story=key, error=f"{type(e).__name__}: {e}"[:200])
                continue
            rec.update(status="готово", ready_at=now(), origin="перевод по стеку", story=story, run_id=q.get("run_id"))
            _write(path, rec)
            log("info", "prepare", "новость готова", story=key, issues=len(story.get("issues", [])))
            done += 1
    finally:
        if fetcher:
            fetcher.close()
    return done
