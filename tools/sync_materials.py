"""Материалы в работе: папки Dropbox 2VHUTEMAS ↔ записи сайта (0051, 0052).

Решение пользователя 2026-10-15: материалы складываются в Dropbox, в папку
2VHUTEMAS — ЧТО/ПРОЕКТЫ и КТО/ЛЮДИ, папка записи «<тип>_<название>».
Папки и опись ведёт сайт: кнопка «Обновить файловую структуру» на странице
/materials (через API Dropbox). Этот скрипт — дополнение: досчитывает sha256
файлов (Dropbox его не отдаёт) — по нему на странице записи видно, что уже
в медиатеке, — и правит соответствие вручную.

    python tools/sync_materials.py                     # опись с sha256 для всех папок
    python tools/sync_materials.py --list              # таблица соответствия
    python tools/sync_materials.py --link <слаг|№> <папка>   # папка названа не так, как запись
    python tools/sync_materials.py --unlink <слаг|№>

Корень — VHUTEMAS_MATERIALS (по умолчанию E:\\Dropbox\\2VHUTEMAS); токен —
VHUTEMAS_TOKEN в .env.local; адрес — VHUTEMAS_API (по умолчанию сайт).
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
SKIP_DIRS = {"__pycache__", ".git", "node_modules", ".dropbox.cache"}
SKIP_SUFFIXES = {".pyc", ".bak", ".tmp"}


def skip(name: str) -> bool:
    low = name.lower()
    return (name.startswith((".", "~$")) or Path(low).suffix in SKIP_SUFFIXES
            or re.search(r"\.dwl2?$", low) is not None or low in {"thumbs.db", "desktop.ini"})


def settings() -> dict:
    values = dict(os.environ)
    local = ROOT / ".env.local"
    if local.exists():
        for line in local.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                values.setdefault(k.strip(), v.strip().strip('"'))
    if not values.get("VHUTEMAS_TOKEN"):
        sys.exit("Нет VHUTEMAS_TOKEN (в окружении или .env.local)")
    return values


CFG = settings()
BASE = CFG.get("VHUTEMAS_API", "https://2vhutemas.ru/api/v1").rstrip("/")
NOTES = Path(CFG.get("VHUTEMAS_MATERIALS", r"E:\Dropbox\2VHUTEMAS"))
CACHE = NOTES / ".materials-cache.json"


def call(method: str, path: str, body: object | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={
        "Authorization": f"Bearer {CFG['VHUTEMAS_TOKEN']}", "Content-Type": "application/json",
        "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path}: {e.code} {e.read().decode(errors='replace')[:400]}")


def entity(key: str) -> dict:
    d = call("GET", "/entities/" + urllib.parse.quote(key))
    return d.get("entity", d)


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
            key = rel(p)
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
    for it in call("GET", "/research-materials")["items"]:
        folder = NOTES / it["path"]
        if not folder.is_dir():
            print(f"! {it['title_ru']}: папки нет — {it['path']}")
            continue
        files = inventory(folder, cache)
        if not files:
            continue
        call("PUT", f"/entities/{it['entity_id']}/research-materials/files", {"files": files})
        size = sum(f["size"] for f in files) / 1e6
        print(f"  {it['path']}: {len(files)} файлов, {size:.1f} МБ → {it['title_ru']}")
    CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--list", action="store_true")
    g.add_argument("--link", nargs=2, metavar=("ЗАПИСЬ", "ПАПКА"))
    g.add_argument("--unlink", metavar="ЗАПИСЬ")
    a = ap.parse_args()

    if a.list:
        for it in call("GET", "/research-materials")["items"]:
            print(f"{it['path']:<70}  {it['title_ru']}  ({it['entity_id']}, {it['files']} ф.)")
        return
    if a.unlink:
        e = entity(a.unlink)
        call("PUT", f"/entities/{e['id']}/research-materials", {"path": None})
        print(f"Отвязано: {e['title_ru']} (файлы на месте)")
        return
    if a.link:
        e = entity(a.link[0])
        folder = Path(a.link[1])
        folder = folder if folder.is_absolute() else NOTES / folder
        if not folder.is_dir():
            sys.exit(f"Нет папки: {folder}")
        call("PUT", f"/entities/{e['id']}/research-materials", {"path": rel(folder)})
        print(f"{rel(folder)} → {e['title_ru']}")
    sync_all()


if __name__ == "__main__":
    main()
