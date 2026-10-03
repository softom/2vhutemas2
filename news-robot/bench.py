"""Стенд: совпадает ли отбор LLM с выбором редактора на размеченном блоке.

Первый блок 2026-09-24…10-01: 38 историй, редактор выбрал 21 (WIKI/Новости —
источники и первый блок.md, раздел 4). Честная проверка — две половины:
модель оценивает одну, видя образцами решения редактора только по другой,
затем наоборот. Мера — AUC (вероятность, что выбранная история оценена выше
отклонённой; 0,5 — случайно, 1 — идеально) и попадание: из 21 лучших по
оценке модели сколько выбрал редактор.

    python news-robot/bench.py --model deepseek/deepseek-v4-pro --reasoning off
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
ROOT = Path(__file__).resolve().parent

from run import load_env  # noqa: E402  (заодно читает news-robot/.env)
from robot import pipeline  # noqa: E402
from robot.llm import LLM, prompt  # noqa: E402

# № · оценка «значимости» при исследовании · тема · заголовок · суть · выбрал ли редактор
BLOCK = [
    (1, 88, "А", "Цумтор: три павильона для Fondation Beyeler", "Рядом со зданием Ренцо Пиано (1997) в парке встали три павильона; один из них — галерея из трамбованного бетона.", True),
    (2, 85, "А", "Фаршид Муссави — медаль Соуна 2026", "Десятый лауреат премии за вклад в архитектуру постройками, преподаванием и текстами; профессор Harvard GSD.", True),
    (3, 85, "П", "Autodesk University 2026: агентный ИИ, Forma, Fusion", "Облачные платформы и ИИ-агенты; Autodesk подтвердила, что Forma со временем заменит Revit.", True),
    (4, 80, "Н", "AMD покупает World Labs за $8,2 млрд", "World Labs генерирует трёхмерные миры по запросу — «пространственный интеллект».", False),
    (5, 78, "А", "MAD: музей Лукаса в Лос-Анджелесе открыт", "Здание Ма Янсуна в Экспозишн-парке для коллекции Джорджа Лукаса.", True),
    (6, 78, "А", "Herzog & de Meuron: студенческий центр на старом каркасе", "Новое здание колледжа Амхерст стоит на бетонном каркасе бруталистского корпуса, надстройка — из массивной древесины.", True),
    (7, 75, "П", "Veras 5.2: из ИИ-картинки — редактируемая модель", "Результат генерации превращается в объекты модели Revit, SketchUp или Rhino, а не остаётся изображением.", True),
    (8, 72, "Н", "CartesianForms — конкурс ИИ-архитектуры", "Международный конкурс FORMAS.AI и PAACADEMY, есть студенческие категории; подача до 13.12.", True),
    (9, 70, "А", "Ретроспектива Джеффри Бавы в Vitra Design Museum", "«Architecture for the Senses» — тропический модернизм Шри-Ланки, до 28.02.2027.", False),
    (10, 68, "А", "Музей дизайна в Генте: крыло из кирпича из отходов", "Пристройка на деревянном каркасе, облицовка — переработанный кирпич.", True),
    (11, 65, "А", "Облицовка из отходов шерсти", "Гарвардская группа показала утепляющую плитку для реконструкций на Триеннале в Осло.", True),
    (12, 65, "А", "Склад в Аккре стал школой Лесли Локко", "Бывший склад плитки — постоянный дом African Futures Institute, независимой архитектурной школы.", True),
    (13, 65, "П", "CSoft и «Ай-Джи-Эй Системы»: ИИ в ТИМ", "Соглашение о совместном развитии ИИ для проектирования, строительства и эксплуатации; продукта пока нет.", False),
    (14, 62, "Н", "SPOON: целостная 3D-сцена по обычным фото", "Метод собирает сгенерированные объекты в согласованную сцену по нескольким некалиброванным снимкам.", True),
    (15, 60, "А", "AIA против «триумфальной арки» в Вашингтоне", "Американский институт архитекторов выступил против арки у Memorial Circle.", False),
    (16, 60, "А", "Хезервик: исследование «скучной застройки»", "Кампания Humanise с Университетом Глазго, £1,5 млн — как облик улиц влияет на самочувствие.", True),
    (17, 60, "П", "Какие программы учить студенту-архитектору", "Разбор набора программ в бюро и три пути обучения. Пишет вендор (Chaos).", True),
    (18, 60, "Н", "Rhino через диалог с ChatGPT-6 Astra", "Анонс воркшопа: параметрическое моделирование голосом и текстом.", True),
    (19, 58, "А", "Копенгагенская биеннале: тема и даты", "Второй выпуск биеннале архитектуры, выросшей из фестиваля CAFx.", True),
    (20, 58, "Н", "Waypoint-1.5: интерактивная «модель мира» на домашней видеокарте", "Генерация видео в реальном времени с управлением клавиатурой и мышью.", False),
    (21, 55, "А", "Мурманск ищет дорогу к воде", "Проекты выхода города к воде: краб, верфь, маяки.", False),
    (22, 55, "А", "World Monuments Fund: главная угроза наследию", "Доклад фонда о том, что сильнее всего угрожает памятникам.", True),
    (23, 55, "А", "9-я Триеннале архитектуры в Осло", "Открытие триеннале и её тема.", False),
    (24, 55, "П", "Языковая модель на BIM-ноутбуке", "Проверка: потянет ли ноутбук локальную ИИ-модель вместе с BIM — без облака.", False),
    (25, 55, "П", "Cinema 4D: ИИ-агенты управляют программой", "Maxon выпустил MCP-сервер — рутину можно отдавать ИИ-агенту.", False),
    (26, 55, "П", "Raven AI 2 для Rhino и Grasshopper", "ИИ-ассистент с управлением на естественном языке; выпуск — на вебинаре 7.10.", True),
    (27, 55, "Н", "Gaussian Stippling: сплаты без сортировки", "Ускоряет показ 3D-сканов (Gaussian Splatting) в реальном времени.", False),
    (28, 52, "Н", "BTC3D: детали при генерации 3D из картинки", "Сохраняет мелкие детали в image-to-3D без переобучения модели.", False),
    (29, 50, "А", "Populous: национальный стадион Вьетнама на 70 тыс.", "Проект большого стадиона.", True),
    (30, 45, "П", "Rayon привлёк €10 млн", "Браузерная САПР обещает переход из 2D в 3D и ИИ-агентов.", False),
    (31, 45, "Н", "Звук в сгенерированных 3D-мирах", "Пространственно привязанный звук без обучения.", False),
    (32, 45, "Н", "3D-ассеты: ChatGPT пишет скрипты для Blender", "Любительский эксперимент, но приём доступен студентам.", True),
    (33, 42, "Н", "BrickGPT: устойчивые конструкции из LEGO по тексту", "Разбор модели, генерирующей физически устойчивые сборки.", False),
    (34, 35, "Н", "Можно ли хорошо спроектировать дата-центр", "ИИ как заказчик архитектуры, а не инструмент.", False),
    (35, 35, "П", "SmartMenu для Rhino 8", "Меню команд у курсора по средней кнопке.", True),
    (36, 30, "П", "Global Mapper — подписка с тремя уровнями", "ГИС-продукты объединены в одну линейку.", False),
    (37, 30, "Н", "Трейлер-победитель Future Vision XPRIZE", "Роль ИИ-генерации по ленте не подтверждена.", False),
    (38, 20, "П", "Blender: 20 лет открытых фильмов", "Юбилей, практической новости нет.", True),
]


def auc(scores: list[tuple[float, bool]]) -> float:
    pos = [s for s, y in scores if y]
    neg = [s for s, y in scores if not y]
    wins = sum(1.0 if p > n else 0.5 if p == n else 0.0 for p in pos for n in neg)
    return wins / (len(pos) * len(neg))


def hits(scores: list[tuple[float, bool]], k: int) -> int:
    return sum(1 for _, y in sorted(scores, key=lambda x: -x[0])[:k] if y)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="deepseek/deepseek-v4-pro")
    ap.add_argument("--reasoning", choices=["off", "low", "default"], default="off")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--learned", action="store_true",
                    help="перед оценкой половины выучить профиль вкуса по решениям другой половины (prompts/calibrate.md)")
    args = ap.parse_args()
    cfg = pipeline.load_config()
    extra = {"off": {"reasoning": {"enabled": False}}, "low": {"reasoning": {"effort": "low"}}, "default": {}}[args.reasoning]
    out = ROOT / "out" / "bench"
    llm = LLM(cfg.get("news.llm.base_url"), args.model, cfg.get("news.llm.api_key_env") or "POLZA_API_KEY",
              out / "llm", token_limit=400_000, extra=extra)
    items = list(BLOCK)
    random.Random(args.seed).shuffle(items)
    folds = [items[0::2], items[1::2]]
    result: dict[int, dict] = {}
    profiles: list[str] = []
    for i, test in enumerate(folds):
        train = folds[1 - i]
        examples = "\n".join(f"{'ДА' if y else 'НЕТ'} — {t}" for _, _, _, t, _, y in train)
        profile = pipeline.profile_text(None)
        if args.learned:
            decisions = [{"выбор": "ДА" if y else "НЕТ", "заголовок": t, "суть": s} for _, _, _, t, s, y in train]
            learned = llm.chat_json("calibrate", prompt("calibrate", current=profile,
                                                        decisions=json.dumps(decisions, ensure_ascii=False, indent=1)),
                                    "Опиши вкус редактора.", max_tokens=8000)
            profile = learned.get("profile_text") or profile
            profiles.append(profile)
        system = prompt("triage", examples=examples, profile=profile)
        payload = [{"id": str(n), "source": "", "date": "", "title": t, "summary": s, "url": ""}
                   for n, _, _, t, s, _ in test]
        resp = llm.chat_json("bench", system, "Материалы:\n" + json.dumps(payload, ensure_ascii=False, indent=1),
                             max_tokens=16000)
        for rec in resp.get("items", []):
            result[int(rec["id"])] = rec
    model_scores = [(float(result.get(n, {}).get("interest") or 0), y) for n, _, _, _, _, y in BLOCK]
    base_scores = [(float(s), y) for _, s, _, _, _, y in BLOCK]
    k = sum(1 for *_, y in BLOCK if y)
    report = {
        "model": args.model, "reasoning": args.reasoning, "rated": len(result),
        "auc_model": round(auc(model_scores), 3), "auc_research": round(auc(base_scores), 3),
        f"hits_top{k}_model": hits(model_scores, k), f"hits_top{k}_research": hits(base_scores, k),
        "hits_top3_model": hits(model_scores, 3), "tokens": llm.used, "learned": args.learned,
        "profiles": profiles,
        "items": [{"n": n, "chosen": y, "model": result.get(n, {}).get("interest"), "research": s, "title": t,
                   "reason": result.get(n, {}).get("reason")} for n, s, _, t, _, y in BLOCK],
    }
    out.mkdir(parents=True, exist_ok=True)
    name = f"{args.model.split('/')[-1]}-{args.reasoning}{'-learned' if args.learned else ''}.json"
    (out / name).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k2: v for k2, v in report.items() if k2 != "items"}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    load_env(ROOT / ".env")
    sys.exit(main())
