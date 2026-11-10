"""Category-isolated evaluation: no foreign criteria or examples in an evaluation request."""
import json
import re
from pathlib import Path
from .editorial import CATEGORIES, HEADINGS, category_of, section_profile
from .llm import LLMError

NAMES = dict(zip(["architecture", "software", "ai", "competitions", "site", "knowledge"], HEADINGS[1:]))
ROOT = Path(__file__).resolve().parents[1]
CLASSIFIER = 'Определи только категорию материала, без оценки ценности и редакторского вкуса. category: architecture — архитектура; software — ПО; ai — ИИ (включая исследования ИИ); competitions — конкурс (важнее его темы); site — публикация самого Вх²; knowledge — исследования/знания, включая искусствоведение; unclassified — неясно. Ответ JSON {"items":[{"id":"исходный id","category":"код"}]}. Один результат на каждый id.'

def sections(text):
    result = {}; current = "Общие правила"
    for line in section_profile(text).splitlines():
        if line.startswith("## "):
            current = line[3:]; result.setdefault(current, [])
        else: result.setdefault(current, []).append(line)
    return {k: "\n".join(v).strip() for k, v in result.items()}

def scoped_profile(text, category):
    parts = sections(text)
    return "\n\n".join("## " + name + "\n" + parts.get(name, "") for name in ["Общие правила", NAMES[category]])

def replace_profile(text, category, body):
    parts = sections(text); parts[NAMES[category]] = re.sub(r"(?m)^## ", "### ", body)
    return "\n\n".join("## " + name + "\n" + value for name, value in parts.items())

def template_for(state, category):
    learned = (state.data.get("learned") or {}) if state else {}
    return (learned.get("category_prompts") or {}).get(category) or (ROOT / "prompts" / "categories" / (category + ".md")).read_text(encoding="utf-8")

def render(template, profile, examples, category):
    return template.replace("{{profile}}", scoped_profile(profile, category)).replace("{{examples}}", examples).replace("{{category}}", category)

def examples_for(state, category):
    if state is None: return "Нет оценённых примеров этой категории."
    items = [j for j in state.data.get("judgments", {}).values() if category_of(j) == category and not j.get("moment_only")]
    items.sort(key=lambda j:j.get("at", ""), reverse=True)
    return json.dumps([{ "выбор":j.get("verdict"), "заголовок":j.get("title"), "причина":j.get("note"), "проверенные доводы":[c for c in j.get("claims", []) if c.get("verdict") in ("true", "false")]} for j in items[:30]], ensure_ascii=False)

def build(state, profile, category):
    return render(template_for(state, category), profile, examples_for(state, category), category)

def snapshots(state, profile):
    return {category:{"title":title,"template":template_for(state,category),"profile":sections(profile).get(title,""),"full_prompt":build(state,profile,category)} for category,title in NAMES.items()}

def evaluate(llm, payload, state, profile, known=None, stage="triage"):
    known = known or {}; assigned = {}; unresolved = []
    for item in payload:
        category = category_of(known.get(item["id"], {}))
        if category in CATEGORIES: assigned[item["id"]] = category
        else: unresolved.append(item)
    if unresolved:
        result = llm.chat_json("classify", CLASSIFIER, json.dumps(unresolved,ensure_ascii=False), max_tokens=4000)
        valid = {p["id"] for p in unresolved}
        for rec in result.get("items",[]):
            if rec.get("id") in valid and rec.get("category") in CATEGORIES: assigned[rec["id"]] = rec["category"]
    results=[]
    for category in NAMES:
        group = [p for p in payload if assigned.get(p["id"]) == category]
        if not group: continue
        result = llm.chat_json(stage+"-"+category, build(state,profile,category), json.dumps(group,ensure_ascii=False),max_tokens=16000)
        valid = {p["id"] for p in group}; seen=set()
        for rec in result.get("items",[]):
            if rec.get("id") in valid and rec["id"] not in seen:
                rec["category"]=category;results.append(rec);seen.add(rec["id"])
    # Неопределённое не превращается в редакторский отказ и не получает выдуманную категорию.
    return {"items":results}
