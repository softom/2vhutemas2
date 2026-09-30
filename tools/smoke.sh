#!/bin/bash
# Прогон основных маршрутов нового контура.
#
# Проверяет то, что ломалось на практике: списки и карточки, медиатеку,
# места, метки, связи, права гостя. Создаёт свои записи с пометкой smoke
# и убирает их за собой; чужие данные не трогает.
#
# Запускается на сервере: bash smoke.sh
set +e
API=${SMOKE_API:-http://127.0.0.1:7073/api/v1}
DB=${SMOKE_DB:-postgres}
UID_T="e6777073-6cae-46b5-8d48-a499e188f230"
SPW=$(grep -E "^POSTGRES_PASSWORD=" /opt/2vhutemas/.env | cut -d= -f2-)
PASS=0
FAIL=0

# Идентификатор берём разбором JSON: шаблоном легко схватить чужой.
field() { python3 -c "import json,sys; print(json.load(sys.stdin).get('$1') or '')"; }

check() { # имя, ожидаемое, полученное
  if [ "$2" = "$3" ]; then
    PASS=$((PASS+1)); printf '  ok   %s\n' "$1"
  else
    FAIL=$((FAIL+1)); printf '  СБОЙ %s: ожидалось «%s», получено «%s»\n' "$1" "$2" "$3"
  fi
}

contains() { # имя, что искать, где искать
  case "$3" in
    *"$2"*) PASS=$((PASS+1)); printf '  ok   %s\n' "$1" ;;
    *) FAIL=$((FAIL+1)); printf '  СБОЙ %s: не нашлось «%s» в ответе\n' "$1" "$2" ;;
  esac
}

missing() { # имя, чего быть не должно, где искать
  case "$3" in
    *"$2"*) FAIL=$((FAIL+1)); printf '  СБОЙ %s: в ответе оказалось «%s»\n' "$1" "$2" ;;
    *) PASS=$((PASS+1)); printf '  ok   %s\n' "$1" ;;
  esac
}

TOKEN=$(docker exec -i -e JWT_SECRET="$(grep -E '^JWT_SECRET=' /opt/2vhutemas/.env | cut -d= -f2-)" -e SUBJ="$UID_T" app_api deno eval --quiet '
const enc = new TextEncoder();
const b64 = (o: unknown) => btoa(String.fromCharCode(...enc.encode(JSON.stringify(o)))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const head = b64({alg:"HS256",typ:"JWT"}); const now = Math.floor(Date.now()/1000);
const body = b64({sub:Deno.env.get("SUBJ"),role:"authenticated",iat:now,exp:now+3600});
const key = await crypto.subtle.importKey("raw", enc.encode(Deno.env.get("JWT_SECRET")!), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(head+"."+body)));
console.log(head+"."+body+"."+btoa(String.fromCharCode(...sig)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""));
')
AUTH="Authorization: Bearer $TOKEN"
JSON="content-type: application/json"
code() { curl -s -o /tmp/smoke.out -w "%{http_code}" "$@"; }
body() { cat /tmp/smoke.out; }

echo "── Служебные маршруты"
check "проверка живости" 200 "$(code $API/health)"
contains "версия контракта" '"version"' "$(body)"
contains "SU получает право редактирования в /me" '"su"' "$(curl -s -H "$AUTH" $API/me)"
check "единое меню гостя доступно" 200 "$(code $API/site-header)"
contains "меню гостя содержит вход" 'Войти' "$(body)"
missing "меню гостя не содержит создания" 'Создать запись' "$(body)"
check "единое меню SU доступно" 200 "$(code -H "$AUTH" $API/site-header)"
contains "меню SU содержит выход" 'signout' "$(body)"
contains "меню SU содержит создание записи" 'Создать запись' "$(body)"
missing "меню SU не предлагает вход" 'Войти' "$(body)"

code -H "$AUTH" $API/capabilities >/dev/null
contains "дерево типов" '"entity_types"' "$(body)"
contains "корневая ветвь в дереве" '"who"' "$(body)"
contains "ветвь ниже корня" '"architecture_object"' "$(body)"
contains "словарь видов изображений" 'media_kinds' "$(body)"
contains "виды изображений на месте" 'media_kinds' "$(body)"

echo "── Объекты"
check "каталог гостю" 200 "$(code $API/entities)"
check "каталог под входом" 200 "$(code -H "$AUTH" $API/entities)"
# Прежнее имя поля принимается как псевдоним корневой ветви (Р-37).
C=$(curl -s -X POST -H "$AUTH" -H "$JSON" -d '{"kind":"object","slug":"smoke-proverka","title_ru":"smoke: проверка"}' $API/entities)
EID=$(echo "$C" | field id)
REV=$(echo "$C" | field revision_id)
check "создание объекта" "да" "$([ -n "$EID" ] && echo да || echo нет)"
check "карточка под входом" 200 "$(code -H "$AUTH" $API/entities/$EID)"
contains "карточка отдаёт показатели" '"indicators"' "$(body)"
contains "карточка отдаёт файлы" '"media"' "$(body)"
contains "карточка отдаёт метки" '"tags"' "$(body)"
contains "карточка отдаёт путь по дереву" '"type_path"' "$(body)"
check "черновик гостю не виден" 404 "$(code $API/entities/$EID)"
check "HTML черновика гостю не виден" 404 "$(code $API/entities/$EID/card)"
check "единый HTML черновика доступен SU" 200 "$(code -H "$AUTH" $API/entities/$EID/card)"
contains "черновик использует общий рендер" 'public-card' "$(body)"
contains "общий рендер содержит действие правки" 'data-reader-edit' "$(body)"
check "прямая страница черновика сохраняет 404" 404 "$(code http://127.0.0.1:7073/entities/$EID)"
contains "страница черновика не запускает React повторно" 'data-public-page' "$(body)"
missing "гость не получает название черновика" 'smoke: проверка' "$(body)"

check "неизвестный тип отклоняется" 400 "$(code -X POST -H "$AUTH" -H "$JSON" -d '{"type":"net-takogo","slug":"smoke-net-tipa","title_ru":"smoke: нет типа"}' $API/entities)"
# Записей в базе больше страницы, поэтому ищем свою по имени, а не наугад.
code -H "$AUTH" "$API/entities?type=what&q=smoke" >/dev/null
contains "отбор по корневой ветви" 'smoke-proverka' "$(body)"
code -H "$AUTH" "$API/entities?type=who&q=smoke" >/dev/null
missing "запись не попала в чужую ветвь" 'smoke-proverka' "$(body)"
code -H "$AUTH" "$API/entities?kind=object&q=smoke" >/dev/null
contains "прежний фильтр по виду работает" 'smoke-proverka' "$(body)"
check "повтор адреса отклоняется" 409 "$(code -X POST -H "$AUTH" -H "$JSON" -d '{"kind":"object","slug":"smoke-proverka","title_ru":"smoke: повтор"}' $API/entities)"
check "правка от устаревшей версии" 409 "$(code -X PATCH -H "$AUTH" -H "$JSON" -d '{"title_ru":"smoke","base_revision_id":"00000000-0000-4000-8000-000000000000"}' $API/entities/$EID)"
check "правка от текущей версии" 200 "$(code -X PATCH -H "$AUTH" -H "$JSON" -d "{\"title_ru\":\"smoke: правка\",\"base_revision_id\":\"$REV\"}" $API/entities/$EID)"
REV2=$(body | field revision_id)
# Тип меняется правкой: запись одна, меняется только ветвь дерева (Р-37).
check "смена типа" 200 "$(code -X PATCH -H "$AUTH" -H "$JSON" -d "{\"type\":\"performance\",\"base_revision_id\":\"$REV2\"}" $API/entities/$EID)"
REV=$(body | field revision_id)
code -H "$AUTH" $API/entities/$EID >/dev/null
contains "тип сменился" '"type":"performance"' "$(body)"

echo "── Датировки"
code -X PUT -H "$AUTH" -H "$JSON" -d '{"dates":[{"kind":"design","start_year":1929},{"kind":"opening","start_year":1945,"start_month":5,"start_day":12}]}' $API/entities-dates/$EID >/dev/null
contains "датировки записаны" '"opening"' "$(body)"
check "неизвестный вид даты отклоняется" 400 "$(code -X PUT -H "$AUTH" -H "$JSON" -d '{"dates":[{"kind":"нет-такого","start_year":1900}]}' $API/entities-dates/$EID)"
check "конец раньше начала отклоняется" 400 "$(code -X PUT -H "$AUTH" -H "$JSON" -d '{"dates":[{"kind":"design","start_year":1930,"end_year":1920}]}' $API/entities-dates/$EID)"
code -H "$AUTH" $API/entities/$EID >/dev/null
contains "датировки в карточке" '"is_approximate"' "$(body)"

echo "── Медиатека"
check "список файлов" 200 "$(code -H "$AUTH" $API/media)"
contains "состояние вариантов" '"files"' "$(body)"
docker exec app_api /usr/local/bin/magickw -size 400x300 gradient:navy-orange /tmp/smoke.jpg >/dev/null 2>&1
docker cp app_api:/tmp/smoke.jpg /tmp/smoke.jpg >/dev/null 2>&1
A=$(curl -s -X POST -H "$AUTH" -F "file=@/tmp/smoke.jpg;type=image/jpeg" -F "caption=smoke: файл" $API/media)
AID=$(echo "$A" | field id)
check "загрузка файла" "да" "$([ -n "$AID" ] && echo да || echo нет)"
contains "превью готово" '"thumbnail"' "$A"
check "приватный файл гостю" 404 "$(code "$API/media/$AID/file?variant=thumbnail")"
check "файл под входом" 200 "$(code -H "$AUTH" "$API/media/$AID/file?variant=thumbnail")"
# Ссылки на автора и источник — задача редактора, а не запрет (Р-68):
# файл публикуется и без них, но попадает в список ждущих ссылок.
check "файл без ссылок публикуется" 200 "$(code -X PATCH -H "$AUTH" -H "$JSON" -d '{"visibility":"public"}' $API/media/$AID)"
# Сужаем поиском: список ждущих ссылок длинный, и наш файл, самый свежий,
# в первую страницу не попадает.
needs() { curl -s -H "$AUTH" "$API/media?needs=attribution&q=smoke" | python3 -c "
import json,sys
print(str(any(i['id'] == '$AID' for i in json.load(sys.stdin)['items'])).lower())"; }
check "файл без ссылок ждёт их" true "$(needs)"
check "со ссылками задача снимается" 200 "$(code -X PATCH -H "$AUTH" -H "$JSON" -d '{"visibility":"public","author":"smoke: автор","source_url":"https://example.org/smoke"}' $API/media/$AID)"
check "заполненный файл задачи не ждёт" false "$(needs)"
contains "изображения закрыты от картиночного поиска" "noimageindex" "$(curl -s -D - -o /dev/null -H "$AUTH" "$API/media/$AID/file?variant=thumbnail")"
code -X PATCH -H "$AUTH" -H "$JSON" -d '{"visibility":"private"}' $API/media/$AID >/dev/null

check "привязка файла к объекту" 201 "$(code -X POST -H "$AUTH" -H "$JSON" -d "{\"entity_id\":$EID,\"asset_id\":\"$AID\",\"role\":\"gallery\"}" $API/media/attachments)"
check "повторная привязка" 409 "$(code -X POST -H "$AUTH" -H "$JSON" -d "{\"entity_id\":$EID,\"asset_id\":\"$AID\",\"role\":\"gallery\"}" $API/media/attachments)"
ATT=$(curl -s -H "$AUTH" $API/entities/$EID | python3 -c "
import json,sys
print(json.load(sys.stdin)['media'][0]['attachment_id'])")
code -H "$AUTH" "$API/entities?q=smoke" >/dev/null
COVER=$(body | python3 -c "
import json,sys
print(next((1 for i in json.load(sys.stdin)['items'] if str(i['id']) == '$EID' and i.get('cover_asset_id')), 0))")
check "обложка в каталоге" 1 "$COVER"
check "автор изображения в карточке" "smoke: автор" "$(curl -s -H "$AUTH" $API/entities/$EID | python3 -c "
import json,sys
print(json.load(sys.stdin)['media'][0].get('author') or '')")"
check "порядок изображений" 200 "$(code -X PUT -H "$AUTH" -H "$JSON" -d "{\"entity_id\":$EID,\"order\":[$ATT]}" $API/media/attachments/order)"
check "чужая привязка в порядке" 400 "$(code -X PUT -H "$AUTH" -H "$JSON" -d "{\"entity_id\":$EID,\"order\":[999999]}" $API/media/attachments/order)"

echo "── Места"
check "справочник мест гостю закрыт" 401 "$(code $API/places)"
check "справочник мест под входом" 200 "$(code -H "$AUTH" $API/places)"
P=$(curl -s -X POST -H "$AUTH" -H "$JSON" -d '{"country":"smoke-страна","settlement":"smoke-город","street":"smoke-улица","house":"17","unit":"4","precision":"settlement"}' $API/places)
PID=$(echo "$P" | field id)
check "создание места" "да" "$([ -n "$PID" ] && echo да || echo нет)"
SAME=$(curl -s -X POST -H "$AUTH" -H "$JSON" -d '{"country":"SMOKE-СТРАНА","settlement":" smoke-город ","street":"smoke-улица","house":"17","unit":"4"}' $API/places | field id)
check "повтор адреса не плодит место" "$PID" "$SAME"
check "пустое место отклоняется" 400 "$(code -X POST -H "$AUTH" -H "$JSON" -d '{}' $API/places)"
check "широта без долготы отклоняется" 400 "$(code -X POST -H "$AUTH" -H "$JSON" -d '{"settlement":"smoke","lat":10}' $API/places)"
# Привязка места — теперь значение параметра, проверяется ниже вместе с величинами.
check "справочник мест отвечает" 200 "$(code -H "$AUTH" $API/places/$PID/usage)"

echo "── Метки"
check "справочник меток" 200 "$(code -H "$AUTH" $API/tags)"
code -X PUT -H "$AUTH" -H "$JSON" -d '{"tags":["smoke-метка","#smoke-вторая"]}' $API/tags/entities/$EID >/dev/null
contains "метка без решётки" '"smoke-вторая"' "$(body)"
code -X PUT -H "$AUTH" -H "$JSON" -d '{"tags":["SMOKE-МЕТКА","smoke-вторая"]}' $API/tags/entities/$EID >/dev/null
DOUBLES=$(docker exec -i -e PGPASSWORD="$SPW" supa_db psql -U supabase_admin -d "$DB" -At -c "
select count(*) from app.tags where lower(title) like 'smoke-%'")
check "регистр не плодит метки" 2 "$DOUBLES"
check "гость метки не меняет" 401 "$(code -X PUT -H "$JSON" -d '{"tags":["взлом"]}' $API/tags/entities/$EID)"

echo "── Связи"
C2=$(curl -s -X POST -H "$AUTH" -H "$JSON" -d '{"type":"architecture_object","slug":"smoke-vtoroy","title_ru":"smoke: второй"}' $API/entities)
EID2=$(echo "$C2" | field id)
REVB=$(curl -s -H "$AUTH" $API/entities/$EID2 | field latest_revision_id)
check "связь без обоснования" 422 "$(code -X POST -H "$AUTH" -H "$JSON" -d "{\"from_entity_id\":$EID,\"to_entity_id\":$EID2,\"justification\":{}}" $API/links)"
check "связь с обоснованием" 201 "$(code -X POST -H "$AUTH" -H "$JSON" -d "{\"from_entity_id\":$EID,\"to_entity_id\":$EID2,\"justification\":{\"text\":\"smoke: обоснование\"}}" $API/links)"
code -H "$AUTH" "$API/links?entity_id=$EID" >/dev/null
contains "окружение с обоснованием" 'smoke: обоснование' "$(body)"
LID=$(curl -s -H "$AUTH" "$API/links?entity_id=$EID" | python3 -c "
import json,sys
items=json.load(sys.stdin)['items']
print(items[0].get('id') or items[0].get('link_id') or '')")
if [ -n "$LID" ]; then
  check "публикация связи с обоснованием" 200 "$(code -X POST -H "$AUTH" -H "$JSON" -d '{}' $API/links/$LID/publish)"
fi

echo "── Источники"
# Цитируемое — объект, обстоятельства цитаты — связь (Р-76). В тексте стоит
# только знак, ведущий к объекту.
SRC=$(curl -s -X POST -H "$AUTH" -H "$JSON" -d '{"type":"web_page","slug":"smoke-istochnik","title_ru":"smoke: источник"}' $API/entities)
SRCID=$(echo "$SRC" | field id)
SRCREV=$(echo "$SRC" | field revision_id)
check "веб-страница заводится записью" "да" "$([ -n "$SRCID" ] && echo да || echo нет)"
code -X PUT -H "$AUTH" -H "$JSON" -d "{\"base_revision_id\":\"$SRCREV\",\"indicators\":[{\"title\":\"Сведения\",\"is_current\":true,\"values\":[{\"parameter\":\"url\",\"text_value\":\"https://example.org/smoke\"}]}]}" $API/entities-indicators/$SRCID >/dev/null
contains "адрес — сведение объекта" 'https://example.org/smoke' "$(curl -s -H "$AUTH" $API/entities/$SRCID)"
SRCLINK=$(curl -s -X POST -H "$AUTH" -H "$JSON" -d "{\"from_entity_id\":$EID,\"to_entity_id\":$SRCID,\"role\":\"source\",\"justification\":{\"text\":\"smoke: на стр. 34 сказано так\"}}" $API/links)
SRCLID=$(echo "$SRCLINK" | field id)
check "связь с ролью «источник»" "да" "$([ -n "$SRCLID" ] && echo да || echo нет)"
check "публикация связи-источника" 200 "$(code -X POST -H "$AUTH" -H "$JSON" -d '{}' $API/links/$SRCLID/publish)"
check "публикация источника" 200 "$(code -X POST -H "$AUTH" -H "$JSON" -d '{}' $API/entities/$SRCID/publish)"
contains "обстоятельства цитаты — в связи" 'на стр. 34' "$(curl -s -H "$AUTH" "$API/links?entity_id=$EID")"
CURSRC=$(curl -s -H "$AUTH" $API/entities/$EID | field latest_revision_id)
check "знак источника в тексте" 200 "$(code -X PATCH -H "$AUTH" -H "$JSON" -d "{\"base_revision_id\":\"$CURSRC\",\"body_json\":[{\"id\":\"src1\",\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"smoke текст со знаком\",\"styles\":{}},{\"type\":\"sourceRef\",\"props\":{\"entityId\":\"$SRCID\",\"linkId\":\"$SRCLID\",\"occurrenceId\":\"smoke-src-1\",\"title\":\"smoke: источник\",\"note\":\"smoke: на стр. 34 сказано так\"}}]}]}" $API/entities/$EID)"
SRCREF=$(docker exec -i -e PGPASSWORD="$SPW" supa_db psql -U supabase_admin -d "$DB" -At -c "
select count(*) from app.document_entity_refs f join app.entities e on e.working_revision_id=f.revision_id
 where e.id=$EID and f.entity_id=$SRCID")
check "знак записан вхождением" 1 "$SRCREF"

echo "── Документы"
D=$(curl -s -X POST -H "$AUTH" -H "$JSON" -d "{\"title\":\"smoke: текст\",\"body\":[
  {\"id\":\"s1\",\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"smoke проверка текста\",\"styles\":{}}]},
  {\"id\":\"s2\",\"type\":\"entityCard\",\"props\":{\"entityId\":\"$EID2\",\"occurrenceId\":\"s-c1\"}},
  {\"id\":\"s3\",\"type\":\"mediaImage\",\"props\":{\"assetId\":\"$AID\",\"caption\":\"smoke\"}}]}" $API/documents)
DID=$(echo "$D" | field id)
DREV=$(echo "$D" | field revision_id)
check "создание документа" "да" "$([ -n "$DID" ] && echo да || echo нет)"
REFS=$(docker exec -i -e PGPASSWORD="$SPW" supa_db psql -U supabase_admin -d "$DB" -At -c "
select count(*) from app.document_entity_refs where revision_id='$DREV'")
check "вхождения объектов записаны" 1 "$REFS"
check "ссылка в никуда отклоняется" 400 "$(code -X POST -H "$AUTH" -H "$JSON" -d '{"title":"smoke: плохая","body":[{"id":"x","type":"entityCard","props":{"entityId":"99999999","occurrenceId":"x1"}}]}' $API/documents)"
TEXT=$(docker exec -i -e PGPASSWORD="$SPW" supa_db psql -U supabase_admin -d "$DB" -At -c "
select body_text from app.documents where id=$DID")
contains "поисковый текст извлечён" 'smoke проверка текста' "$TEXT"
D2=$(curl -s -X PATCH -H "$AUTH" -H "$JSON" -d "{\"title\":\"smoke: текст правлен\",\"body\":[{\"id\":\"su-edit\",\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"smoke правка текста SU\",\"styles\":{}}]}],\"base_revision_id\":\"$DREV\"}" $API/documents/$DID)
DREV2=$(echo "$D2" | field revision_id)
check "SU правит текст стандартного документа" "да" "$([ -n "$DREV2" ] && echo да || echo нет)"
TEXT=$(docker exec -i -e PGPASSWORD="$SPW" supa_db psql -U supabase_admin -d "$DB" -At -c "select body_text from app.documents where id=$DID")
contains "новая версия текста сохранена" 'smoke правка текста SU' "$TEXT"

# Незаполненные свойства блока приходят пустыми строками; пустая строка
# в колонке с UUID роняла сохранение внутренней ошибкой.
CURRENT2=$(curl -s -H "$AUTH" $API/entities/$EID2 | field latest_revision_id)
check "карточка объекта без изображения в МультиТексте" 200 "$(code -X PATCH -H "$AUTH" -H "$JSON" -d "{\"base_revision_id\":\"$CURRENT2\",\"body_json\":[{\"id\":\"b1\",\"type\":\"entityCard\",\"props\":{\"entityId\":\"$EID\",\"occurrenceId\":\"\",\"mediaAssetId\":\"\",\"note\":\"\"}}]}" $API/entities/$EID2)"

echo "── Публикация"
MID=$(echo "$C" | field material_id)
# Публикуется запись целиком вместе со своим текстом (Р-78): маршрут у
# владельца, а не у материала.
check "публикация записи" 200 "$(code -X POST -H "$AUTH" -H "$JSON" -d '{"note":"smoke"}' $API/entities/$EID/publish)"
check "объект виден гостю после публикации" 200 "$(code $API/entities/$EID)"
check "повторная публикация той же редакции" 409 "$(code -X POST -H "$AUTH" -H "$JSON" -d '{}' $API/entities/$EID/publish)"
check "гость публиковать не может" 401 "$(code -X POST -H "$JSON" -d '{}' $API/entities/$EID/publish)"
check "публикация несуществующей записи" 404 "$(code -X POST -H "$AUTH" -H "$JSON" -d '{}' $API/entities/99999999/publish)"
code -H "$AUTH" $API/entities/$EID/versions >/dev/null
contains "история показывает публичную редакцию" '"is_public":true' "$(body)"

echo "── Страница для поисковика"
# Готовый HTML записи (Р-65) проверяем снаружи, через Caddy: ломается
# именно маршрут, а не сборка страницы в API.
SITE=${SMOKE_SITE:-https://2vhutemas.ru}
check "запись открывается по адресу" 200 "$(code $API/entities/smoke-proverka)"
contains "в карточке готовая ссылка ГОСТ" 'дата обращения' "$(body)"
check "страница записи отдаётся" 200 "$(code $SITE/entities/smoke-proverka)"
PAGE=$(body)
contains "заголовок страницы — название записи" '<title>smoke: правка — 2ВХУТЕМАС</title>' "$PAGE"
contains "канонический адрес по слагу" 'rel="canonical" href="https://2vhutemas.ru/entities/smoke-proverka"' "$PAGE"
contains "разметка schema.org" 'application/ld+json' "$PAGE"
contains "блок «Как цитировать»" 'Как цитировать' "$PAGE"
contains "знак источника в готовой странице" 'class="source-ref"' "$PAGE"
contains "знак ведёт к объекту-источнику" '/entities/smoke-istochnik' "$PAGE"
contains "клиент оживляет страницу" '/assets/index-' "$PAGE"
check "номер записи ведёт на слаг навсегда" "301 /entities/smoke-proverka" \
  "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' $SITE/entities/$EID | sed 's#https\?://[^/]*##')"
contains "запись попала в sitemap" '/entities/smoke-proverka</loc>' "$(curl -s $SITE/sitemap.xml)"
code -H "$AUTH" $API/materials/$MID >/dev/null
contains "состояние материала" '"published"' "$(body)"
check "архивирование" 204 "$(code -X DELETE -H "$AUTH" $API/materials/$MID)"
check "архивный объект гостю не виден" 404 "$(code $API/entities/$EID)"
check "страница архивной записи — 404" 404 "$(code $SITE/entities/smoke-proverka)"
missing "архивной записи нет в sitemap" 'smoke-proverka' "$(curl -s $SITE/sitemap.xml)"
code -H "$AUTH" $API/entities >/dev/null
ARCHIVED_IN_LIST=$(body | python3 -c "
import json,sys
print(sum(1 for i in json.load(sys.stdin)['items'] if i.get('material_status') == 'archived'))")
check "архива нет в каталоге" 0 "$ARCHIVED_IN_LIST"
code -H "$AUTH" "$API/entities?archived=1&q=smoke" >/dev/null
ARCHIVED_ON_DEMAND=$(body | python3 -c "
import json,sys
print(sum(1 for i in json.load(sys.stdin)['items'] if str(i['id']) == '$EID'))")
check "свой архив виден по запросу" 1 "$ARCHIVED_ON_DEMAND"

echo "── Параметры и показатели"
check "справочник параметров" 200 "$(code -H "$AUTH" $API/parameters)"
contains "типология в справочнике" '"typology"' "$(body)"
code -H "$AUTH" $API/parameters/for-type/architecture_object >/dev/null
contains "набор подсказан ветвью" 'Типология' "$(body)"
code -H "$AUTH" $API/parameters/for-type/who >/dev/null
contains "у ветви «Кто» свой набор" 'full_name' "$(body)"

# Величина заводится справочником, привязывается к ветви и заполняется у записи.
P=$(curl -s -X POST -H "$AUTH" -H "$JSON" -d '{"code":"smoke_capacity","title_ru":"smoke: вместимость","unit":"мест","value_type":"integer","definition":"Только зал"}' $API/parameters)
PID_PARAM=$(echo "$P" | field id)
check "параметр заведён" "да" "$([ -n "$PID_PARAM" ] && echo да || echo нет)"
curl -s -X POST -H "$AUTH" -H "$JSON" -d '{"code":"smoke_set","title_ru":"smoke: набор"}' $API/parameter-sets >/dev/null
check "состав набора" 200 "$(code -X PUT -H "$AUTH" -H "$JSON" -d '{"items":[{"parameter":"smoke_capacity"}]}' $API/parameter-sets/smoke_set/items)"
check "набор привязан к ветви" 200 "$(code -X POST -H "$AUTH" -H "$JSON" -d '{"type":"architecture_object"}' $API/parameter-sets/smoke_set/types)"
check "переименование набора" 200 "$(code -X PATCH -H "$AUTH" -H "$JSON" -d '{"title_ru":"smoke: набор правленый"}' $API/parameter-sets/smoke_set)"
code -H "$AUTH" $API/parameter-sets >/dev/null
contains "правка набора видна" 'smoke: набор правленый' "$(body)"
contains "состав набора с подсказкой" 'smoke_capacity' "$(body)"
code -H "$AUTH" $API/parameters/for-type/architecture_object >/dev/null
contains "величина подсказана ветви" 'smoke_capacity' "$(body)"

REVB=$(curl -s -H "$AUTH" $API/entities/$EID2 | field latest_revision_id)
check "запись показателей" 200 "$(code -X PUT -H "$AUTH" -H "$JSON" -d "{\"indicators\":[{\"title\":\"по проекту\",\"is_current\":true,\"values\":[{\"parameter\":\"smoke_capacity\",\"num_value\":3000}]}],\"base_revision_id\":\"$REVB\"}" $API/entities-indicators/$EID2)"
REV_IND=$(body | field revision_id)
check "правка показателей создала версию" "да" "$([ -n "$REV_IND" ] && echo да || echo нет)"

# Правка записи двигает версию: показатели от прежней версии должны быть
# отклонены, иначе редактор молча теряет введённое.
PATCHED=$(curl -s -X PATCH -H "$AUTH" -H "$JSON" -d "{\"title_ru\":\"smoke: сдвиг версии\",\"base_revision_id\":\"$REV_IND\"}" $API/entities/$EID2)
REV_AFTER=$(echo "$PATCHED" | field revision_id)
check "запись сдвинула версию" "да" "$([ -n "$REV_AFTER" ] && echo да || echo нет)"
check "показатели от устаревшей версии" 409 "$(code -X PUT -H "$AUTH" -H "$JSON" -d "{\"indicators\":[{\"title\":\"сведения\",\"values\":[{\"parameter\":\"smoke_capacity\",\"num_value\":1}]}],\"base_revision_id\":\"$REV_IND\"}" $API/entities-indicators/$EID2)"
check "показатели от текущей версии" 200 "$(code -X PUT -H "$AUTH" -H "$JSON" -d "{\"indicators\":[{\"title\":\"сведения\",\"values\":[{\"parameter\":\"smoke_capacity\",\"num_value\":4242}]}],\"base_revision_id\":\"$REV_AFTER\"}" $API/entities-indicators/$EID2)"
REV_IND=$(body | field revision_id)
code -H "$AUTH" $API/entities/$EID2 >/dev/null
contains "новое значение сохранено" '4242' "$(body)"
code -H "$AUTH" $API/entities/$EID2 >/dev/null
contains "показатели в карточке" 'smoke_capacity' "$(body)"
check "не то значение отклоняется" 400 "$(code -X PUT -H "$AUTH" -H "$JSON" -d "{\"indicators\":[{\"title\":\"сведения\",\"values\":[{\"parameter\":\"smoke_capacity\",\"text_value\":\"много\"}]}]}" $API/entities-indicators/$EID2)"
code -H "$AUTH" "$API/entities?parameter=smoke_capacity&min=1000" >/dev/null
contains "отбор по величине" 'smoke-vtoroy' "$(body)"
code -H "$AUTH" "$API/entities?parameter=smoke_capacity&min=5000" >/dev/null
missing "запись вне диапазона не попала" 'smoke-vtoroy' "$(body)"
check "занятый параметр не удаляется" 400 "$(code -X DELETE -H "$AUTH" $API/parameters/$PID_PARAM)"

# Список — это параметр с типом option и строками в parameter_options; ответ
# пишется ссылкой на строку. Множественный выбор — несколько ответов на один
# параметр, их разрешает признак повторяемости (Р-43).
curl -s -X POST -H "$AUTH" -H "$JSON" -d '{"code":"smoke_material","title_ru":"smoke: материал","value_type":"option","options":[{"code":"brick","title_ru":"кирпич"},{"code":"concrete","title_ru":"железобетон"}]}' $API/parameters >/dev/null
curl -s -X PUT -H "$AUTH" -H "$JSON" -d '{"items":[{"parameter":"smoke_capacity"},{"parameter":"smoke_material"},{"parameter":"smoke_features"}]}' $API/parameter-sets/smoke_set/items >/dev/null
curl -s -X POST -H "$AUTH" -H "$JSON" -d '{"code":"smoke_features","title_ru":"smoke: признаки","value_type":"option","is_repeatable":true,"options":[{"code":"dome","title_ru":"купол"},{"code":"ring","title_ru":"кольцо"}]}' $API/parameters >/dev/null
curl -s -X PUT -H "$AUTH" -H "$JSON" -d '{"items":[{"parameter":"smoke_capacity"},{"parameter":"smoke_material"},{"parameter":"smoke_features"}]}' $API/parameter-sets/smoke_set/items >/dev/null
check "один выбор из списка" 200 "$(code -X PUT -H "$AUTH" -H "$JSON" -d "{\"indicators\":[{\"title\":\"сведения\",\"values\":[{\"parameter\":\"smoke_material\",\"option\":\"brick\"}]}]}" $API/entities-indicators/$EID2)"
code -H "$AUTH" $API/entities/$EID2 >/dev/null
contains "название значения в карточке" 'кирпич' "$(body)"
check "значение не из того списка" 400 "$(code -X PUT -H "$AUTH" -H "$JSON" -d "{\"indicators\":[{\"title\":\"сведения\",\"values\":[{\"parameter\":\"smoke_material\",\"option\":\"dome\"}]}]}" $API/entities-indicators/$EID2)"
check "второй ответ на одиночный список" 400 "$(code -X PUT -H "$AUTH" -H "$JSON" -d "{\"indicators\":[{\"title\":\"сведения\",\"values\":[{\"parameter\":\"smoke_material\",\"option\":\"brick\"},{\"parameter\":\"smoke_material\",\"option\":\"concrete\"}]}]}" $API/entities-indicators/$EID2)"
check "несколько ответов из списка" 200 "$(code -X PUT -H "$AUTH" -H "$JSON" -d "{\"indicators\":[{\"title\":\"сведения\",\"values\":[{\"parameter\":\"smoke_features\",\"option\":\"dome\"},{\"parameter\":\"smoke_features\",\"option\":\"ring\"}]}]}" $API/entities-indicators/$EID2)"
code -H "$AUTH" $API/entities/$EID2 >/dev/null
contains "оба значения списка в карточке" 'кольцо' "$(body)"

# Набор можно прикрепить не только к ветви дерева, но и к отдельной записи:
# большепролётное покрытие есть у вокзала и у рынка, а не у типа (Р-38).
check "набор прикреплён к записи" 200 "$(code -X POST -H "$AUTH" -H "$JSON" -d "{\"entity_id\":$EID2}" $API/parameter-sets/large_span_roof/entities)"
code -H "$AUTH" $API/entities/$EID2/parameters >/dev/null
contains "величины набора подсказаны записи" 'clear_span' "$(body)"
check "величина из набора заполнена" 200 "$(code -X PUT -H "$AUTH" -H "$JSON" -d "{\"indicators\":[{\"title\":\"проект\",\"values\":[{\"parameter\":\"clear_span\",\"num_value\":55.5},{\"parameter\":\"bearing_system\",\"option\":\"dome\"},{\"parameter\":\"bearing_system\",\"option\":\"shell\"}]}]}" $API/entities-indicators/$EID2)"
code -H "$AUTH" "$API/entities?parameter=clear_span&sort=parameter&values=clear_span" >/dev/null
contains "отбор по величине набора" 'smoke-vtoroy' "$(body)"
check "набор отвязан от записи" 204 "$(code -X DELETE -H "$AUTH" $API/parameter-sets/large_span_roof/entities/$EID2)"
code -H "$AUTH" $API/entities/$EID2/parameters >/dev/null
missing "после отвязки величина не подсказывается" 'clear_span' "$(body)"


# Место — такая же величина, как вместимость: роль стала параметром (Р-39).
code -H "$AUTH" $API/parameters/for-type/architecture_object >/dev/null
contains "адрес среди величин" 'Адрес объекта' "$(body)"
contains "открытие среди величин" 'Открытие' "$(body)"
check "место значением параметра" 200 "$(code -X PUT -H "$AUTH" -H "$JSON" -d "{\"indicators\":[{\"title\":\"сведения\",\"values\":[{\"parameter\":\"address\",\"place_id\":\"$PID\"},{\"parameter\":\"opening\",\"date_start_year\":1945}]}]}" $API/entities-indicators/$EID)"
code -H "$AUTH" $API/entities/$EID >/dev/null
contains "место в карточке" '"value_type":"place"' "$(body)"
contains "дата в карточке" '"value_type":"date"' "$(body)"
check "HTML карточки с адресом" 200 "$(code -H "$AUTH" $API/entities/$EID/card)"
contains "HTML сохраняет улицу, дом и помещение" 'smoke-страна, smoke-город, smoke-улица, 17, 4' "$(body)"

code -H "$AUTH" $API/places/$PID/usage >/dev/null
contains "где используется место" 'Адрес объекта' "$(body)"
check "место без ссылки отклоняется" 400 "$(code -X PUT -H "$AUTH" -H "$JSON" -d "{\"indicators\":[{\"title\":\"сведения\",\"values\":[{\"parameter\":\"address\",\"text_value\":\"где\"}]}]}" $API/entities-indicators/$EID)"

echo "── Лекции"
# Страница лекций — это каталог, отобранный по ветви «Служебные»
# и отсортированный по величине «Номер лекции» (Р-44).
L2=$(curl -s -X POST -H "$AUTH" -H "$JSON" -d '{"type":"lecture","slug":"smoke-lekciya-dva","title_ru":"smoke: лекция вторая"}' $API/entities)
LID2=$(echo "$L2" | field id)
LREV2=$(echo "$L2" | field revision_id)
L1=$(curl -s -X POST -H "$AUTH" -H "$JSON" -d '{"type":"lecture","slug":"smoke-lekciya-odin","title_ru":"smoke: лекция первая"}' $API/entities)
LID1=$(echo "$L1" | field id)
LREV1=$(echo "$L1" | field revision_id)
check "лекция создана" "да" "$([ -n "$LID1" ] && echo да || echo нет)"
curl -s -X PUT -H "$AUTH" -H "$JSON" -d "{\"indicators\":[{\"title\":\"сведения\",\"values\":[{\"parameter\":\"lecture_number\",\"num_value\":2},{\"parameter\":\"course\",\"text_value\":\"smoke: курс\"}]}],\"base_revision_id\":\"$LREV2\"}" $API/entities-indicators/$LID2 >/dev/null
curl -s -X PUT -H "$AUTH" -H "$JSON" -d "{\"indicators\":[{\"title\":\"сведения\",\"values\":[{\"parameter\":\"lecture_number\",\"num_value\":1},{\"parameter\":\"course\",\"text_value\":\"smoke: курс\"}]}],\"base_revision_id\":\"$LREV1\"}" $API/entities-indicators/$LID1 >/dev/null
ORDER=$(curl -s -H "$AUTH" "$API/entities?type=service&parameter=lecture_number&sort=parameter&order=asc&values=lecture_number,course" | python3 -c "
import json,sys
items = [i for i in json.load(sys.stdin)['items'] if i['slug'].startswith('smoke-lekciya')]
print(','.join(str(i['values'].get('lecture_number')) for i in items))")
check "лекции по порядку номеров" "1,2" "$ORDER"
code -H "$AUTH" "$API/entities?type=service&values=lecture_number,course&q=smoke" >/dev/null
contains "курс приходит в списке" 'smoke: курс' "$(body)"
code -H "$AUTH" "$API/entities?type=what&parameter=lecture_number&sort=parameter" >/dev/null
missing "лекции не попали в энциклопедию" 'smoke-lekciya' "$(body)"

echo "── Адреса сайта"
# Новый контур стоит на корне, прежний сайт — под /old (Р-59). Проверяем
# снаружи, через Caddy: путь ломается именно здесь, а не в приложении.
SITE=${SMOKE_SITE:-https://2vhutemas.ru}
here() { curl -s -o /dev/null -w '%{redirect_url}' "$1" | sed 's#^https\?://[^/]*##'; }
# Ищем имя файла сборки: пустой <div id="root"> есть и у старого сайта,
# и такая проверка прошла бы, даже если на корне остался он.
contains "корень отдаёт новый контур" "/assets/index-" "$(curl -s $SITE/)"
# Номер записи ведёт на слаг (Р-65), поэтому идём за перенаправлением:
# проверяем, что ссылка на запись в итоге открывает страницу, а не обрывается.
contains "ссылка на запись открывается" "/assets/index-" "$(curl -sL $SITE/entities/42)"
check "значок вкладки на месте" "image/vnd.microsoft.icon" "$(curl -s -o /dev/null -w '%{content_type}' $SITE/favicon.ico)"
# Клиент весит полтора мегабайта: без сжатия сайт выглядит незагружающимся.
ASSET=$(curl -s $SITE/ | grep -o "/assets/index-[A-Za-z0-9_-]*\.js" | head -1)
# Сравниваем вес: curl на сервере старый и про content_encoding не знает,
# а вдвое меньший ответ ни с чем не спутаешь.
PLAIN=$(curl -s -o /dev/null -H 'Accept-Encoding: identity' -w '%{size_download}' $SITE$ASSET)
GZIP=$(curl -s -o /dev/null -H 'Accept-Encoding: gzip' -w '%{size_download}' $SITE$ASSET)
SMALLER=нет
[ "${GZIP:-0}" -gt 0 ] && [ "${PLAIN:-0}" -gt 0 ] && [ "$GZIP" -lt $((PLAIN / 2)) ] && SMALLER=да
check "клиент отдаётся сжатым" "да" "$SMALLER"
contains "прежний сайт под /old" "Архитектурный таймлайн" "$(curl -s $SITE/old/)"
check "прежняя страница ведёт под /old" "/old/praktika-graph.html" "$(here $SITE/praktika-graph.html)"
check "прежний адрес /new ведёт на корень" "/lectures" "$(here $SITE/new/lectures)"
# Поисковику (Р-65): служебные файлы, настоящий 404 и закрытый прежний сайт.
contains "robots.txt указывает sitemap" 'Sitemap: https://2vhutemas.ru/sitemap.xml' "$(curl -s $SITE/robots.txt)"
contains "sitemap.xml собран" '<urlset' "$(curl -s $SITE/sitemap.xml)"
check "несуществующая страница — 404" 404 "$(code $SITE/net-takoj-stranicy)"
check "несуществующая запись — 404" 404 "$(code $SITE/entities/net-takoj-zapisi)"
contains "главная описана для поисковика" 'rel="canonical" href="https://2vhutemas.ru/"' "$(curl -s $SITE/)"
# «О проекте» — ветвь сущностей; прежний адрес манифеста сохраняет постоянную ссылку.
check "раздел «О проекте» доступен" 200 "$(code $SITE/about)"
check "старый адрес манифеста ведёт на сущность" "301 $SITE/entities/about-manifest" \
  "$(curl -s -o /dev/null -w "%{http_code} %{redirect_url}" $SITE/about/manifest)"
check "бывший конструктор ведёт на сущность логотипа" "301 $SITE/entities/about-logo" \
  "$(curl -s -o /dev/null -w "%{http_code} %{redirect_url}" $SITE/about/logo/tool)"
# Метрика (Р-66): счётчик в общем шаблоне — и на главной, и в готовой странице от API.
contains "счётчик Метрики на главной" 'mc.yandex.ru/metrika/tag.js?id=108525511' "$(curl -s $SITE/)"
contains "счётчик Метрики на странице раздела" 'mc.yandex.ru/metrika/tag.js?id=108525511' "$(curl -s $SITE/objects)"
contains "прежний сайт закрыт от индекса" 'noindex' "$(curl -s -D - -o /dev/null $SITE/old/ | tr 'A-Z' 'a-z')"

echo "── Уборка"
docker exec -i -e PGPASSWORD="$SPW" supa_db psql -U supabase_admin -d "$DB" -At -q -c "
update app.entities set status='draft',published_revision_id=null,working_revision_id=null where id in ($EID,$EID2,$LID1,$LID2);
update app.links set status='draft',published_revision_id=null,working_revision_id=null where from_entity_id in ($EID,$EID2) or to_entity_id in ($EID,$EID2);
create temporary table smoke_document_ids as
select ${DID}::bigint as id
union
select a.document_id from app.attachments a join app.targets t on t.id = a.target_id
 where a.document_id is not null and (t.entity_id in ($EID,$EID2) or t.link_id in
   (select id from app.links where from_entity_id in ($EID,$EID2) or to_entity_id in ($EID,$EID2)));
delete from app.attachments a using app.targets t
 where a.target_id = t.id and (t.entity_id in ($EID,$EID2) or t.link_id in
   (select id from app.links where from_entity_id in ($EID,$EID2) or to_entity_id in ($EID,$EID2)));
delete from app.document_entity_refs r using app.revisions rev, app.materials m
 where r.revision_id = rev.id and rev.material_id = m.id
   and (m.entity_id in ($EID,$EID2) or m.document_id in (select id from smoke_document_ids));
delete from app.revision_reviews rr using app.revisions r, app.materials m
 where rr.revision_id = r.id and r.material_id = m.id and (m.entity_id in ($EID,$EID2) or m.document_id in (select id from smoke_document_ids));
delete from app.entity_tags where entity_id in ($EID,$EID2);
delete from app.media_tags where asset_id = '$AID';
delete from app.revisions rev using app.materials m where rev.material_id = m.id
   and (m.entity_id in ($EID,$EID2) or m.document_id in (select id from smoke_document_ids) or m.asset_id = '$AID'
        or m.link_id in (select id from app.links where from_entity_id in ($EID,$EID2)));
delete from app.material_credits mc using app.materials m where mc.material_id = m.id
   and (m.entity_id in ($EID,$EID2) or m.document_id in (select id from smoke_document_ids) or m.asset_id = '$AID'
        or m.link_id in (select id from app.links where from_entity_id in ($EID,$EID2)));
delete from app.materials where entity_id in ($EID,$EID2) or document_id in (select id from smoke_document_ids)
   or asset_id = '$AID' or link_id in (select id from app.links where from_entity_id in ($EID,$EID2));
delete from app.links where from_entity_id in ($EID,$EID2,${SRCID:-0}) or to_entity_id in ($EID,$EID2,${SRCID:-0});
delete from app.documents where id in (select id from smoke_document_ids) or id=$DID;
delete from app.revision_reviews rr using app.revisions r, app.materials m
 where rr.revision_id = r.id and r.material_id = m.id and m.entity_id in ($LID1,$LID2);
delete from app.revisions rev using app.materials m
 where rev.material_id = m.id and m.entity_id in ($LID1,$LID2);
delete from app.material_credits mc using app.materials m
 where mc.material_id = m.id and m.entity_id in ($LID1,$LID2);
delete from app.materials where entity_id in ($LID1,$LID2);
delete from app.entities where id in ($EID,$EID2,$LID1,$LID2,${SRCID:-0});
delete from app.media_files where asset_id = '$AID';
delete from app.media_assets where id = '$AID';
delete from app.places where id = '$PID';
delete from app.tags where lower(title) like 'smoke-%';
delete from app.parameter_sets where code like 'smoke%';
delete from app.parameters where code like 'smoke%';
" >/dev/null
LEFT=$(docker exec -i -e PGPASSWORD="$SPW" supa_db psql -U supabase_admin -d "$DB" -At -c "
select (select count(*) from app.entities where slug like 'smoke-%')
     + (select count(*) from app.places where country like 'smoke-%')
     + (select count(*) from app.tags where lower(title) like 'smoke-%')
     + (select count(*) from app.parameters where code like 'smoke%')")
check "тестовые записи убраны" 0 "$LEFT"
rm -f /tmp/smoke.jpg /tmp/smoke.out

echo
echo "Пройдено: $PASS, сбоев: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
