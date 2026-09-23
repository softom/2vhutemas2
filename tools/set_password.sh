#!/bin/bash
# Смена пароля пользователя Supabase от имени администратора.
# Пароль вводится здесь, на сервере: он не попадает в историю команд,
# в переписку и в журналы (правила 9 и 10 проекта).
set -e
EMAIL="${1:?Укажите почту: bash set-password.sh user@example.com}"
KEY=$(grep -E '^SERVICE_ROLE_KEY=' /opt/2vhutemas/.env | cut -d= -f2-)

UID_FOUND=$(docker exec -i supa_db psql -U postgres -d postgres -At \
  -c "select id from auth.users where email = '$EMAIL'")
if [ -z "$UID_FOUND" ]; then
  echo "Пользователь с почтой $EMAIL не найден"; exit 1
fi

read -r -s -p "Новый пароль для $EMAIL: " PW; echo
read -r -s -p "Повторите пароль: " PW2; echo
[ "$PW" = "$PW2" ] || { echo "Пароли не совпали"; exit 1; }
[ ${#PW} -ge 8 ] || { echo "Пароль короче восьми знаков"; exit 1; }

RESPONSE=$(curl -s -o /tmp/pw-response.json -w "%{http_code}" \
  -X PUT "http://127.0.0.1:8000/auth/v1/admin/users/$UID_FOUND" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "content-type: application/json" \
  --data-binary @<(printf '{"password":%s}' "$(printf '%s' "$PW" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"))
unset PW PW2

if [ "$RESPONSE" = "200" ]; then
  echo "Пароль изменён. Войдите на https://2vhutemas.ru/new/"
else
  echo "Не удалось изменить пароль, код ответа $RESPONSE"
  head -c 300 /tmp/pw-response.json; echo
fi
rm -f /tmp/pw-response.json
