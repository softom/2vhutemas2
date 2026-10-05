"""Публикатор: черновик записи «Новость» и публикация в слот (Р-102).

Решение пользователя 2026-10-03: робот полностью готовит новость и оставляет
её черновиком; по таймеру публикатор переводит черновик в «опубликовано»;
главная показывает опубликованные по порядку. Публикатор — задача робота.

Работает в минутном задании после подготовки (run.py --prepare), только через
наш API под участником «Робот новостей» (токен NEWS_ROBOT_TOKEN, роль editor):

1. Готовая новость из стека без записи → черновик: POST /entities (тип news,
   текст, сведения), фото — POST /media (автор, источник, подпись — сведения
   изображения), POST /media/attachments (иллюстрация).
2. Слот в стеке изменился → сведения выхода у черновика обновляются.
3. Наступил слот (МСК) → POST /entities/{id}/publish. Пропущенное выходит
   при следующем запуске по порядку.

Номер записи и ход публикации — в .state/prepared/<история>.json.
"""

from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from .fetch import USER_AGENT

MSK = timezone(timedelta(hours=3))
TRANSLIT = dict(zip("абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
                    ["a", "b", "v", "g", "d", "e", "e", "zh", "z", "i", "y", "k", "l", "m", "n", "o", "p", "r", "s",
                     "t", "u", "f", "kh", "ts", "ch", "sh", "shch", "", "y", "", "e", "yu", "ya"]))


class ApiFailure(Exception):
    pass


def slugify(title: str, key: str) -> str:
    base = "".join(TRANSLIT.get(ch, ch) for ch in title.lower())
    base = re.sub(r"[^a-z0-9]+", "-", base).strip("-")[:70].strip("-")
    return f"{base or key}-{uuid.uuid4().hex[:4]}"


def _read(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _write(path: Path, data) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)


class Api:
    def __init__(self):
        self.base = os.environ.get("NEWS_API_BASE", "http://api:8000/api/v1").rstrip("/")
        token = os.environ.get("NEWS_ROBOT_TOKEN") or os.environ.get("VHUTEMAS_TOKEN")
        self.live = bool(token)
        self.client = httpx.Client(timeout=120, headers={"Authorization": f"Bearer {token}"} if token else {})

    def call(self, method: str, path: str, **kw) -> dict:
        r = self.client.request(method, self.base + path, **kw)
        if r.status_code >= 400:
            try:
                err = r.json().get("error", {})
                msg = f"{err.get('code')}: {err.get('message')}"
            except ValueError:
                msg = r.text[:200]
            raise ApiFailure(f"{method} {path} → {r.status_code} {msg}")
        return r.json() if r.content else {}


def _text(text: str) -> list[dict]:
    return [{"type": "text", "text": text, "styles": {}}]


def _paragraph(content: list[dict]) -> dict:
    return {"id": uuid.uuid4().hex[:12], "type": "paragraph", "props": {}, "content": content, "children": []}


def body_blocks(news: dict, sources: list[dict]) -> list[dict]:
    """Текст новости блоками BlockNote: лид, абзацы, строка «где подробности», первоисточники ссылками."""
    blocks = []
    if news.get("lead"):
        blocks.append(_paragraph([{"type": "text", "text": news["lead"], "styles": {"bold": True}}]))
    blocks += [_paragraph(_text(p)) for p in news.get("paragraphs", []) if p.strip()]
    if news.get("more"):
        blocks.append(_paragraph(_text(news["more"])))
    links = []
    for s in sources:
        if s.get("url") and s["url"] not in [x["url"] for x in links]:
            links.append(s)
    if links:
        content: list[dict] = _text("Первоисточник: ")
        for i, s in enumerate(links[:4]):
            if i:
                content += _text(" · ")
            content.append({"type": "link", "href": s["url"], "content": _text(s.get("title") or s.get("source") or
                                                                                urlsplit(s["url"]).netloc)})
        blocks.append(_paragraph(content))
    return blocks


def indicators(rec: dict, q: dict) -> list[dict]:
    story = rec.get("story") or {}
    cand = story.get("candidate") or {}
    src = (cand.get("sources") or [{}])[0]
    release = datetime.strptime(q["date"], "%Y-%m-%d")
    values = [
        {"parameter": "url", "text_value": src.get("url")},
        {"parameter": "news_score", "num_value": cand.get("final"), "note": cand.get("reason")},
        {"parameter": "news_release", "date_start_year": release.year, "date_start_month": release.month,
         "date_start_day": release.day},
        {"parameter": "news_release_time", "text_value": q["time"]},
    ]
    if cand.get("topic") in ("architecture", "neurogeneration", "software"):
        values.append({"parameter": "news_topic", "option": cand["topic"]})
    if src.get("date") and re.match(r"\d{4}-\d{2}-\d{2}", src["date"]):
        d = datetime.strptime(src["date"][:10], "%Y-%m-%d")
        values.append({"parameter": "publication", "date_start_year": d.year, "date_start_month": d.month,
                       "date_start_day": d.day})
    return [{"title": "Сведения", "is_current": True, "values": [v for v in values if any(
        x is not None for k, x in v.items() if k not in ("parameter", "note"))]}]


# ── Проекты и авторы из новости (Р-106) ─────────────────────────────────────

def _norm(s: str | None) -> str:
    return re.sub(r"[^a-zа-яё0-9]+", " ", (s or "").lower()).strip()


def find_entity(api: Api, names: list[str], branch: str) -> dict | None:
    """Запись с таким названием в ветви (what/who): по названию по-русски или в оригинале."""
    wanted = {_norm(n) for n in names if n and len(_norm(n)) >= 3}
    for name in [n for n in names if n]:
        try:
            res = api.call("GET", "/entities", params={"q": name[:80], "type": branch, "limit": 20})
        except ApiFailure:
            continue
        for it in res.get("items", []):
            titles = {_norm(it.get(k)) for k in ("title_ru", "title_original", "title_en")} - {""}
            if titles & wanted:
                return it
    return None


def _paragraph_text(text: str, source_url: str | None, source_title: str | None) -> list[dict]:
    blocks = [_paragraph(_text(text))]
    if source_url:
        blocks.append(_paragraph(_text("Источник: ") + [{"type": "link", "href": source_url,
                                                            "content": _text(source_title or source_url)}]))
    return blocks


def link_entities(api: Api, llm, rec: dict, log) -> list[dict]:
    """Главный проект и его авторы: найти в базе или завести черновики; связь «архитектор».

    Возвращает упоминания для текста новости: [{"text", "entity_id", "title"}].
    Заведённое роботом публикуется вместе с новостью (publish), иначе ссылка вела бы в пустоту.
    """
    from .llm import LLMError, prompt
    story = rec["story"]
    cand = story.get("candidate") or {}
    src = (cand.get("sources") or [{}])[0]
    try:
        found = llm.chat_json("entities", prompt("entities", facts=json.dumps(story.get("facts") or {}, ensure_ascii=False),
                                                 news=json.dumps(story.get("news") or {}, ensure_ascii=False)),
                              "Найди проект и авторов.", max_tokens=4000)
    except LLMError as e:
        log("warn", "entities", "проекты и авторы не определены", story=rec["story_key"], error=str(e)[:150])
        return []
    made = rec.setdefault("entities", {"created": [], "links": [], "used": []})
    refs: dict[str, dict] = {}
    project = found.get("project") or None
    if project and project.get("title_ru"):
        hit = find_entity(api, [project.get("title_ru"), project.get("title_original")], "what")
        if hit:
            refs["project"] = {"id": hit["id"], "title": hit.get("title_ru")}
        else:
            kind = project.get("kind") if project.get("kind") in ("architecture_object", "environment_object",
                                                                    "competition_entry") else "architecture_object"
            created = api.call("POST", "/entities", json={
                "type": kind, "slug": slugify(project["title_ru"], "proekt"), "title_ru": project["title_ru"],
                "title_original": project.get("title_original") or None,
                "body_json": _paragraph_text(project.get("description") or "", src.get("url"), src.get("source")),
            })
            refs["project"] = {"id": created["id"], "title": project["title_ru"]}
            made["created"].append({"id": created["id"], "kind": kind, "title": project["title_ru"]})
            log("info", "entities", "проект заведён", story=rec["story_key"], entity=created["id"], title=project["title_ru"])
    for i, a in enumerate(found.get("authors") or []):
        if not a.get("name_ru"):
            continue
        hit = find_entity(api, [a.get("name_ru"), a.get("name_original")], "who")
        if hit:
            ref = {"id": hit["id"], "title": hit.get("title_ru")}
        else:
            kind = "person" if a.get("kind") == "person" else "company"
            created = api.call("POST", "/entities", json={
                "type": kind, "slug": slugify(a["name_ru"], "avtor"), "title_ru": a["name_ru"],
                "title_original": a.get("name_original") or None,
                "body_json": _paragraph_text(
                    f"{'Архитектурное бюро' if kind == 'company' else 'Архитектор'}"
                    + (f", автор проекта «{project['title_ru']}»." if project and project.get("title_ru") else "."),
                    src.get("url"), src.get("source")),
            })
            ref = {"id": created["id"], "title": a["name_ru"]}
            made["created"].append({"id": created["id"], "kind": kind, "title": a["name_ru"]})
            log("info", "entities", "автор заведён", story=rec["story_key"], entity=created["id"], title=a["name_ru"])
        refs[f"author:{i}"] = ref
        # Связь «архитектор»: от автора к проекту, как в базе; основание — первоисточник.
        # Если и проект, и автор уже были в базе, связь между ними, скорее всего, есть — не дублируем.
        new_project = refs.get("project") and any(c["id"] == refs["project"]["id"] for c in made["created"])
        if refs.get("project") and (not hit or new_project):
            try:
                link = api.call("POST", "/links", json={
                    "from_entity_id": ref["id"], "to_entity_id": refs["project"]["id"], "role": "architect",
                    "justification": {"text": f"По данным: {src.get('source') or 'первоисточник'} — {src.get('url') or ''}"},
                })
                made["links"].append(link["id"])
            except ApiFailure as e:
                log("warn", "entities", "связь не создана", story=rec["story_key"], error=str(e)[:150])
    made["used"] = [{"ref": k, **v} for k, v in refs.items()]
    mentions = []
    for m in found.get("mentions") or []:
        ref = refs.get(m.get("ref", ""))
        if ref and m.get("text"):
            mentions.append({"text": m["text"], "entity_id": ref["id"], "title": ref["title"]})
    return mentions


def apply_mentions(blocks: list[dict], mentions: list[dict]) -> list[dict]:
    """Первое вхождение каждого фрагмента в тексте — упоминание записи (entityMention, Р-23)."""
    for m in mentions:
        for block in blocks:
            content = block.get("content") or []
            for i, item in enumerate(content):
                if item.get("type") != "text" or m["text"] not in item.get("text", ""):
                    continue
                before, _, after = item["text"].partition(m["text"])
                styles = item.get("styles", {})
                parts = []
                if before:
                    parts.append({"type": "text", "text": before, "styles": styles})
                parts.append({"type": "entityMention", "props": {"entityId": str(m["entity_id"]),
                              "occurrenceId": str(uuid.uuid4()), "title": m["text"]}})
                if after:
                    parts.append({"type": "text", "text": after, "styles": styles})
                block["content"] = content[:i] + parts + content[i + 1:]
                break
            else:
                continue
            break
    return blocks


def create_draft(api: Api, rec: dict, q: dict, log, llm=None) -> None:
    story = rec["story"]
    news = story.get("news") or {}
    cand = story.get("candidate") or {}
    sources = [*(news.get("sources") or []), *(cand.get("sources") or [])]
    title = (news.get("title") or cand.get("title_ru") or rec["story_key"]).strip()
    blocks = body_blocks(news, sources)
    if llm is not None and getattr(llm, "live", False):
        try:
            blocks = apply_mentions(blocks, link_entities(api, llm, rec, log))
        except ApiFailure as e:
            log("warn", "entities", "проекты и авторы не связаны", story=rec["story_key"], error=str(e)[:150])
    created = api.call("POST", "/entities", json={
        "type": "news", "slug": slugify(title, rec["story_key"]), "title_ru": title,
        "body_json": blocks, "indicators": indicators(rec, q),
    })
    rec["entity_id"] = created["id"]
    rec["revision_id"] = created.get("revision_id")
    rec["draft_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rec["release_slot"] = f"{q['date']} {q['time']}"
    log("info", "publish", "черновик записи создан", story=rec["story_key"], entity=created["id"])
    # Фото: копия к нам (Р-90), автор и источник — в сведениях изображения (Р-68).
    article_url = (cand.get("sources") or [{}])[0].get("url")
    attached = 0
    with httpx.Client(timeout=60, follow_redirects=True, headers={"User-Agent": USER_AGENT}) as http:
        for im in (news.get("images") or [])[:3]:
            try:
                r = http.get(im["url"])
                r.raise_for_status()
                mime = r.headers.get("content-type", "image/jpeg").split(";")[0]
                if not mime.startswith("image/"):
                    continue
                name = urlsplit(im["url"]).path.rsplit("/", 1)[-1] or "image.jpg"
                caption = (im.get("caption") or title)[:300]
                form = {"caption": caption, "original_caption": im.get("caption") or "",
                        "source_url": article_url or im["url"], "visibility": "public"}
                if im.get("credit"):
                    form["author"] = str(im["credit"])[:200]
                asset = api.call("POST", "/media", files={"file": (name, r.content, mime)}, data=form)
                asset_id = asset.get("id") or asset.get("asset_id")
                api.call("POST", "/media/attachments", json={"entity_id": rec["entity_id"], "asset_id": asset_id})
                attached += 1
            except (httpx.HTTPError, ApiFailure) as e:
                log("warn", "publish", "фото не загружено", story=rec["story_key"], url=im.get("url", "")[:120],
                    error=str(e)[:200])
    rec["images_attached"] = attached


def update_release(api: Api, rec: dict, q: dict, log) -> None:
    res = api.call("PUT", f"/entities-indicators/{rec['entity_id']}", json={"indicators": indicators(rec, q)})
    rec["revision_id"] = res.get("revision_id") or rec.get("revision_id")
    rec["release_slot"] = f"{q['date']} {q['time']}"
    log("info", "publish", "слот выхода обновлён", story=rec["story_key"], slot=rec["release_slot"])


def publish(api: Api, rec: dict, log) -> None:
    # Сначала заведённые роботом проект и авторы со связями: ссылки новости не должны вести в пустоту (Р-106).
    made = rec.get("entities") or {}
    for e in made.get("created", []):
        if not e.get("published"):
            api.call("POST", f"/entities/{e['id']}/publish", json={"note": "Робот новостей: вместе с новостью"})
            e["published"] = True
    for link_id in made.get("links", []):
        try:
            api.call("POST", f"/links/{link_id}/publish", json={"note": "Робот новостей: вместе с новостью"})
        except ApiFailure as e:
            log("warn", "publish", "связь не опубликована", story=rec["story_key"], error=str(e)[:150])
    res = api.call("POST", f"/entities/{rec['entity_id']}/publish", json={"note": "Робот новостей: выход в слот"})
    rec["published_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rec["publication"] = "вышла"
    rec["published_revision_id"] = res.get("published_revision_id")
    log("info", "publish", "новость опубликована", story=rec["story_key"], entity=rec["entity_id"])


def run(root: Path, log, now_all: bool = False, only: set[str] | None = None, llm=None) -> int:
    """Черновики, слоты, публикация. now_all — опубликовать готовое сейчас, не дожидаясь слота."""
    api = Api()
    if not api.live:
        log("warn", "publish", "нет токена робота (NEWS_ROBOT_TOKEN) — публикатор не работает")
        return 0
    queue = (_read(root / "inbox" / "queue.json") or {}).get("items", [])
    pdir = root / ".state" / "prepared"
    now_msk = datetime.now(MSK).strftime("%Y-%m-%d %H:%M")
    done = 0
    for q in sorted(queue, key=lambda i: (i["date"], i["time"])):
        key = q["story_key"]
        if only and key not in only:
            continue
        path = pdir / f"{key}.json"
        rec = _read(path)
        if not rec or rec.get("status") != "готово" or rec.get("publication") == "вышла":
            continue
        try:
            if not rec.get("entity_id"):
                create_draft(api, rec, q, log, llm)
                rec["publication"] = "черновик"
                _write(path, rec)
                # Обложку выбрали до черновика — ставим первой сейчас (Р-107).
                if (rec.get("cover") or {}).get("chosen") and not rec["cover"].get("applied_at"):
                    from .cover import apply as apply_cover
                    v = next((x for x in rec["cover"].get("variants", []) if x["file"] == rec["cover"]["chosen"]), None)
                    if v:
                        apply_cover(root, rec, v, api, log)
                        _write(path, rec)
            elif rec.get("release_slot") != f"{q['date']} {q['time']}":
                update_release(api, rec, q, log)
                _write(path, rec)
            if now_all or f"{q['date']} {q['time']}" <= now_msk:
                publish(api, rec, log)
                _write(path, rec)
                done += 1
        except (ApiFailure, httpx.HTTPError) as e:
            rec["publication_error"] = str(e)[:300]
            _write(path, rec)
            log("error", "publish", "публикатор: ошибка", story=key, error=str(e)[:200])
    return done
