"""Подключить Dropbox к сайту: ключи приложения → .env API на сервере (0052).

Запускает сам пользователь. Ключи берутся из буфера обмена (скрытый ввод в
консоли Windows не принимает Ctrl+V), на экран и в файлы репозитория не
попадают, на сервер уходят через stdin ssh.

    python tools/dropbox_connect.py

Перед запуском: https://www.dropbox.com/developers/apps → Create app →
Scoped access → доступ, имя 2VHUTEMAS. Вкладка Permissions: отметить
files.metadata.read и files.metadata.write → Submit. Вкладка Settings:
App key и App secret.

Корень папок определяется сам: если в Dropbox есть /2VHUTEMAS (доступ
«Full Dropbox», папка E:\\Dropbox\\2VHUTEMAS) — он; иначе — папка приложения
(доступ «App folder», Приложения/2VHUTEMAS).
"""
import json
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

HOST = "2vhutemas"
ENV = "/opt/2vhutemas-services/app-api/.env"


def from_clipboard(what: str) -> str:
    input(f"Скопируйте {what} (Ctrl+C) и нажмите Enter… ")
    r = subprocess.run(["powershell", "-NoProfile", "-Command", "Get-Clipboard -Raw"],
                       capture_output=True, text=True, encoding="utf-8")
    value = r.stdout.strip()
    if not re.fullmatch(r"[A-Za-z0-9_\-.]{8,}", value):
        sys.exit(f"В буфере не {what}: ожидаются латинские буквы и цифры. Скопируйте ещё раз.")
    print(f"  {what}: принят ({len(value)} знаков)")
    return value


def post(url: str, data: dict | None = None, token: str | None = None, body: dict | None = None) -> dict:
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"} if token else {}
    payload = json.dumps(body).encode() if body is not None else urllib.parse.urlencode(data or {}).encode()
    with urllib.request.urlopen(urllib.request.Request(url, data=payload, headers=headers), timeout=60) as r:
        return json.loads(r.read())


key = from_clipboard("App key")
secret = from_clipboard("App secret")

url = "https://www.dropbox.com/oauth2/authorize?" + urllib.parse.urlencode(
    {"client_id": key, "response_type": "code", "token_access_type": "offline"})
print("\nОткрывается страница Dropbox: нажмите «Разрешить» и скопируйте код.")
webbrowser.open(url)
code = from_clipboard("код со страницы Dropbox")

try:
    token = post("https://api.dropboxapi.com/oauth2/token", {
        "code": code, "grant_type": "authorization_code", "client_id": key, "client_secret": secret})
except urllib.error.HTTPError as e:
    sys.exit(f"Dropbox отказал: {e.code} {e.read().decode(errors='replace')[:200]}")
refresh = token.get("refresh_token")
if not refresh:
    sys.exit("Dropbox не выдал refresh_token")

# Права ключа фиксируются в момент разрешения: без нужных — ничего не пишем.
granted = set((token.get("scope") or "").split())
missing = {"files.metadata.read", "files.metadata.write"} - granted
if missing:
    sys.exit(f"У ключа нет прав: {', '.join(sorted(missing))}. В App Console этого приложения "
             "(App key — тот, что вы копировали) на вкладке Permissions отметьте их, нажмите Submit "
             "и запустите скрипт снова. На сервер ничего не записано.")

# Где корень: /2VHUTEMAS виден только при доступе ко всему Dropbox.
try:
    post("https://api.dropboxapi.com/2/files/get_metadata", token=token["access_token"], body={"path": "/2VHUTEMAS"})
    root, where = "/2VHUTEMAS", r"E:\Dropbox\2VHUTEMAS"
except urllib.error.HTTPError as e:
    if "not_found" not in e.read().decode(errors="replace"):
        sys.exit("Dropbox не ответил на проверку папки — на сервер ничего не записано.")
    root, where = "", r"E:\Dropbox\Приложения\<имя приложения> (доступ App folder)"
    print("Папки /2VHUTEMAS приложение не видит: у него доступ App folder, а не Full Dropbox.")
    if input("Всё равно записать на сервер? [y/N] ").strip().lower() != "y":
        sys.exit("На сервер ничего не записано.")

lines = (f"DROPBOX_APP_KEY={key}\nDROPBOX_APP_SECRET={secret}\n"
         f"DROPBOX_REFRESH_TOKEN={refresh}\nDROPBOX_ROOT={root}\n")
remote = (f"set -e; cp -p {ENV} {ENV}.bak-dropbox; grep -v '^DROPBOX_' {ENV}.bak-dropbox > {ENV}.new; "
          f"cat >> {ENV}.new; chmod 600 {ENV}.new; mv {ENV}.new {ENV}; "
          "cd /opt/2vhutemas-services && docker compose up -d --no-deps --force-recreate api >/dev/null 2>&1; "
          f"grep -c '^DROPBOX_' {ENV}")
r = subprocess.run(["ssh", HOST, remote], input=lines, text=True, capture_output=True)
if r.returncode or r.stdout.strip() != "4":
    sys.exit("Не удалось записать на сервер: " + (r.stderr.strip() or r.stdout.strip())[:300])
print(f"Dropbox подключён: корень — {where}. Ключи записаны на сервер, API перезапущен.")
