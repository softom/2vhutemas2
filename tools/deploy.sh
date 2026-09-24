#!/bin/bash
# Выкладка нового контура и прогон проверок (решение Р-13).
#
# Один скрипт на время разработки: код на сервер, сборка клиента,
# перезапуск API, миграции, прогон основных маршрутов. Если прогон
# находит сбой, об этом видно сразу, а не через день от пользователя.
set -e
HOST="${1:-2vhutemas}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "── Код на сервер"
cd "$ROOT"
tar -czf - api web | ssh -o BatchMode=yes "$HOST" '
  cd /opt/2vhutemas-services && tar -xzf - &&
  rsync -a --delete api/src/ app-api/src/ &&
  cp api/Dockerfile api/deno.json app-api/ &&
  rsync -a --delete --exclude node_modules --exclude dist --exclude ".env*" web/ app-web/ &&
  rm -rf api web'

echo "── Миграции"
python "$ROOT/tools/migrate.py" --host "$HOST"

echo "── Перезапуск API"
ssh -o BatchMode=yes "$HOST" 'cd /opt/2vhutemas-services && docker compose restart api >/dev/null 2>&1'
sleep 8

echo "── Настройки клиента на месте"
# Выкладка удаляет лишние файлы, но настройки сервера ей не принадлежат:
# однажды удалённый .env оставил собранный клиент без адреса Supabase,
# и страница встретила пользователя чёрным экраном.
ssh -o BatchMode=yes "$HOST" 'cd /opt/2vhutemas-services/app-web &&
  test -s .env && grep -q "^VITE_SUPABASE_URL=." .env && grep -q "^VITE_SUPABASE_ANON_KEY=." .env' || {
  echo "Нет настроек клиента (.env) — сборка бессмысленна"; exit 1; }
echo "  ok"

echo "── Сборка клиента"
ssh -o BatchMode=yes "$HOST" 'cd /opt/2vhutemas-services/app-web && npm run build 2>&1 | grep -E "error|built" | tail -2'

echo "── Клиент поднимается"
# Проверяем не факт сборки, а что в ней есть настройки: без них страница
# падает до первой отрисовки, и прогон маршрутов этого не видит.
ssh -o BatchMode=yes "$HOST" 'cd /opt/2vhutemas-services/app-web &&
  URL=$(grep -E "^VITE_SUPABASE_URL=" .env | cut -d= -f2-) &&
  grep -ql "$URL" dist/assets/*.js' || {
  echo "В собранном клиенте нет адреса Supabase — выкладка не состоялась"; exit 1; }
echo "  ok"

echo "── Проверка типов клиента"
# Сборка идёт с --noCheck ради скорости, поэтому типы проверяем отдельно:
# именно так нашлись обращения к маршрутам, которых уже нет.
ssh -o BatchMode=yes "$HOST" 'cd /opt/2vhutemas-services/app-web && npx tsc -b --force' || {
  echo "Проверка типов не прошла — выкладка не считается состоявшейся"; exit 1; }
echo "  ok"

echo "── Прогон маршрутов"
ssh -o BatchMode=yes "$HOST" 'cat > /tmp/smoke.sh' < "$ROOT/tools/smoke.sh"
ssh -o BatchMode=yes "$HOST" 'bash /tmp/smoke.sh; RESULT=$?; rm -f /tmp/smoke.sh; exit $RESULT'
