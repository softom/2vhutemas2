"""Обложки новостей, созданные ИИ (Р-107).

Решение пользователя 2026-10-04: у новости — кнопка «Создать обложку»; LLM готовит
промпт со стилистическими наставлениями (графика Юрия Анненкова к «Двенадцати» Блока,
1918) и показывает редактору; после его правки — генерация через Polza.AI;
«Поставить обложкой» делает картинку первой иллюстрацией новости. Для новостей
о зданиях обложки не генерируются: там свои снимки.

Запросы — inbox/covers/*.json (действия draft, generate, apply), обрабатывает
минутное задание. Картинки — .state/covers/<история>-<n>.<ext>, в записи
подготовки — rec["cover"]: промпт, варианты, выбранная.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

from .llm import LLM, LLMError, prompt

DEFAULT_MODEL = "google/gemini-3-pro-image-preview"
MODELS = [DEFAULT_MODEL, "google/gemini-3.1-flash-image", "black-forest-labs/flux.2-pro", "openai/gpt-image-1.5"]


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _read(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _write(path: Path, data) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)


def styles(root: Path) -> dict:
    """Круг художников (prompts/cover_styles.yaml, Р-108)."""
    import yaml
    return yaml.safe_load((root / "prompts" / "cover_styles.yaml").read_text(encoding="utf-8"))


def write_styles_snapshot(root: Path) -> None:
    """Снимок круга художников для сайта: API видит только .state, а не код робота."""
    data = styles(root)
    snap = {"groups": [{"key": g["key"], "title": g["title"], "task": g.get("task"),
                        "artists": [{k: a.get(k) for k in ("key", "name", "years", "take")} for a in g["artists"]]}
                       for g in data["groups"]]}
    path = root / ".state" / "cover_styles.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    _write(path, snap)


def _style_text(root: Path, style_key: str | None) -> tuple[str, list[dict]]:
    """Текст стиля для промпта и список художников на выбор LLM (если выбрана только группа)."""
    data = styles(root)
    artists = {a["key"]: a for g in data["groups"] for a in g["artists"]}
    if style_key and style_key.startswith("group:"):
        group = next((g for g in data["groups"] if g["key"] == style_key[6:]), data["groups"][0])
        options = "\n".join(f"- {a['key']}: {a['name']} — {a['take']}. Manner: {a['style']}" for a in group["artists"])
        return (f"Выбери ОДНОГО художника из группы «{group['title']}» ({group.get('task')}) — того, чьи приёмы лучше "
                f"всего передают суть новости, и верни его key в style_key:\n{options}\n\nОбщее:\n{data['common']}"
                ), group["artists"]
    a = artists.get(style_key or "annenkov") or artists["annenkov"]
    return f"Художник: {a['name']} ({a['years']}). Manner: {a['style']}\n\nОбщее:\n{data['common']}", [a]


def draft(root: Path, llm: LLM, rec: dict, style_key: str | None = None) -> dict:
    news = (rec.get("story") or {}).get("news") or {}
    brief = {k: news.get(k) for k in ("title", "lead", "paragraphs")}
    style, options = _style_text(root, style_key)
    out = llm.chat_json("cover", prompt("cover", style=style, news=json.dumps(brief, ensure_ascii=False)),
                        "Подготовь задание для обложки.", max_tokens=3000)
    chosen = next((a for a in options if a["key"] == out.get("style_key")), options[0])
    return {"idea_ru": out.get("idea_ru"), "prompt": out.get("prompt"), "alt_ru": out.get("alt_ru"),
            "model": DEFAULT_MODEL, "style_key": chosen["key"], "style_name": chosen["name"]}


def generate(root: Path, key: str, prompt_text: str, model: str, n: int) -> dict:
    """Polza.AI: POST /images/generations → номер запроса; GET /images/{номер} до готовности."""
    base = "https://api.polza.ai/api/v1"
    headers = {"Authorization": f"Bearer {os.environ['POLZA_API_KEY']}"}
    with httpx.Client(timeout=120, headers=headers) as http:
        r = http.post(f"{base}/images/generations", json={"model": model, "prompt": prompt_text, "n": 1,
                                                           "size": "1536x1024", "aspect_ratio": "3:2"})
        r.raise_for_status()
        rid = r.json().get("requestId") or r.json().get("id")
        if not rid:
            raise LLMError(f"нет номера запроса: {r.text[:200]}")
        deadline = time.time() + 300
        while True:
            d = http.get(f"{base}/images/{rid}").json()
            if d.get("status") not in ("PROCESSING", "PENDING", "QUEUED", None):
                break
            if time.time() > deadline:
                raise LLMError("генерация не закончилась за 5 минут")
            time.sleep(6)
        url = d.get("url") or (d.get("images") or [None])[0]
        if d.get("status") != "COMPLETED" or not url:
            raise LLMError(f"генерация не удалась: {json.dumps(d, ensure_ascii=False)[:200]}")
        img = http.get(url)
        img.raise_for_status()
    ext = "png" if "png" in img.headers.get("content-type", "") else "jpg"
    cdir = root / ".state" / "covers"
    cdir.mkdir(parents=True, exist_ok=True)
    name = f"{key}-{n}.{ext}"
    (cdir / name).write_bytes(img.content)
    return {"file": name, "model": model, "prompt": prompt_text, "at": now(), "request": rid}


def apply(root: Path, rec: dict, variant: dict, api, log) -> None:
    """Обложка — первой иллюстрацией. Есть запись «Новость» — загрузить и поставить первой; нет — публикатор поставит при создании."""
    rec["cover"]["chosen"] = variant["file"]
    if not rec.get("entity_id"):
        return
    path = root / ".state" / "covers" / variant["file"]
    model = variant.get("model", "").split("/")[-1]
    caption = f"Иллюстрация создана ИИ ({model}) для Вх²"
    mime = "image/png" if path.suffix == ".png" else "image/jpeg"
    asset = api.call("POST", "/media", files={"file": (path.name, path.read_bytes(), mime)},
                     data={"caption": caption, "original_caption": rec["cover"].get("alt_ru") or caption,
                           "author": f"ИИ: {model}; Вх²", "credit": "Вх²", "visibility": "public"})
    attached = api.call("POST", "/media/attachments", json={"entity_id": rec["entity_id"], "asset_id": asset["id"]})
    entity = api.call("GET", f"/entities/{rec['entity_id']}")
    others = [m["link_id"] for m in entity.get("media") or [] if m.get("link_id") != attached.get("link_id")]
    api.call("PUT", "/media/attachments/order", json={"entity_id": rec["entity_id"],
                                                       "order": [attached.get("link_id"), *others]})
    rec["cover"]["applied_at"] = now()
    log("info", "cover", "обложка поставлена", story=rec["story_key"], entity=rec["entity_id"])


def run(root: Path, llm: LLM, log, api) -> int:
    try:
        write_styles_snapshot(root)
    except Exception as e:  # noqa: BLE001
        log("warn", "cover", "снимок круга художников не записан", error=str(e)[:150])
    cdir = root / "inbox" / "covers"
    done = 0
    for req_path in sorted(cdir.glob("*.json")) if cdir.exists() else []:
        req = _read(req_path) or {}
        req_path.unlink(missing_ok=True)
        key = req.get("story_key", "")
        path = root / ".state" / "prepared" / f"{key}.json"
        rec = _read(path)
        if not rec:
            continue
        cover = rec.setdefault("cover", {"variants": []})
        try:
            if req.get("action") == "draft":
                cover.update(status="промпт готовится", started_at=req.get("at") or now())
                _write(path, rec)
                cover.update(draft(root, llm, rec, req.get("style")), status="промпт готов")
                log("info", "cover", "промпт обложки готов", story=key)
            elif req.get("action") == "generate":
                cover.update(status="генерируется", started_at=req.get("at") or now(),
                             prompt=req.get("prompt") or cover.get("prompt"),
                             model=req.get("model") or cover.get("model") or DEFAULT_MODEL)
                _write(path, rec)
                v = generate(root, key, cover["prompt"], cover["model"], len(cover["variants"]) + 1)
                cover["variants"].append(v)
                cover["status"] = "вариант готов"
                log("info", "cover", "вариант обложки готов", story=key, file=v["file"])
            elif req.get("action") == "apply":
                v = next((x for x in cover["variants"] if x["file"] == req.get("file")), None)
                if v:
                    apply(root, rec, v, api, log)
                    cover["status"] = "обложка поставлена"
            cover.pop("error", None)
        except Exception as e:  # noqa: BLE001 — ошибка одной обложки не держит минутное задание
            cover.update(status="ошибка", error=f"{type(e).__name__}: {e}"[:300])
            log("error", "cover", "обложка: ошибка", story=key, error=str(e)[:200])
        _write(path, rec)
        done += 1
    return done
