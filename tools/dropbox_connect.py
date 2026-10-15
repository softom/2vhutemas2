"""Подключить Dropbox к сайту: ключи приложения → .env API на сервере (0052).

Запускает сам пользователь; ключи вводятся скрыто, на экран и в файлы
репозитория не попадают, на сервер уходят через stdin ssh.

    python tools/dropbox_connect.py

Перед запуском: https://www.dropbox.com/developers/apps → Create app →
Scoped access → App folder → имя 2VHUTEMAS. Вкладка Permissions: отметить
files.metadata.read и files.metadata.write → Submit. Вкладка Settings:
App key и App secret.
"""
import getpass
import json
import subprocess
import sys
import urllib.parse
import urllib.request
import webbrowser

HOST = "2vhutemas"
ENV = "/opt/2vhutemas-services/app-api/.env"

key = getpass.getpass("App key (ввод скрыт): ").strip()
secret = getpass.getpass("App secret (ввод скрыт): ").strip()
if not key or not secret:
    sys.exit("Нужны App key и App secret")

url = "https://www.dropbox.com/oauth2/authorize?" + urllib.parse.urlencode(
    {"client_id": key, "response_type": "code", "token_access_type": "offline"})
print("\nОткроется страница Dropbox: разрешите доступ и скопируйте код.\n" + url + "\n")
webbrowser.open(url)
code = getpass.getpass("Код с страницы Dropbox (ввод скрыт): ").strip()

req = urllib.request.Request("https://api.dropboxapi.com/oauth2/token", data=urllib.parse.urlencode(
    {"code": code, "grant_type": "authorization_code", "client_id": key, "client_secret": secret}).encode())
try:
    token = json.loads(urllib.request.urlopen(req, timeout=60).read())
except urllib.error.HTTPError as e:
    sys.exit(f"Dropbox отказал: {e.code} {e.read().decode(errors='replace')[:200]}")
refresh = token.get("refresh_token")
if not refresh:
    sys.exit("Dropbox не выдал refresh_token")

# Прежние строки DROPBOX_* заменяются; файл — только для root (chmod 600).
lines = f"DROPBOX_APP_KEY={key}\nDROPBOX_APP_SECRET={secret}\nDROPBOX_REFRESH_TOKEN={refresh}\n"
remote = (f"set -e; cp -p {ENV} {ENV}.bak-dropbox; grep -v '^DROPBOX_' {ENV}.bak-dropbox > {ENV}.new; "
          f"cat >> {ENV}.new; chmod 600 {ENV}.new; mv {ENV}.new {ENV}; "
          "cd /opt/2vhutemas-services && docker compose up -d --no-deps --force-recreate api >/dev/null 2>&1; "
          f"grep -c '^DROPBOX_' {ENV}")
r = subprocess.run(["ssh", HOST, remote], input=lines, text=True, capture_output=True)
if r.returncode or r.stdout.strip() != "3":
    sys.exit("Не удалось записать на сервер: " + (r.stderr.strip() or r.stdout.strip())[:300])
print("Dropbox подключён: ключи записаны на сервер, API перезапущен.")
