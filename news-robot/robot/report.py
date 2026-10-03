"""Отчёт прогона: что прочитано, что отобрано, какие новости написаны.

Это прообраз экрана «Новости — отбор» (WIKI/Новости.md, раздел 5):
редактор видит кандидатов по убыванию оценки и готовые тексты с замечаниями.
"""

from __future__ import annotations

import html
from collections import Counter

from .pipeline import Run

TOPIC = {"architecture": "Архитектура", "neurogeneration": "Нейрогенерация", "software": "ПО"}

CSS = """
:root{--bg:#f6f5f1;--fg:#1b1b19;--mut:#6b6a64;--line:#dcdad2;--card:#fff;--warn:#8a5a00;--bad:#a32d2d}
@media (prefers-color-scheme:dark){:root{--bg:#151514;--fg:#ecebe6;--mut:#9c9a93;--line:#33322f;--card:#1e1e1c;--warn:#e0a54a;--bad:#f09595}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,sans-serif}
main{max-width:980px;margin:0 auto;padding:16px}
h1{font-size:22px;font-weight:500} h2{font-size:18px;font-weight:500;margin-top:32px}
.m{color:var(--mut);font-size:13px} a{color:inherit}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:12px 0}
.stats div{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px}
.stats b{display:block;font-size:22px;font-weight:500}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px} th,td{border-top:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{color:var(--mut);font-weight:400}
article{background:var(--card);border:1px solid var(--line);border-radius:12px;margin:18px 0;padding:0 0 12px;overflow:hidden}
article>*{margin-left:18px;margin-right:18px} article img{width:100%;display:block}
figure{margin:0 0 10px} figcaption{font-size:12px;color:var(--mut);padding:4px 18px}
.warn{color:var(--warn);font-size:13px} .bad{color:var(--bad);font-size:13px}
details{font-size:13px} pre{white-space:pre-wrap;font-size:12px}
"""


def e(x) -> str:
    return html.escape(str(x or ""))


def build(r: Run) -> str:
    ok = sum(1 for f in r.feeds if not f["status"].startswith("ошибка"))
    parts = [f"<!doctype html><html lang=ru><head><meta charset=utf-8>"
             f"<meta name=viewport content='width=device-width,initial-scale=1'>"
             f"<title>Робот новостей — прогон {e(r.id)}</title><style>{CSS}</style></head><body><main>",
             f"<h1>Робот новостей — прогон {e(r.id)}</h1>",
             f"<p class=m>Материалы с {e(r.since.strftime('%d.%m.%Y %H:%M'))} UTC. {e(r.llm_note)}</p>",
             "<div class=stats>",
             f"<div><b>{ok} / {len(r.feeds)}</b><span class=m>лент прочитано</span></div>",
             f"<div><b>{len(r.items)}</b><span class=m>новых материалов</span></div>",
             f"<div><b>{r.filtered_out}</b><span class=m>отсеяно фильтром</span></div>",
             f"<div><b>{len(r.candidates)}</b><span class=m>историй после отбора</span></div>",
             f"<div><b>{len(r.news)}</b><span class=m>новостей написано</span></div></div>"]

    if r.news:
        parts.append("<h2>Готовые новости</h2>")
        for st in r.news:
            n, c = st.get("news", {}), st["candidate"]
            imgs = n.get("images") or []
            parts.append("<article>")
            if imgs:
                parts.append(f"<figure style='margin:0 0 10px'><img src='{e(imgs[0].get('url'))}' loading=lazy>"
                             f"<figcaption>{e(imgs[0].get('caption'))}</figcaption></figure>")
            parts.append(f"<p class=m>{e(TOPIC.get(c.get('topic'), c.get('topic')))} · оценка {c['final']} "
                         f"(интерес {c['interest']}) · {e(c.get('reason'))}</p>")
            parts.append(f"<h2 style='margin-top:4px'>{e(n.get('title'))}</h2><p><b>{e(n.get('lead'))}</b></p>")
            parts += [f"<p>{e(p)}</p>" for p in n.get("paragraphs", [])]
            for im in imgs[1:]:
                parts.append(f"<figure><img src='{e(im.get('url'))}' loading=lazy>"
                             f"<figcaption>{e(im.get('caption'))}</figcaption></figure>")
            parts.append(f"<p><b>Что посмотреть студенту:</b> {e(n.get('student_note'))}</p>")
            src = " · ".join(f"<a href='{e(s['url'])}'>{e(s['source'])}, {e(s['date'])}</a>" for s in c["sources"])
            parts.append(f"<p class=m>Первоисточник: {src}</p>")
            if n.get("mentions"):
                parts.append("<p class=m>Упоминания: " + " · ".join(e(m.get("name")) for m in n["mentions"]) + "</p>")
            v = st.get("verify") or {}
            for label, key in (("Нет в фактах", "unsupported"), ("Искажено", "distorted"), ("Оценки", "evaluative")):
                for x in v.get(key) or []:
                    parts.append(f"<p class=bad>{label}: {e(x)}</p>")
            for x in st.get("issues", []) + st.get("warnings", []) + (n.get("warnings") or []):
                parts.append(f"<p class=warn>{e(x)}</p>")
            parts.append(f"<details><summary>Факты</summary><pre>{e(_facts(st.get('facts')))}</pre></details>")
            parts.append("</article>")

    if r.candidates:
        parts.append("<h2>Отбор на дату — по убыванию оценки</h2><div class=scroll><table>"
                     "<tr><th>#</th><th>Оценка</th><th>Тема</th><th>Материал</th><th>Почему</th></tr>")
        for i, c in enumerate(r.candidates, 1):
            src = "<br>".join(f"<a href='{e(s['url'])}'>{e(s['source'])}</a>" for s in c["sources"])
            flag = " · конкурс" + (" для студентов" if c.get("students_eligible") else "") if c.get("competition") else ""
            parts.append(f"<tr><td>{i}</td><td>{c['final']}<br><span class=m>{c['interest']}</span></td>"
                         f"<td>{e(TOPIC.get(c.get('topic'), c.get('topic')))}<br><span class=m>{e(c.get('kind'))}{e(flag)}</span></td>"
                         f"<td>{e(c['title_ru'])}<br><span class=m>{src}</span></td><td>{e(c.get('reason'))}</td></tr>")
        parts.append("</table></div>")
    elif r.items:
        parts.append("<h2>Новые материалы — до отбора</h2>")
        by = Counter(i.source_id for i in r.items)
        parts.append("<div class=scroll><table><tr><th>Источник</th><th>Дата</th><th>Материал</th></tr>")
        for it in sorted(r.items, key=lambda i: (i.source_id, i.published or ""), reverse=False):
            parts.append(f"<tr><td>{e(it.source_id)} <span class=m>({by[it.source_id]})</span></td>"
                         f"<td>{e((it.published or '')[:10])}</td><td><a href='{e(it.url)}'>{e(it.title)}</a></td></tr>")
        parts.append("</table></div>")

    parts.append("<h2>Ленты</h2><div class=scroll><table><tr><th>Источник</th><th>Состояние</th>"
                 "<th>В ленте</th><th>Новых</th><th>Свежий</th></tr>")
    for f in r.feeds:
        cls = " class=bad" if f["status"].startswith("ошибка") else ""
        parts.append(f"<tr><td><a href='{e(f['feed'])}'>{e(f['title'])}</a></td><td{cls}>{e(f['status'])}</td>"
                     f"<td>{f['items']}</td><td>{f['new']}</td><td>{e((f.get('newest') or '')[:10])}</td></tr>")
    parts.append("</table></div></main></body></html>")
    return "".join(parts)


def _facts(facts) -> str:
    if not facts:
        return ""
    lines = [("? " if f.get("uncertain") else "• ") + f.get("text", "") for f in facts.get("facts", [])]
    if facts.get("discrepancies"):
        lines += ["", "Расхождения:"] + [f"! {d}" for d in facts["discrepancies"]]
    return "\n".join(lines)
