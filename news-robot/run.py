"""Робот новостей Вх² — запуск прогона и решения по источникам.

    python news-robot/run.py --no-llm                 # только сбор: какие ленты живы, что нового
    python news-robot/run.py                          # вся цепочка; ключ — в POLZA_API_KEY
    python news-robot/run.py --since 2026-09-28 --ignore-seen --top 5

Кандидаты в источники (их находит робот по ссылкам статей или предлагает редактор):

    python news-robot/run.py --candidates             # список на подтверждение
    python news-robot/run.py --propose https://example.com --note "увидел в новости"
    python news-robot/run.py --include example.com    # включить в обход
    python news-robot/run.py --once example.com       # полезен как первоисточник, обходить не нужно
    python news-robot/run.py --reject example.com

Ключ LLM берётся только из окружения (имя — news.llm.api_key_env), модель —
из --model, NEWS_LLM_MODEL или news.llm.model. Без ключа цепочка
останавливается после сбора и сохраняет готовые запросы отбора в out/<прогон>/llm/.
Описание — WIKI/Новости — робот, цепочка и промпты.md.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from robot import discover, learn, pipeline, report  # noqa: E402
from robot.fetch import Fetcher  # noqa: E402
from robot.llm import LLM  # noqa: E402
from robot.state import State  # noqa: E402

ROOT = Path(__file__).resolve().parent


def load_env(path: Path) -> None:
    """Секреты робота — из news-robot/.env (вне Git); окружение процесса главнее."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


load_env(ROOT / ".env")


def candidates_command(args) -> int:
    state = State(ROOT / ".state" / "state.json")
    try:
        applied = discover.apply_inbox(state, ROOT / "inbox" / "inbox.jsonl", lambda *a, **k: print(*a, k))
        if applied:
            print(f"Со страницы применено решений: {applied}")
        if args.propose:
            cfg = pipeline.load_config()
            llm = LLM(cfg.get("news.llm.base_url") or "https://api.polza.ai/api/v1",
                      args.model or os.environ.get("NEWS_LLM_MODEL") or cfg.get("news.llm.model"),
                      cfg.get("news.llm.api_key_env") or "POLZA_API_KEY", ROOT / "out" / "proposals" / "llm",
                      token_limit=20_000)
            fetcher = Fetcher(delay=args.delay)
            c = state.propose(args.propose, discover.domain_of(args.propose), args.note)
            discover.refresh(state, fetcher, llm, limit=1, log=lambda *a, **k: None)
            fetcher.close()
            print_candidate(c)
            if not llm.live:
                print("  оценки LLM нет: ключ или модель не заданы")
        for decision, domain in (("включён", args.include), ("разово", args.once), ("отклонён", args.reject)):
            if not domain:
                continue
            domain = discover.domain_of(domain)
            if domain not in state.candidates():
                print(f"Кандидата {domain} нет. Сначала --propose.")
                return 1
            source = discover.to_source(state.candidates()[domain]) if decision == "включён" else None
            c = state.decide(domain, decision, source, args.note)
            print(f"{domain}: {decision}" + (f" → источник {source['id']}" + ("" if source.get("feed") else
                  " (ленты нет — выключен до шаблона адресов)") if source else ""))
        if args.candidates:
            items = sorted(state.candidates().values(), key=lambda c: (c.get("status") != "ждёт решения", -c.get("count", 0)))
            if not items:
                print("Кандидатов пока нет.")
            for c in items:
                print_candidate(c)
    finally:
        state.save()
        pipeline.write_sources_snapshot(state)
    return 0


def prepare_command(args) -> int:
    import json as _json
    from datetime import datetime as _dt, timezone as _tz
    from robot import prepare
    cfg = pipeline.load_config()
    logdir = ROOT / "out" / "prepare"
    logdir.mkdir(parents=True, exist_ok=True)
    llm = LLM(cfg.get("news.llm.base_url") or "https://api.polza.ai/api/v1",
              args.model or os.environ.get("NEWS_LLM_MODEL") or cfg.get("news.llm.model"),
              cfg.get("news.llm.api_key_env") or "POLZA_API_KEY", logdir / "llm",
              token_limit=120_000, extra=pipeline.llm_extra(cfg))

    def log(level, stage, msg, **extra):
        rec = {"ts": _dt.now(_tz.utc).isoformat(timespec="seconds"), "level": level, "stage": stage, "msg": msg, **extra}
        with open(logdir / "log.jsonl", "a", encoding="utf-8") as f:
            f.write(_json.dumps(rec, ensure_ascii=False) + chr(10))
        print(_json.dumps(rec, ensure_ascii=False))

    def beat(doing: str) -> None:
        """Пульс минутного задания для панели «Состояние» (Р-103)."""
        try:
            (ROOT / ".state").mkdir(exist_ok=True)
            (ROOT / ".state" / "heartbeat.json").write_text(_json.dumps(
                {"ts": _dt.now(_tz.utc).isoformat(timespec="seconds"), "doing": doing}, ensure_ascii=False),
                encoding="utf-8")
        except OSError:
            pass

    def logged(level, stage, msg, **extra):
        log(level, stage, msg, **extra)
        if msg in ("перевод начат", "перегенерация начата"):
            beat(f"{msg}: {extra.get('story')}")

    beat("проверяет стек")
    from robot import cover, publish as _publish
    beat("обложки")
    cover.run(ROOT, llm, logged, _publish.Api())
    prepare.run(ROOT, llm, logged, pipeline)
    # Публикатор (Р-102): черновики «Новость», слоты, выход в слот.
    from robot import publish
    beat("публикатор: черновики и слоты")
    only = set(args.publish_now) if args.publish_now and args.publish_now != ["all"] else None
    publish.run(ROOT, log, now_all=args.publish_now is not None, only=only, llm=llm)
    beat("ждёт следующей минуты")
    return 0


def learn_command(args) -> int:
    import json as _json
    state = State(ROOT / ".state" / "state.json")
    try:
        if args.judge:
            run_id, story, verdict = args.judge
            summary_path = ROOT / "out" / run_id / "summary.json"
            summary = _json.loads(summary_path.read_text(encoding="utf-8")) if summary_path.exists() else None
            j = learn.record(state, summary, story, verdict, "командная строка", args.note)
            print(f"{story}: {verdict} · {j.get('title') or 'история не найдена в итоге прогона — признаков нет'}")
        if args.calibrate:
            cfg = pipeline.load_config()
            llm = LLM(cfg.get("news.llm.base_url") or "https://api.polza.ai/api/v1",
                      args.model or os.environ.get("NEWS_LLM_MODEL") or cfg.get("news.llm.model"),
                      cfg.get("news.llm.api_key_env") or "POLZA_API_KEY", ROOT / "out" / "calibration" / "llm",
                      token_limit=60_000, extra=pipeline.llm_extra(cfg))
            entry = learn.calibrate(state, llm, pipeline.seed_examples(), lambda *a, **k: print(*a, k), force=True,
                                    default_profile=pipeline.profile_text(None))
            print(_json.dumps({k: v for k, v in entry.items() if k != "profile"}, ensure_ascii=False, indent=1))
            if entry.get("profile"):
                print("\nПрофиль вкуса:\n" + entry["profile"].get("profile_text", ""))
            elif not llm.live:
                print("\nПрофиль вкуса не обновлён: ключ или модель LLM не заданы. Поправки по статистике посчитаны.")
    finally:
        state.save()
    return 0


def print_candidate(c: dict) -> None:
    p, a = c.get("probe") or {}, c.get("assessment") or {}
    kinds = ", ".join(f"{k} {v}" for k, v in c.get("kinds", {}).items())
    print(f"\n{c['domain']} — {c.get('status')}" + (f" · предложил редактор" if c.get("proposed_by") == "editor" else
                                                      f" · ссылок {c.get('count', 0)} ({kinds})"))
    if p:
        print(f"  {p.get('title') or ''} · язык {p.get('lang') or '?'} · лента {p.get('feed') or 'нет'}"
              f" · {p.get('per_week', 0)} в неделю" + (f" · {p['note']}" if p.get("note") else ""))
        for t in p.get("samples", [])[:3]:
            print(f"    — {t}")
    if a:
        print(f"  LLM: {a.get('recommend')} · {a.get('kind')} · темы {', '.join(a.get('topics') or [])}"
              f" · доверие {a.get('trust')} — {a.get('reason')}")
    for ex in c.get("examples", [])[:2]:
        print(f"  ссылка: {ex.get('about') or ''} {ex.get('url')}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Робот новостей Вх²")
    ap.add_argument("--since", help="брать материалы с даты (ГГГГ-ММ-ДД), по умолчанию — за --hours")
    ap.add_argument("--hours", type=int, default=48, help="окно сбора, часов (по умолчанию 48)")
    ap.add_argument("--sources", nargs="*", help="только эти источники (id из sources.yaml)")
    ap.add_argument("--no-llm", action="store_true", help="только сбор и фильтры, без LLM")
    ap.add_argument("--ignore-seen", action="store_true", help="не пропускать уже виденные материалы")
    ap.add_argument("--model", help="модель LLM (перекрывает настройку)")
    ap.add_argument("--batch", type=int, default=15, help="материалов в одном запросе отбора")
    ap.add_argument("--top", type=int, default=6, help="сколько лучших историй довести до текста")
    ap.add_argument("--per-topic", type=int, default=2, help="и сколько лучших по каждой теме сверх того")
    ap.add_argument("--stale-penalty", type=int, help="штраф за день давности (для догоняющего прогона — 0)")
    ap.add_argument("--threshold", type=int, default=50, help="минимальный интерес для текста")
    ap.add_argument("--token-limit", type=int, default=400_000, help="предел токенов на прогон")
    ap.add_argument("--probe-limit", type=int, default=5, help="сколько новых кандидатов в источники проверять за прогон")
    ap.add_argument("--delay", type=float, default=2.0, help="пауза между запросами к одному сайту, с")
    ap.add_argument("--learn-min-new", type=int, default=15, help="новых решений редактора для калибровки")
    ap.add_argument("--calibrate", action="store_true", help="пересчитать поправки и профиль вкуса сейчас")
    ap.add_argument("--judge", nargs=3, metavar=("ПРОГОН", "ИСТОРИЯ", "yes|no"), help="решение по истории")
    ap.add_argument("--out", default=str(ROOT / "out"), help="папка прогонов")
    g = ap.add_argument_group("кандидаты в источники")
    g.add_argument("--candidates", action="store_true", help="показать кандидатов")
    g.add_argument("--propose", metavar="URL", help="предложить сайт: проверить и оценить")
    g.add_argument("--include", metavar="ДОМЕН", help="включить кандидата в обход")
    g.add_argument("--once", metavar="ДОМЕН", help="полезен разово, в обход не включать")
    g.add_argument("--reject", metavar="ДОМЕН", help="отклонить кандидата")
    g.add_argument("--note", help="пояснение к предложению или решению")
    ap.add_argument("--publish-now", nargs="*", metavar="ИСТОРИЯ",
                    help="с --prepare: опубликовать готовое сейчас, не дожидаясь слота (all — всё готовое в стеке)")
    ap.add_argument("--prepare", action="store_true",
                    help="подготовить новости из стека: перевод, текст, сверка (cron каждую минуту)")
    args = ap.parse_args()

    if args.candidates or args.propose or args.include or args.once or args.reject:
        return candidates_command(args)
    if args.calibrate or args.judge:
        return learn_command(args)
    if args.prepare:
        return prepare_command(args)

    run = pipeline.run(args)
    path = run.dir / "report.html"
    path.write_text(report.build(run), encoding="utf-8")
    print(f"\nОтчёт: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
