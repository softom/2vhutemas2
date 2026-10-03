"""Проверки готовой новости без LLM: объём, числа, подписи, оценки.

Число в тексте новости, которого нет в фактах, — главный признак
выдумки модели; его робот показывает редактору, а не исправляет сам.
"""

from __future__ import annotations

import re

EVALUATIVE = ["потрясающ", "уникальн", "невероятн", "революцион", "грандиозн", "великолепн",
              "шедевр", "сенсац", "впечатляющ", "поразительн", "лучш"]


def words(text: str) -> int:
    return len(re.findall(r"[\w\-]+", text))


def numbers(text: str) -> set[str]:
    found = set()
    for m in re.findall(r"\d[\d\s.,]*\d|\d", text):
        n = re.sub(r"[\s.,]", "", m)
        if len(n) >= 2 or m.isdigit():
            found.add(n)
    return found


def check(news: dict, facts: dict) -> list[str]:
    issues: list[str] = []
    body = " ".join([news.get("lead", "")] + list(news.get("paragraphs", [])))
    n = words(body)
    if not 150 <= n <= 250:
        issues.append(f"объём {n} слов, нужно 150–250")
    title = news.get("title", "")
    if len(title) > 100:
        issues.append(f"заголовок {len(title)} знаков, нужно до 90")
    facts_text = " ".join(f.get("text", "") for f in facts.get("facts", []))
    facts_text += " " + str(facts.get("competition") or "")
    extra = sorted(numbers(body + " " + title) - numbers(facts_text))
    # Однозначные числа и годы из даты статьи шумят — показываем только существенные.
    extra = [x for x in extra if len(x) >= 2]
    if extra:
        issues.append("числа без опоры в фактах: " + ", ".join(extra))
    low = (body + " " + title).lower()
    hits = [w for w in EVALUATIVE if w in low]
    if hits:
        issues.append("оценочные слова: " + ", ".join(hits))
    images = news.get("images") or []
    if not images:
        issues.append("нет фотографий")
    for im in images:
        if not im.get("credit"):
            issues.append("фото без автора — задача редактора (Р-68): " + im.get("url", "")[:80])
    if not news.get("student_note"):
        issues.append("нет блока «что посмотреть студенту»")
    return issues
