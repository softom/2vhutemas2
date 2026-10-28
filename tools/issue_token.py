"""Выпустить рабочий ключ API для сессий ассистента и положить в .env.local (VHUTEMAS_TOKEN).

Запускает сам пользователь. Ключ подписывается на сервере секретом API
(JWT_SECRET), секрет с сервера не уходит; готовый ключ приходит через ssh,
пишется в .env.local (в .gitignore) и на экран не выводится.

    python tools/issue_token.py              # «Сессия наполнения», 183 дня
    python tools/issue_token.py --days 90

Ключ нельзя отозвать по отдельности: до срока он действует, пока на сервере
не сменят JWT_SECRET (а это выбьет все входы). Хранить только в .env.local.
"""
import argparse
import base64
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HOST = "2vhutemas"
API = "https://2vhutemas.ru/api/v1"
LOCAL = Path(__file__).resolve().parent.parent / ".env.local"

p = argparse.ArgumentParser()
p.add_argument("--days", type=int, default=183)
p.add_argument("--who", default="Сессия наполнения", help="display_name участника в app.contributors")
a = p.parse_args()

REMOTE = r'''
import base64, hashlib, hmac, json, subprocess, sys, time
who, days = sys.argv[1], int(sys.argv[2])
# Переменные psql подставляются только во вводе, не в -c.
uid = subprocess.run(["docker", "exec", "-i", "supa_db", "psql", "-U", "postgres", "-d", "postgres", "-At", "-v", "who=" + who],
                     input="select auth_uid from app.contributors where display_name = :'who' and status = 'active';",
                     capture_output=True, text=True).stdout.strip()
if len(uid) != 36:
    sys.exit("участник не найден или без входа: " + who)
secret = None
for env in ("/opt/2vhutemas-services/app-api/.env", "/opt/2vhutemas/.env"):
    try:
        secret = next(l.split("=", 1)[1].strip() for l in open(env, encoding="utf-8") if l.startswith("JWT_SECRET="))
        break
    except (OSError, StopIteration):
        pass
if not secret:
    sys.exit("JWT_SECRET не найден")
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=")
now = int(time.time())
signed = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()) + b"." + b64(json.dumps(
    {"sub": uid, "role": "authenticated", "aud": "authenticated", "iat": now, "exp": now + days * 86400}).encode())
print((signed + b"." + b64(hmac.new(secret.encode(), signed, hashlib.sha256).digest())).decode())
'''

r = subprocess.run(["ssh", HOST, f"python3 - '{a.who}' {a.days}"], input=REMOTE, text=True,
                   capture_output=True, encoding="utf-8")
token = r.stdout.strip()
if r.returncode or not re.fullmatch(r"[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+", token):
    sys.exit("Сервер не выдал ключ: " + (r.stderr.strip() or r.stdout.strip())[:300])

try:
    req = urllib.request.Request(API + "/me", headers={"Authorization": "Bearer " + token})
    me = json.loads(urllib.request.urlopen(req, timeout=30).read())
except urllib.error.HTTPError as e:
    sys.exit(f"API не принял ключ: {e.code}. В .env.local ничего не записано.")
if not me.get("authenticated"):
    sys.exit("API не принял ключ. В .env.local ничего не записано.")

lines = LOCAL.read_text(encoding="utf-8").splitlines() if LOCAL.exists() else []
lines = [l for l in lines if not l.startswith("VHUTEMAS_TOKEN=")] + [f"VHUTEMAS_TOKEN={token}"]
LOCAL.write_text("\n".join(lines) + "\n", encoding="utf-8")

payload = token.split(".")[1]
exp = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))["exp"]
print(f"Ключ записан в .env.local: {me.get('display_name') or a.who}, права "
      f"{','.join(me.get('permissions') or [])}, действует до {time.strftime('%Y-%m-%d', time.localtime(exp))}.")
