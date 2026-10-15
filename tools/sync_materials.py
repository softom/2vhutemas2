"""Материалы в работе: папки research_notes ↔ записи сайта (0051).

Файлы остаются на компьютере редакции (research_notes, в Dropbox); сайт
хранит у записи путь к папке и опись файлов. Видят это только редакторы.

    python tools/sync_materials.py                     # обновить опись всех привязанных папок
    python tools/sync_materials.py --list              # какие папки к каким записям привязаны
    python tools/sync_materials.py --create <слаг|№>   # завести папку <ТИП>/<Название> и привязать
    python tools/sync_materials.py --link <слаг|№> <папка>   # привязать уже существующую папку
    python tools/sync_materials.py --unlink <слаг|№>

Новые папки — по типам (ОБЪЕКТЫ, ЛЮДИ, …), внутри по названию записи.
Токен — VHUTEMAS_TOKEN в .env.local; адрес — VHUTEMAS_API (по умолчанию сайт).
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NOTES = ROOT / "research_notes"
CACHE = NOTES / ".materials-cache.json"

# Корневая ветка типа записи → папка верхнего уровня.
TYPE_FOLDERS = {
    "what": "ОБЪЕКТЫ",
    "who": "ЛЮДИ",
    "when": "ПЕРИОДЫ",
    "where": "МЕСТА",
    "service": "СЛУЖЕБНЫЕ",
    "materials": "МАТЕРИАЛЫ",
    "project_pages": "СТРАНИЦЫ",
}

SKIP_DIRS = {"__pycache__", ".git", "node_modules"}
SKIP_SUFFIXES = {".py", ".pyc", ".bak", ".tmp"}


def skip(name: str) -> bool:
    low = name.lower()
    return (name.startswith((".", "~$")) or Path(low).suffix in SKIP_SUFFIXES
            or re.search(r"\.dwl2?$", low) is not None or low in {"thumbs.db", "desktop.ini"})


def env() -> tuple[str, str]:
    values = dict(os.environ)
    local = ROOT / ".env.local"
    if local.exists():
        for line in local.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                values.setdefault(k.strip(), v.strip().strip('"'))
    token = values.get("VHUTEMAS_TOKEN", "")
    if not token:
        sys.exit("Нет VHUTEMAS_TOKEN (в окружении или .env.local)")
    return values.get("VHUTEMAS_API", "https://2vhutemas.ru/api/v1").rstrip("/"), token


BASE, TOKEN = "", ""


def call(method: str, path: str, body: object | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={
        "Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path}: {e.code} {e.read().decode(errors='replace')[:400]}")


def entity(key: str) -> dict:
    d = call("GET", "/entities/" + urllib.parse.quote(key))
    return d.get("entity", d)


def safe_name(title: str) -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', " ", title).strip().rstrip(".")
    return re.sub(r"\s+", " ", name)[:120] or "без названия"


def rel(path: Path) -> str:
    return path.resolve().relative_to(NOTES.resolve()).as_posix()


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def inventory(folder: Path, cache: dict) -> list[dict]:
    files = []
    for dirpath, dirnames, filenames in os.walk(folder):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not d.startswith("."))
        for name in sorted(filenames):
            if skip(name):
                continue
            p = Path(dirpath) / name
            st = p.stat()
            key = str(p.resolve())
            hit = cache.get(key)
            if hit and hit["size"] == st.st_size and hit["mtime"] == st.st_mtime:
                digest = hit["sha256"]
            else:
                digest = sha256(p)
                cache[key] = {"size": st.st_size, "mtime": st.st_mtime, "sha256": digest}
            files.append({
                "path": p.relative_to(folder).as_posix(),
                "size": st.st_size,
                "modified": dt.datetime.fromtimestamp(st.st_mtime, dt.timezone.utc).isoformat(),
                "sha256": digest,
            })
    return files


def sync_all() -> None:
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    items = call("GET", "/research-materials")["items"]
    if not items:
        print("Привязанных папок нет. --create <слаг> или --link <слаг> <папка>.")
    for it in items:
        folder = NOTES / it["path"]
        if not folder.is_dir():
            print(f"! {it['title_ru']}: папки нет на месте — {it['path']}")
            continue
        files = inventory(folder, cache)
        call("PUT", f"/entities/{it['entity_id']}/research-materials/files", {"files": files})
        size = sum(f["size"] for f in files) / 1e6
        print(f"{it['title_ru']}: {len(files)} файлов, {size:.1f} МБ — {it['path']}")
    CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")


def main() -> None:
    global BASE, TOKEN
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--list", action="store_true")
    g.add_argument("--create", metavar="ЗАПИСЬ")
    g.add_argument("--link", nargs=2, metavar=("ЗАПИСЬ", "ПАПКА"))
    g.add_argument("--unlink", metavar="ЗАПИСЬ")
    a = ap.parse_args()
    BASE, TOKEN = env()

    if a.list:
        for it in call("GET", "/research-materials")["items"]:
            print(f"{it['entity_id']:>6}  {it['slug']:<40}  {it['files']:>4} ф.  {it['path']}")
        return
    if a.unlink:
        e = entity(a.unlink)
        call("PUT", f"/entities/{e['id']}/research-materials", {"path": None})
        print(f"Отвязано: {e['title_ru']} (файлы на месте)")
        return
    if a.create or a.link:
        e = entity(a.create or a.link[0])
        if a.create:
            root = (e.get("type_path") or [{}])[0].get("code", "")
            folder = NOTES / TYPE_FOLDERS.get(root, "ПРОЧЕЕ") / safe_name(e["title_ru"])
            folder.mkdir(parents=True, exist_ok=True)
        else:
            folder = Path(a.link[1])
            folder = folder if folder.is_absolute() else (NOTES / folder if (NOTES / folder).is_dir() else Path.cwd() / folder)
            if not folder.is_dir():
                sys.exit(f"Нет папки: {folder}")
        path = rel(folder)
        call("PUT", f"/entities/{e['id']}/research-materials", {"path": path})
        print(f"{e['title_ru']} → research_notes/{path}")
    sync_all()


if __name__ == "__main__":
    main()
