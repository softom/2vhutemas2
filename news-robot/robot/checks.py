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


def _norm(text: str) -> str:
    text = re.sub(r"[“”«»„\"’‘']", "", text or "")
    return re.sub(r"\s+", " ", text).strip().lower()


def check(news: dict, facts: dict, article: str = "", genre: str = "news") -> list[str]:
    issues: list[str] = []
    # Цитата обязана быть в статье дословно: иначе это пересказ, выданный за прямую речь (Р-98).
    source = _norm(article)
    for q in facts.get("quotes") or []:
        original = _norm(q.get("original", ""))
        if source and original and original not in source:
            issues.append("цитата не найдена в статье дословно: " + q.get("original", "")[:90])
    if genre == "interview":
        body_all = " ".join([news.get("lead", "")] + list(news.get("paragraphs", [])))
        # Вне кавычек — ни одного глагола, приписывающего герою мнение (Р-98).
        outside = re.sub(r"«[^»]*»|“[^”]*”|\([^)]*перевод Вх²[^)]*\)", " ", body_all.lower())
        stems = ("по её мнению", "по его мнению", "считает", "думает", "уверен", "полагает", "размышля", "рассужда",
                 "объясняет", "подчёркивает", "подчеркивает", "пересматрива", "оспарива", "находит", "смещает",
                 "призывает", "критикует", "ставит под вопрос", "утверждает")
        found = [s for s in stems if s in outside]
        if found:
            issues.append("интервью: пересказ речи героя вне цитат (" + ", ".join(found) + ") — только дословные цитаты")
        if facts.get("quotes") and "перевод Вх²" not in body_all:
            issues.append("интервью: цитаты без пометки «перевод Вх²» и оригинала")
    body = " ".join([news.get("lead", "")] + list(news.get("paragraphs", [])))
    n = words(body)
    low_n, high_n = (120, 220) if genre == "interview" else (150, 250)
    if not low_n <= n <= high_n:
        issues.append(f"объём {n} слов, нужно {low_n}–{high_n}")
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
    # По началу слова: «лучш» — это «лучший», а не «улучшения».
    hits = [w for w in EVALUATIVE if re.search(r"(?<![а-яё])" + w, low)]
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
