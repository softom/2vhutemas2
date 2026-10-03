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


def create_draft(api: Api, rec: dict, q: dict, log) -> None:
    story = rec["story"]
    news = story.get("news") or {}
    cand = story.get("candidate") or {}
    sources = [*(news.get("sources") or []), *(cand.get("sources") or [])]
    title = (news.get("title") or cand.get("title_ru") or rec["story_key"]).strip()
    created = api.call("POST", "/entities", json={
        "type": "news", "slug": slugify(title, rec["story_key"]), "title_ru": title,
        "body_json": body_blocks(news, sources), "indicators": indicators(rec, q),
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
    res = api.call("POST", f"/entities/{rec['entity_id']}/publish", json={"note": "Робот новостей: выход в слот"})
    rec["published_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rec["publication"] = "вышла"
    rec["published_revision_id"] = res.get("published_revision_id")
    log("info", "publish", "новость опубликована", story=rec["story_key"], entity=rec["entity_id"])


def run(root: Path, log, now_all: bool = False, only: set[str] | None = None) -> int:
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
                create_draft(api, rec, q, log)
                rec["publication"] = "черновик"
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
