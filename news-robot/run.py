"""Робот новостей Вх² — запуск прогона.

    python news-robot/run.py --no-llm                 # только сбор: какие ленты живы, что нового
    python news-robot/run.py                          # вся цепочка; ключ — в POLZA_API_KEY
    python news-robot/run.py --since 2026-09-28 --ignore-seen --top 5

Ключ LLM берётся только из окружения (имя — news.llm.api_key_env), модель —
из --model, NEWS_LLM_MODEL или news.llm.model. Без ключа цепочка
останавливается после сбора и сохраняет готовые запросы отбора в out/<прогон>/llm/.
Описание — WIKI/Новости — робот: цепочка и промпты.md.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from robot import pipeline, report  # noqa: E402


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
    ap.add_argument("--threshold", type=int, default=50, help="минимальный интерес для текста")
    ap.add_argument("--token-limit", type=int, default=400_000, help="предел токенов на прогон")
    ap.add_argument("--delay", type=float, default=2.0, help="пауза между запросами к одному сайту, с")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent / "out"), help="папка прогонов")
    args = ap.parse_args()

    run = pipeline.run(args)
    path = run.dir / "report.html"
    path.write_text(report.build(run), encoding="utf-8")
    print(f"\nОтчёт: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
