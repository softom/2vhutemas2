#!/bin/bash
# Прогон основных маршрутов нового контура.
#
# Проверяет то, что ломалось на практике: списки и карточки, медиатеку,
# места, метки, связи, права гостя. Создаёт свои записи с пометкой smoke
# и убирает их за собой; чужие данные не трогает.
#
# Запускается на сервере: bash smoke.sh
set +e
API=http://127.0.0.1:7073/api/v1
UID_T="e6777073-6cae-46b5-8d48-a499e188f230"
SPW=$(grep -E "^POSTGRES_PASSWORD=" /opt/2vhutemas/.env | cut -d= -f2-)
PASS=0
FAIL=0

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
code -H "$AUTH" $API/capabilities >/dev/null
contains "словарь видов сущностей" 'entity_kinds' "$(body)"
contains "словарь видов изображений" 'media_kinds' "$(body)"
contains "словарь ролей мест" 'place_roles' "$(body)"

echo "── Объекты"
check "каталог гостю" 200 "$(code $API/entities)"
check "каталог под входом" 200 "$(code -H "$AUTH" $API/entities)"
C=$(curl -s -X POST -H "$AUTH" -H "$JSON" -d '{"kind":"object","slug":"smoke-proverka","title_ru":"smoke: проверка"}' $API/entities)
EID=$(echo "$C" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
REV=$(echo "$C" | sed -n 's/.*"revision_id":"\([^"]*\)".*/\1/p')
check "создание объекта" "да" "$([ -n "$EID" ] && echo да || echo нет)"
check "карточка под входом" 200 "$(code -H "$AUTH" $API/entities/$EID)"
contains "карточка отдаёт места" '"places"' "$(body)"
contains "карточка отдаёт файлы" '"media"' "$(body)"
contains "карточка отдаёт метки" '"tags"' "$(body)"
check "черновик гостю не виден" 404 "$(code $API/entities/$EID)"
check "повтор адреса отклоняется" 409 "$(code -X POST -H "$AUTH" -H "$JSON" -d '{"kind":"object","slug":"smoke-proverka","title_ru":"smoke: повтор"}' $API/entities)"
check "правка от устаревшей версии" 409 "$(code -X PATCH -H "$AUTH" -H "$JSON" -d '{"title_ru":"smoke","base_revision_id":"00000000-0000-4000-8000-000000000000"}' $API/entities/$EID)"
check "правка от текущей версии" 200 "$(code -X PATCH -H "$AUTH" -H "$JSON" -d "{\"title_ru\":\"smoke: правка\",\"base_revision_id\":\"$REV\"}" $API/entities/$EID)"

echo "── Медиатека"
check "список файлов" 200 "$(code -H "$AUTH" $API/media)"
contains "состояние вариантов" '"files"' "$(body)"
docker exec app_api /usr/local/bin/magickw -size 400x300 gradient:navy-orange /tmp/smoke.jpg >/dev/null 2>&1
docker cp app_api:/tmp/smoke.jpg /tmp/smoke.jpg >/dev/null 2>&1
A=$(curl -s -X POST -H "$AUTH" -F "file=@/tmp/smoke.jpg;type=image/jpeg" -F "caption=smoke: файл" $API/media)
AID=$(echo "$A" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
check "загрузка файла" "да" "$([ -n "$AID" ] && echo да || echo нет)"
contains "превью готово" '"thumbnail"' "$A"
check "приватный файл гостю" 404 "$(code "$API/media/$AID/file?variant=thumbnail")"
check "файл под входом" 200 "$(code -H "$AUTH" "$API/media/$AID/file?variant=thumbnail")"
check "привязка файла к объекту" 201 "$(code -X POST -H "$AUTH" -H "$JSON" -d "{\"entity_id\":$EID,\"asset_id\":\"$AID\",\"role\":\"gallery\"}" $API/media/attachments)"
check "повторная привязка" 409 "$(code -X POST -H "$AUTH" -H "$JSON" -d "{\"entity_id\":$EID,\"asset_id\":\"$AID\",\"role\":\"gallery\"}" $API/media/attachments)"

echo "── Места"
check "справочник мест гостю закрыт" 401 "$(code $API/places)"
check "справочник мест под входом" 200 "$(code -H "$AUTH" $API/places)"
P=$(curl -s -X POST -H "$AUTH" -H "$JSON" -d '{"country":"smoke-страна","settlement":"smoke-город","precision":"settlement"}' $API/places)
PID=$(echo "$P" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
check "создание места" "да" "$([ -n "$PID" ] && echo да || echo нет)"
check "пустое место отклоняется" 400 "$(code -X POST -H "$AUTH" -H "$JSON" -d '{}' $API/places)"
check "широта без долготы отклоняется" 400 "$(code -X POST -H "$AUTH" -H "$JSON" -d '{"settlement":"smoke","lat":10}' $API/places)"
check "привязка места" 201 "$(code -X POST -H "$AUTH" -H "$JSON" -d "{\"entity_id\":$EID,\"role\":\"address\",\"place_id\":\"$PID\"}" $API/places/attachments)"
check "где используется место" 200 "$(code -H "$AUTH" $API/places/$PID/usage)"

echo "── Метки"
check "справочник меток" 200 "$(code -H "$AUTH" $API/tags)"
code -X PUT -H "$AUTH" -H "$JSON" -d '{"tags":["smoke-метка","#smoke-вторая"]}' $API/tags/entities/$EID >/dev/null
contains "метка без решётки" '"smoke-вторая"' "$(body)"
code -X PUT -H "$AUTH" -H "$JSON" -d '{"tags":["SMOKE-МЕТКА","smoke-вторая"]}' $API/tags/entities/$EID >/dev/null
DOUBLES=$(docker exec -i -e PGPASSWORD="$SPW" supa_db psql -U supabase_admin -d postgres -At -c "
select count(*) from app.tags where lower(title) like 'smoke-%'")
check "регистр не плодит метки" 2 "$DOUBLES"
check "гость метки не меняет" 401 "$(code -X PUT -H "$JSON" -d '{"tags":["взлом"]}' $API/tags/entities/$EID)"

echo "── Связи"
C2=$(curl -s -X POST -H "$AUTH" -H "$JSON" -d '{"kind":"object","slug":"smoke-vtoroy","title_ru":"smoke: второй"}' $API/entities)
EID2=$(echo "$C2" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
check "связь без обоснования" 422 "$(code -X POST -H "$AUTH" -H "$JSON" -d "{\"from_entity_id\":$EID,\"to_entity_id\":$EID2,\"justification\":{}}" $API/links)"
check "связь с обоснованием" 201 "$(code -X POST -H "$AUTH" -H "$JSON" -d "{\"from_entity_id\":$EID,\"to_entity_id\":$EID2,\"justification\":{\"text\":\"smoke: обоснование\"}}" $API/links)"
code -H "$AUTH" "$API/links?entity_id=$EID" >/dev/null
contains "окружение с обоснованием" 'smoke: обоснование' "$(body)"

echo "── Документы"
D=$(curl -s -X POST -H "$AUTH" -H "$JSON" -d "{\"title\":\"smoke: текст\",\"attach_to_entity_id\":$EID,\"body\":[
  {\"id\":\"s1\",\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"smoke проверка текста\",\"styles\":{}}]},
  {\"id\":\"s2\",\"type\":\"entityCard\",\"props\":{\"entityId\":\"$EID2\",\"occurrenceId\":\"s-c1\"}},
  {\"id\":\"s3\",\"type\":\"mediaImage\",\"props\":{\"assetId\":\"$AID\",\"caption\":\"smoke\"}}]}" $API/documents)
DID=$(echo "$D" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
DREV=$(echo "$D" | sed -n 's/.*"revision_id":"\([^"]*\)".*/\1/p')
check "создание документа" "да" "$([ -n "$DID" ] && echo да || echo нет)"
REFS=$(docker exec -i -e PGPASSWORD="$SPW" supa_db psql -U supabase_admin -d postgres -At -c "
select count(*) from app.document_entity_refs where revision_id='$DREV'")
check "вхождения объектов записаны" 1 "$REFS"
check "ссылка в никуда отклоняется" 400 "$(code -X POST -H "$AUTH" -H "$JSON" -d '{"title":"smoke: плохая","body":[{"id":"x","type":"entityCard","props":{"entityId":"99999999","occurrenceId":"x1"}}]}' $API/documents)"
TEXT=$(docker exec -i -e PGPASSWORD="$SPW" supa_db psql -U supabase_admin -d postgres -At -c "
select body_text from app.documents where id=$DID")
contains "поисковый текст извлечён" 'smoke проверка текста' "$TEXT"

echo "── Уборка"
docker exec -i -e PGPASSWORD="$SPW" supa_db psql -U supabase_admin -d postgres -At -q -c "
delete from app.attachments a using app.targets t
 where a.target_id = t.id and (t.entity_id in ($EID,$EID2) or t.link_id in
   (select id from app.links where from_entity_id in ($EID,$EID2) or to_entity_id in ($EID,$EID2)));
delete from app.document_entity_refs r using app.revisions rev, app.materials m
 where r.revision_id = rev.id and rev.material_id = m.id
   and (m.entity_id in ($EID,$EID2) or m.document_id = $DID);
delete from app.entity_tags where entity_id in ($EID,$EID2);
delete from app.media_tags where asset_id = '$AID';
delete from app.revisions rev using app.materials m where rev.material_id = m.id
   and (m.entity_id in ($EID,$EID2) or m.document_id = $DID or m.asset_id = '$AID'
        or m.link_id in (select id from app.links where from_entity_id in ($EID,$EID2)));
delete from app.material_credits mc using app.materials m where mc.material_id = m.id
   and (m.entity_id in ($EID,$EID2) or m.document_id = $DID or m.asset_id = '$AID'
        or m.link_id in (select id from app.links where from_entity_id in ($EID,$EID2)));
delete from app.materials where entity_id in ($EID,$EID2) or document_id = $DID
   or asset_id = '$AID' or link_id in (select id from app.links where from_entity_id in ($EID,$EID2));
delete from app.links where from_entity_id in ($EID,$EID2) or to_entity_id in ($EID,$EID2);
delete from app.documents where id = $DID or title like 'smoke:%' or title = 'Обоснование связи' and id not in (select document_id from app.attachments where document_id is not null);
delete from app.entities where id in ($EID,$EID2);
delete from app.media_files where asset_id = '$AID';
delete from app.media_assets where id = '$AID';
delete from app.places where id = '$PID';
delete from app.tags where lower(title) like 'smoke-%';
" >/dev/null
LEFT=$(docker exec -i -e PGPASSWORD="$SPW" supa_db psql -U supabase_admin -d postgres -At -c "
select (select count(*) from app.entities where slug like 'smoke-%')
     + (select count(*) from app.places where country like 'smoke-%')
     + (select count(*) from app.tags where lower(title) like 'smoke-%')")
check "тестовые записи убраны" 0 "$LEFT"
rm -f /tmp/smoke.jpg /tmp/smoke.out

echo
echo "Пройдено: $PASS, сбоев: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
