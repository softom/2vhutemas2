"""Открыть папку материалов в Проводнике по ссылке vhutemas-folder:<путь>.

Ссылки ставит страница /materials сайта; обработчик регистрирует
tools/install_folder_links.py. Открывает только папки внутри корня
материалов (VHUTEMAS_MATERIALS или E:\\Dropbox\\2VHUTEMAS) и ничего не запускает,
кроме Проводника.
"""
import os
import subprocess
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(os.environ.get("VHUTEMAS_MATERIALS", r"E:\Dropbox\2VHUTEMAS")).resolve()


def main() -> None:
    raw = sys.argv[1] if len(sys.argv) > 1 else ""
    rel = urllib.parse.unquote(raw.split(":", 1)[1] if ":" in raw else raw).strip().strip("/\\")
    parts = [p for p in rel.replace("\\", "/").split("/") if p]
    if any(p in ("..", ".") or ":" in p for p in parts):
        return
    target = ROOT.joinpath(*parts).resolve()
    if target != ROOT and ROOT not in target.parents:
        return
    # Папка ещё не создана Dropbox'ом на этом компьютере — открыть ближайшую.
    while not target.is_dir() and target != ROOT:
        target = target.parent
    subprocess.Popen(["explorer.exe", str(target)])


if __name__ == "__main__":
    main()
