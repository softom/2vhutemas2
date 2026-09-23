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
code -H "$AUTH" $API/capabilities >/dev/null
contains "дерево типов" '"entity_types"' "$(body)"
contains "корневая ветвь в дереве" '"who"' "$(body)"
contains "ветвь ниже корня" '"architecture_object"' "$(body)"
contains "словарь видов изображений" 'media_kinds' "$(body)"
contains "словарь ролей мест" 'place_roles' "$(body)"

echo "── Объекты"
check "каталог гостю" 200 "$(code $API/entities)"
check "каталог под входом" 200 "$(code -H "$AUTH" $API/entities)"
# Прежнее имя поля принимается как псевдоним корневой ветви (Р-37).
C=$(curl -s -X POST -H "$AUTH" -H "$JSON" -d '{"kind":"object","slug":"smoke-proverka","title_ru":"smoke: проверка"}' $API/entities)
EID=$(echo "$C" | field id)
REV=$(echo "$C" | field revision_id)
check "создание объекта" "да" "$([ -n "$EID" ] && echo да || echo нет)"
check "карточка под входом" 200 "$(code -H "$AUTH" $API/entities/$EID)"
contains "карточка отдаёт места" '"places"' "$(body)"
contains "карточка отдаёт файлы" '"media"' "$(body)"
contains "карточка отдаёт метки" '"tags"' "$(body)"
contains "карточка отдаёт путь по дереву" '"type_path"' "$(body)"
check "черновик гостю не виден" 404 "$(code $API/entities/$EID)"
check "неизвестный тип отклоняется" 400 "$(code -X POST -H "$AUTH" -H "$JSON" -d '{"type":"net-takogo","slug":"smoke-net-tipa","title_ru":"smoke: нет типа"}' $API/entities)"
code -H "$AUTH" "$API/entities?type=what" >/dev/null
contains "отбор по корневой ветви" 'smoke-proverka' "$(body)"
code -H "$AUTH" "$API/entities?type=who" >/dev/null
missing "запись не попала в чужую ветвь" 'smoke-proverka' "$(body)"
code -H "$AUTH" "$API/entities?kind=object" >/dev/null
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
check "привязка файла к объекту" 201 "$(code -X POST -H "$AUTH" -H "$JSON" -d "{\"entity_id\":$EID,\"asset_id\":\"$AID\",\"role\":\"gallery\"}" $API/media/attachments)"
check "повторная привязка" 409 "$(code -X POST -H "$AUTH" -H "$JSON" -d "{\"entity_id\":$EID,\"asset_id\":\"$AID\",\"role\":\"gallery\"}" $API/media/attachments)"
ATT=$(curl -s -H "$AUTH" $API/entities/$EID | python3 -c "
import json,sys
print(json.load(sys.stdin)['media'][0]['attachment_id'])")
code -H "$AUTH" $API/entities >/dev/null
COVER=$(body | python3 -c "
import json,sys
print(next((1 for i in json.load(sys.stdin)['items'] if str(i['id']) == '$EID' and i.get('cover_asset_id')), 0))")
check "обложка в каталоге" 1 "$COVER"
check "порядок изображений" 200 "$(code -X PUT -H "$AUTH" -H "$JSON" -d "{\"entity_id\":$EID,\"order\":[$ATT]}" $API/media/attachments/order)"
check "чужая привязка в порядке" 400 "$(code -X PUT -H "$AUTH" -H "$JSON" -d "{\"entity_id\":$EID,\"order\":[999999]}" $API/media/attachments/order)"

echo "── Места"
check "справочник мест гостю закрыт" 401 "$(code $API/places)"
check "справочник мест под входом" 200 "$(code -H "$AUTH" $API/places)"
P=$(curl -s -X POST -H "$AUTH" -H "$JSON" -d '{"country":"smoke-страна","settlement":"smoke-город","precision":"settlement"}' $API/places)
PID=$(echo "$P" | field id)
check "создание места" "да" "$([ -n "$PID" ] && echo да || echo нет)"
SAME=$(curl -s -X POST -H "$AUTH" -H "$JSON" -d '{"country":"SMOKE-СТРАНА","settlement":" smoke-город "}' $API/places | field id)
check "повтор адреса не плодит место" "$PID" "$SAME"
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
C2=$(curl -s -X POST -H "$AUTH" -H "$JSON" -d '{"type":"architecture_object","slug":"smoke-vtoroy","title_ru":"smoke: второй"}' $API/entities)
EID2=$(echo "$C2" | field id)
REVB=$(echo "$C2" | field revision_id)
check "связь без обоснования" 422 "$(code -X POST -H "$AUTH" -H "$JSON" -d "{\"from_entity_id\":$EID,\"to_entity_id\":$EID2,\"justification\":{}}" $API/links)"
check "связь с обоснованием" 201 "$(code -X POST -H "$AUTH" -H "$JSON" -d "{\"from_entity_id\":$EID,\"to_entity_id\":$EID2,\"justification\":{\"text\":\"smoke: обоснование\"}}" $API/links)"
code -H "$AUTH" "$API/links?entity_id=$EID" >/dev/null
contains "окружение с обоснованием" 'smoke: обоснование' "$(body)"

echo "── Документы"
D=$(curl -s -X POST -H "$AUTH" -H "$JSON" -d "{\"title\":\"smoke: текст\",\"attach_to_entity_id\":$EID,\"body\":[
  {\"id\":\"s1\",\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"smoke проверка текста\",\"styles\":{}}]},
  {\"id\":\"s2\",\"type\":\"entityCard\",\"props\":{\"entityId\":\"$EID2\",\"occurrenceId\":\"s-c1\"}},
  {\"id\":\"s3\",\"type\":\"mediaImage\",\"props\":{\"assetId\":\"$AID\",\"caption\":\"smoke\"}}]}" $API/documents)
DID=$(echo "$D" | field id)
DREV=$(echo "$D" | field revision_id)
check "создание документа" "да" "$([ -n "$DID" ] && echo да || echo нет)"
REFS=$(docker exec -i -e PGPASSWORD="$SPW" supa_db psql -U supabase_admin -d postgres -At -c "
select count(*) from app.document_entity_refs where revision_id='$DREV'")
check "вхождения объектов записаны" 1 "$REFS"
check "ссылка в никуда отклоняется" 400 "$(code -X POST -H "$AUTH" -H "$JSON" -d '{"title":"smoke: плохая","body":[{"id":"x","type":"entityCard","props":{"entityId":"99999999","occurrenceId":"x1"}}]}' $API/documents)"
TEXT=$(docker exec -i -e PGPASSWORD="$SPW" supa_db psql -U supabase_admin -d postgres -At -c "
select body_text from app.documents where id=$DID")
contains "поисковый текст извлечён" 'smoke проверка текста' "$TEXT"

echo "── Публикация"
MID=$(echo "$C" | field material_id)
check "публикация версии" 200 "$(code -X POST -H "$AUTH" -H "$JSON" -d '{"note":"smoke"}' $API/materials/$MID/publish)"
check "объект виден гостю после публикации" 200 "$(code $API/entities/$EID)"
check "повторная публикация той же версии" 409 "$(code -X POST -H "$AUTH" -H "$JSON" -d '{}' $API/materials/$MID/publish)"
code -H "$AUTH" $API/materials/$MID >/dev/null
contains "состояние материала" '"published"' "$(body)"
check "архивирование" 204 "$(code -X DELETE -H "$AUTH" $API/materials/$MID)"
check "архивный объект гостю не виден" 404 "$(code $API/entities/$EID)"
code -H "$AUTH" $API/entities >/dev/null
ARCHIVED_IN_LIST=$(body | python3 -c "
import json,sys
print(sum(1 for i in json.load(sys.stdin)['items'] if i.get('material_status') == 'archived'))")
check "архива нет в каталоге" 0 "$ARCHIVED_IN_LIST"
code -H "$AUTH" "$API/entities?archived=1" >/dev/null
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
code -H "$AUTH" $API/parameters/for-type/architecture_object >/dev/null
contains "величина подсказана ветви" 'smoke_capacity' "$(body)"

check "запись показателей" 200 "$(code -X PUT -H "$AUTH" -H "$JSON" -d "{\"indicators\":[{\"title\":\"по проекту\",\"is_current\":true,\"values\":[{\"parameter\":\"smoke_capacity\",\"num_value\":3000}]}],\"base_revision_id\":\"$REVB\"}" $API/entities-indicators/$EID2)"
REV_IND=$(body | field revision_id)
check "правка показателей создала версию" "да" "$([ -n "$REV_IND" ] && echo да || echo нет)"
code -H "$AUTH" $API/entities/$EID2 >/dev/null
contains "показатели в карточке" 'smoke_capacity' "$(body)"
check "не то значение отклоняется" 400 "$(code -X PUT -H "$AUTH" -H "$JSON" -d "{\"indicators\":[{\"title\":\"сведения\",\"values\":[{\"parameter\":\"smoke_capacity\",\"text_value\":\"много\"}]}]}" $API/entities-indicators/$EID2)"
code -H "$AUTH" "$API/entities?parameter=smoke_capacity&min=1000" >/dev/null
contains "отбор по величине" 'smoke-vtoroy' "$(body)"
code -H "$AUTH" "$API/entities?parameter=smoke_capacity&min=5000" >/dev/null
missing "запись вне диапазона не попала" 'smoke-vtoroy' "$(body)"
check "занятый параметр не удаляется" 400 "$(code -X DELETE -H "$AUTH" $API/parameters/$PID_PARAM)"

echo "── Уборка"
docker exec -i -e PGPASSWORD="$SPW" supa_db psql -U supabase_admin -d postgres -At -q -c "
delete from app.attachments a using app.targets t
 where a.target_id = t.id and (t.entity_id in ($EID,$EID2) or t.link_id in
   (select id from app.links where from_entity_id in ($EID,$EID2) or to_entity_id in ($EID,$EID2)));
delete from app.document_entity_refs r using app.revisions rev, app.materials m
 where r.revision_id = rev.id and rev.material_id = m.id
   and (m.entity_id in ($EID,$EID2) or m.document_id = $DID);
delete from app.revision_reviews rr using app.revisions r, app.materials m
 where rr.revision_id = r.id and r.material_id = m.id and (m.entity_id in ($EID,$EID2) or m.document_id = $DID);
delete from app.entity_tags where entity_id in ($EID,$EID2);
delete from app.entity_dates where entity_id in ($EID,$EID2);
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
delete from app.parameter_sets where code like 'smoke%';
delete from app.parameters where code like 'smoke%';
" >/dev/null
LEFT=$(docker exec -i -e PGPASSWORD="$SPW" supa_db psql -U supabase_admin -d postgres -At -c "
select (select count(*) from app.entities where slug like 'smoke-%')
     + (select count(*) from app.places where country like 'smoke-%')
     + (select count(*) from app.tags where lower(title) like 'smoke-%')
     + (select count(*) from app.parameters where code like 'smoke%')")
check "тестовые записи убраны" 0 "$LEFT"
rm -f /tmp/smoke.jpg /tmp/smoke.out

echo
echo "Пройдено: $PASS, сбоев: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
