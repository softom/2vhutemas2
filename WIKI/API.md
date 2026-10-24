---
title: API проекта
updated: 2026-10-01
status: сверено с маршрутами API и миграциями 0026–0027; ограничения указаны явно
---

# API проекта

Действующий контракт нового контура: `https://2vhutemas.ru/api/v1`. Источники — [маршруты](../api/src/routes/), [регистрация API](../api/src/main.ts), [схема данных](Схема%20данных.md). Старый контур `/old` и его API здесь не описываются. Предыдущая редакция — [в архиве](Архив/API%20—%20до%20сверки%202026-10-01.md).

## Общий контракт

- JSON в UTF-8, `Content-Type: application/json`; загрузка оригинала — `multipart/form-data`.
- Вход: `Authorization: Bearer <access_token>` Supabase Auth; подпись проверяется API. `GET /me` гостю возвращает `authenticated: false`. SU удовлетворяет любой проверке права.
- Гость видит опубликованную редакцию. Рабочую видят `edit`, `review` или `su` (`canSeeDrafts`). Одно право `view` не означает доступ ко всем черновикам; выдача файлов дополнительно учитывает медиа-сессию.
- Внутренние связи — UID. Сущности/связи имеют bigint ID, версии/материалы/файлы/параметры — UUID. Код типа/параметра и slug — входные имена, сервер разрешает их в ID; они не становятся FK.
- Списки обычно отвечают `{items, next_cursor}`; справочники — `{items}`. `cursor` непрозрачен, `limit` ограничен значениями из `GET /capabilities`; не вычислять следующий курсор самостоятельно.
- Создание обычно 201, переиспользование места 200; успешное удаление/архивирование обычно 204. Архивирование не удаляет историю и оригиналы.
- Ответ и журналы содержат `x-request-id`. Переданный заголовок принимается при длине 8–64 и допустимых символах.
- CORS разрешает настроенные источники. Сейчас `Access-Control-Allow-Methods` не перечисляет PUT: для внешнего клиента с PUT это известное ограничение; работа собственного клиента на том же origin от этого не зависит.

Права проверяются сервером. Обозначение «чтение» ниже означает фильтрацию по доступу, а не разрешение видеть любые данные.

## Ошибки

```json
{"error":{"code":"version_conflict","message":"Материал изменён","details":null,"request_id":"..."}}
```

| HTTP | code |
|---|---|
| 400 | `validation_failed` |
| 401 | `unauthenticated` |
| 403 | `permission_denied` |
| 404 | `not_found` |
| 409 | `version_conflict`, `duplicate`, `owned_content` |
| 413 | `payload_too_large` |
| 422 | `link_requires_justification` |
| 500 | `internal_error` |

`owned_content` запрещает отдельную правку/публикацию принадлежащего владельцу текста; когда владелец известен, он передаётся в `details`. Недоступный гостю черновик карточки отвечает 404.

## Полный реестр маршрутов v1

Все пути ниже относительны `/api/v1`. Наличие таблицы в БД само по себе не означает наличие публичного API.

### Служебное и сессия

| Метод и путь | Доступ | Вход → результат |
|---|---|---|
| `GET /health` | публичный | Статус, задержка БД, версия контракта |
| `GET /capabilities` | публичный | `contract_version`, `blocknote_schema_version`, `limits`, дерево `entity_types`, `dictionaries`, `presentations` по типу/режиму |
| `GET /me` | гость/токен | Вход, contributor_id, имя, статус, permissions |
| `GET /site-header` | чтение | `path?` → `{html, viewer}` общего меню |
| `POST /session` | `view` | Токен → media_session на час, ответ `expires_at`; cookie HttpOnly/Secure/SameSite=Strict, только `/api/v1/media` |
| `DELETE /session` | без отдельной проверки | Удаляет media_session; 204. Не отзывает токен Supabase |

`media_kinds` в capabilities — прежнее имя словаря: значения теперь берутся из параметра вида изображения. Таблицы `media_kinds` больше нет. Представления `compact`, `card`, `editor` наследуются от ближайшего настроенного предка типа; публичного API правки представлений пока нет.

### Сущности

| Метод и путь | Доступ | Вход → результат |
|---|---|---|
| `GET /entities` | чтение | Каталог, `items`, `next_cursor`. Фильтры: `type` (ветвь целиком), `q`, `parameter` + `min`/`max`/`sort=parameter`/`order`, `values`, `opt=<параметр>:<вариант>,<вариант>` (отбор по выбору, можно несколько `opt`; например `opt=competition_state:results,cancelled` — завершённые конкурсы) |
| `GET /entities/{id}` | чтение | Также принимает текущий/прежний slug. Поля записи, `body_json`, `indicators`, `tags`, `media`, `sources`, `authors`, `compact`, `material_id`, указатели версий, `citation`, `canonical_url` |
| `GET /entities/{key}/card` | чтение | JSON с HTML единственной карточки для авторизованного интерфейса |
| `GET /entities/{id}/parameters` | чтение | Подсказки параметров ветви и индивидуальных наборов; параметр blocks исключён |
| `GET /entities/{id}/versions` | `edit`/`review`/`su` | `items`: до 100 последних версий, автор, время, summary, schema_version, complete, is_public, is_working |
| `POST /entities` | `create_delete` | Создание полного рабочего снимка → `{id, material_id, revision_id}` |
| `PATCH /entities/{id}` | `edit` | Атомарная правка → новый `revision_id`; обязательный `base_revision_id` либо `If-Match` |
| `POST /entities/{id}/publish` | `publish` | `{revision_id?, note?}` → `{entity_id, published_revision_id, status}` |
| `POST /entities/{id}/unpublish` | `publish` | `{note?}` → `{entity_id, unpublished_revision_id, status: "draft"}`; версии сохраняются, вернуть — `/publish` |

Каталог: `type` — код ветви с потомками; прежний `kind=person/object/period` — псевдоним. `q` ищет **название**, не полный текст. `archived=1` разрешён видящим черновики и добавляет архив к выдаче. `parameter`, `min`, `max`, `sort=parameter`, `order=desc` отбирают/сортируют действующие значения; `values=код,код` добавляет нужные значения в строку. При сортировке по параметру next_cursor не выдаётся. Без специального выбора ветви каталог исключает служебные для показа типы согласно коду (страницы проекта, изображения, документы).

Создание: обязательны `type` (или старый `kind`), `slug`, `title_ru`. Общие необязательные поля: `title_en`, `title_original`, `original_language`, `title_la`, `color`, `sort_order`, `body_json`, `indicators`, `tags`. `slug` — строчная латиница/цифры с дефисами; прежний адрес сохраняется. `profile.typology` — совместимый вход в параметр `typology`, уже не отдельное хранилище.

```json
{"type":"architecture_object","slug":"primer-zdaniya","title_ru":"Пример здания","body_json":[{"id":"p1","type":"paragraph","content":[{"type":"text","text":"Описание здания.","styles":{}}]}],"tags":["купол"]}
```

В PATCH отправлять только изменяемое; отсутствие `body_json` сохраняет текст, `body_json: []` очищает его. Переданные `tags` и `indicators` заменяют соответствующие списки целиком (текст сохраняется отдельно от списка показателей). Для необязательных общих полей `null` сейчас часто означает «не менять» через SQL coalesce — это не универсальный способ очистки. Сохранение и последующая публикация — два запроса: при ошибке публикации рабочая версия уже сохранена.

### Параметры и наборы

| Метод и путь | Доступ | Вход → результат |
|---|---|---|
| `GET /parameters` | чтение | Справочник определений, варианты, число использований |
| `GET /parameters/for-type/{code}` | чтение | Наследуемые наборы/параметры; blocks не показываются среди обычных величин |
| `POST /parameters` | `su` | Определение параметра → запись определения |
| `PATCH /parameters/{id}` | `su` | Изменение определения; ограничения для заполненных параметров |
| `DELETE /parameters/{id}` | `su` | Не удаляет использованный параметр |
| `GET /parameter-sets` | чтение | Наборы с составом и привязками |
| `POST /parameter-sets` | `su` | `{code, title_ru, note?}` |
| `PATCH /parameter-sets/{code}` | `su` | `{title_ru?, note?, sort_order?}` |
| `DELETE /parameter-sets/{code}` | `su` | Удаление набора, не данных записей |
| `PUT /parameter-sets/{code}/items` | `su` | `{items:[{parameter, hint?}]}` — полный состав, порядок по массиву |
| `POST /parameter-sets/{code}/types` | `su` | `{type}` — код узла дерева |
| `DELETE /parameter-sets/{code}/types/{type}` | `su` | Снять привязку ветви |
| `POST /parameter-sets/{code}/entities` | `edit` | `{entity_id}` — индивидуальный набор |
| `DELETE /parameter-sets/{code}/entities/{id}` | `edit` | Снять индивидуальную подсказку |
| `PUT /entities-indicators/{id}` | `edit` | `{indicators, base_revision_id?}` → `{items, revision_id}`; основание версии **необязательно** в этом маршруте |
| `PUT /entities-dates/{id}` | `edit` | `{dates:[...]}` — заменить датировки, сохранить прочие сведения, создать версию |

Определение параметра: `code`, `title_ru`, `value_type`, необязательные `unit`, `definition`, `sort_order`, `is_repeatable`, `options:[{code,title_ru}]`. Коды — строчная латиница, цифры, подчёркивание. Для option при создании нужен непустой список. Физическая БД поддерживает `entity` и `blocks`; административный API не является универсальным DDL-интерфейсом для любой настройки определения.

Группа indicators: `title`, `is_current`, `measured_year`, `measured_by`, `source_entity_id`, `note`, обязательный массив `values`. Значение: `parameter` (код), одно из `num_value`, `text_value`, `bool_value`, `option` (код варианта), `entity_value_id`/совместимый `place_id`, или поля даты `date_start_year/month/day`, `date_end_year/month/day`; также `is_approximate`, `is_ongoing`, `note`. В БД место — ответ-запись; `place_id` в API не UUID старой таблицы places, а ID entities.

```json
{"base_revision_id":"UUID полученной версии","indicators":[{"title":"Сведения","is_current":true,"values":[{"parameter":"opening","date_start_year":1945},{"parameter":"address","place_id":"1015","note":"Главный вход"}]}]}
```

Совместимый вход dates: `{kind, start_year, start_month?, start_day?, end_year?, end_month?, end_day?, is_approximate?, is_ongoing?, note?}`. `kind` — код параметра даты. Неизвестные части не выдумываются, отрицательные годы допустимы, конец раньше начала отклоняется.

### Площадная программа (значение-таблица, 0040–0045)

Площадная программа записи — значение-таблица параметра `area_program` в группе сведений; одна программа на группу (состояние проекта: «по проекту», «после реконструкции»). Классификатор помещений и смысл колонок — [Классификатор помещений](Классификатор%20помещений.md). Пишется тем же `PUT /entities-indicators/{id}`: значение таблицы передаётся полем `rows` — массив строк `{код колонки: значение}`; вариант — кодом варианта. Набор параметров `area_program` к записи подключается `POST /parameter-sets/area_program/entities` `{entity_id}` — чтобы редактор его подсказывал; писать можно и без этого.

**Внимание:** `PUT /entities-indicators/{id}` заменяет весь список групп и значений записи (кроме текста). Чтобы добавить программу, прочитайте текущие `indicators` из `GET /entities/{id}`, добавьте значения и отправьте список целиком — иначе прежние величины будут стёрты.

```json
PUT /entities-indicators/43
{ "base_revision_id": "…",
  "indicators": [ { "title": "Сведения", "is_current": true, "values": [
      …прежние значения группы…,
      { "parameter": "program_stage", "option": "built" },
      { "parameter": "program_area_base", "option": "rooms" },
      { "parameter": "program_circulation_method", "option": "absent" },
      { "parameter": "area_program", "note": "Источники программы",
        "rows": [
          { "program_purpose": "performers.dressing", "program_room": "Гримёрная групповая",
            "program_part": "Большой театр (GT)", "program_level": "3F", "program_number": "303",
            "program_count": 1, "program_seats": 5, "program_space_type": "room",
            "program_area_basis": "unknown", "program_in_total": "yes",
            "program_source": "GT, стр.41–42" },
          { "program_purpose": "performers.rehearsal", "program_room": "Studio 1",
            "program_level": "11F", "program_area": 251.63, "program_dimensions": "19,02 × 13,23",
            "program_area_basis": "dimensions", "program_in_total": "yes" } ] } ] } ] }
```

**Свойства программы** — обычные значения той же группы:

| Код | Варианты |
|---|---|
| `program_stage` | `brief` задание, `design` проект, `built` построено |
| `program_area_base` | `usable` полезная (НУФ, DIN 277), `gross` общая, `rooms` помещения программы |
| `program_circulation_method` | `rows` строками, `factor` коэффициентом, `separate` отдельно сверх полезной, `absent` не учтены |
| `program_circulation_factor` | число, например `1.6` |

**Колонки строки** (`rows`):

| Код | Вид | Что |
|---|---|---|
| `program_purpose` | вариант-дерево | Назначение — код узла классификатора: зона (`core`), назначение (`performers.dressing`) или помещение инженерии (`engineering.hvac.vent`). Полный список — `GET /parameters`, параметр `program_purpose`, поле `options` с `parent` |
| `program_room` | текст | Помещение по источнику |
| `program_space_type` | вариант | `room` помещение, `open` открытая, `covered` под навесом |
| `program_part` | текст | Часть здания: зал, корпус, «общее» |
| `program_level` | текст | Уровень: «B1», «3F», «+1» |
| `program_number` | текст | № помещения |
| `program_count` | целое | Количество |
| `program_seats` | целое | Людей: зрительские места, рабочие места, места в гримёрных… |
| `program_area` | число, м² | Площадь одного помещения |
| `program_area_total` | число, м² | Площадь всего, если известна только она |
| `program_area_basis` | вариант | «Откуда цифра» (0047): `document` данные, `dimensions` расчёт, `estimate` оценка, `unknown` нет данных. На странице под итогом программы — площадь по каждому варианту |
| `program_dimensions` | текст | Габариты: «19,02 × 13,23» |
| `program_in_total` | вариант | `yes` / `no` — «нет» только при двойном счёте |
| `program_source` | текст | Документ и страница |
| `program_note` | текст | Оговорки, оснащение |

Пустые ячейки можно не передавать или передавать `""`/`null` — они отбрасываются. Число можно прислать строкой с запятой («18,5»). Каждую ячейку проверяет база: незнакомая колонка, текст вместо числа, дробное «Количество», вариант не из списка → `400 validation_failed` с номером строки и названием колонки («Строка 3: «Назначение» — нет варианта «hall»»). Вариант, выбранный хоть в одной таблице, из списка не удаляется.

**Чтение.** `GET /entities/{id}`: в `indicators[].values[]` у таблицы `value_type: "table"` и `rows` — строки с кодами колонок, у варианта `{code, title, path}` (путь от зоны). Поле `area_program` карточки — итоги по группам: `total_area`, `zones[]` (`code`, `title`, `area`, `people`, `share`, `purposes[]`); строки с `program_in_total: no` в итоги не входят; площадь строки — «Площадь всего», иначе площадь × количество. На странице записи программа — раздел под «Связями», раскрывается по уровням: зона → назначение → строки.

### Текст и прежние документы

Самостоятельный текст создаётся `POST /entities` с `type: "document"`; собственный текст любого поддерживающего его типа — `body_json`. Физическое хранение: параметр text → `indicator_values.blocks_value`; `snapshot.body_json` — проекция в версии, не независимый редактируемый текст.

| Метод и путь | Доступ | Результат |
|---|---|---|
| `POST /documents` | `create_delete` | 409 owned_content, с указанием создавать сущность |
| `GET /documents/{id}` | чтение | Старый ID разрешается в выбранную версию владельца, а не в исторический снимок на момент создания ID |
| `PATCH /documents/{id}` | `edit` | У всех текущих прежних документов есть владелец: 409 owned_content; править владельца |

BlockNote: `entityCard` — блок с `entityId, occurrenceId`; `entityMention` — inline-вхождение; `sourceRef` — inline `entityId, linkId, occurrenceId, title, note`; `mediaImage` — `assetId, caption, variant`; `modelEmbed` — `src, title, caption, height`, адрес только `/models/имя.html`. Карточки/упоминания не создают links автоматически. Сервер сохраняет указатель вхождений `document_entity_refs`, проверяет существование entityId. Извлечение текста — техническая функция; полнотекстовый поиск новых текстов публичным API не реализован. Ограничения sourceRef — ниже.

### Медиатека

| Метод и путь | Доступ | Вход → результат |
|---|---|---|
| `GET /media` | чтение | `q`, `cursor`, `limit`, `needs=attribution`, `kind` (вид изображения), `attached=yes/no` вместе с `entity_id` → `items`, `next_cursor`, `needs_attribution` |
| `POST /media` | `create_delete` | multipart с `file` → файл и новая запись-изображение; варианты создаются сервером |
| `GET /media/{id}` | чтение | Файл, его entity_id, сведения и варианты |
| `PATCH /media/{id}` | `edit` | JSON сведений; `visibility: public/private` меняет публикацию записи |
| `GET /media/{id}/file` | чтение/медиа-cookie | `variant=thumbnail/page/screen/original` (по умолчанию screen; `page` — до 1400 px для колонки страницы, у старых файлов создаётся при первом запросе, 0053); бинарный файл, готовность и доступ проверяются |
| `POST /media/{id}/derivatives` | `edit` | Повтор генерации из неизменного оригинала |
| `POST /media/attachments` | `edit` | `{entity_id, asset_id, role?}` → `{attachment_id, link_id}`; создаёт опубликованную связь illustration |
| `PUT /media/attachments/order` | `edit` | `{entity_id, order:[ID связи]}`; переставляет и публикует редакции связей |
| `DELETE /media/attachments/{id}` | `edit` | Архивирует связь illustration; файл и запись остаются |

`asset_id`/`assetId` — UUID media_assets, `entity_id` — bigint записи-изображения; `attachment_id` теперь ID links, таблицы attachments нет. `role: cover` отмечает связь главной, обложка выбирается по порядку. Список order клиент должен присылать целиком; сервер проверяет чужие ID, но полнота и уникальность массива сейчас не полностью проверяются.

Поля загрузки/правки: `caption`, `kind`, `author`, `credit`, `source_url`, `original_caption`, `holder`, `inventory_no`, `created_year`, `license`, `alt`, `description`; при загрузке `keywords` через запятую, затем метки через `/tags/media/{id}`. Сервер не скачивает произвольные URL. Пустые поля правки сохраняют прежнее значение. Новый файл — черновик. Правка уже опубликованного изображения через специализированный маршрут сразу публикует новую редакцию; это отличается от обычного PATCH /entities.

Лимиты загрузки берутся из capabilities, остальные рецепты — из окружения API, см. [Параметры проекта](Параметры%20проекта.md). MIME формы не заменяет проверку содержимого; размеры/хеши/производные считает сервер. Исходник и все файлы истории сохраняются.

### Места и метки

| Метод и путь | Доступ | Вход → результат |
|---|---|---|
| `GET /places` | `edit` | `q`, `limit` → поиск мест |
| `GET /places/{id}/usage` | `edit` | В каких записях место используется как значение |
| `POST /places` | `create_delete` | Новый адрес → `{id, reused:false}` 201; совпадение → `{id, reused:true}` 200 |
| `PATCH /places/{id}` | `edit` | Частичная правка адреса; `{id}` |
| `GET /tags` | чтение | `q`, `limit` → справочник/число использований |
| `PUT /tags/entities/{id}` | `edit` | `{tags:[строки]}` → `{items}`; полный список и новая рабочая версия |
| `PUT /tags/media/{id}` | `edit` | `{tags:[строки]}` → `{items}`; метки записи-изображения, опубликованная запись перепубликуется |

Место — entities типа place; поля API `country`, `settlement`, `street`, `house`, `unit`, `lat`, `lon`, `precision`, `source_url` переводятся в параметры. Координаты парой, точность `point/building/settlement/region`. Сравнение адреса игнорирует регистр/лишние пробелы; при повторе недостающие координаты могут дописываться. Пустое поле PATCH — не менять. POST публикует место сразу; PATCH опубликованного места публикует новую редакцию. Отдельного требования publish здесь сейчас нет — это ограничение единой политики прав, а не новое согласованное правило.

### Поиск (Р-109, 0033, выложено 2026-10-05)

| Метод и путь | Доступ | Вход → результат |
|---|---|---|
| `GET /search` | публичный | `q` (2–500 знаков), `kind?` — `title,params,text`, `type?` — код ветви, `limit?` ≤ 50 → `{items, mode: hybrid/fulltext}`; элемент — `id, slug, title_ru, type, type_title, type_path, status, found_in, block_id, snippet, matched, similarity, score, compact` |
| `GET /search/status` | `edit` | Модель, размерность, число кусков по областям и видам, ждущие векторы и пересборку, состояние индексатора |
| `POST /search/reindex` | `su` | 202; пересборка кусков всех записей фоном, векторы прежнего текста сохраняются |
| `POST /search/answer` | по настройке `SEARCH_AI_AUDIENCE` (сейчас публичный) | `{q}` 5–500 знаков → `{answer, sources:[{n,id,slug,title_ru,type_title,status}], generated, remaining, query_id}`; 401/403 — аудитория сужена, 429 — суточный лимит (Р-114, после 0038 — ещё не выложено) |
| `GET /search/queries` | `su` | `days?` ≤ 365 (30), `limit?` ≤ 500, `missed=1` — только без совпадений по словам → `{days, summary, items}`; журнал запросов с участником или псевдонимом гостя (Р-113, после 0037 — ещё не выложено) |
| `GET /search/ai-requests` | `su` | `days?`, `limit?` → `{days, totals, items}`; расход по назначению и модели: вызовы, ошибки, токены, рубли (Р-113, после 0037 — ещё не выложено) |

Гость ищет по кускам опубликованных версий, редактор — по рабочим. Файлы (ветвь «Материалы») в выдачу не идут, пока не задан `type`. `found_in` — вид лучшего куска: название, сведения или текст; `block_id` — блок текста для перехода. Во `snippet` совпавшие слова — между U+E000 и U+E001; клиент экранирует текст сам. Без ключа модели или при её сбое `mode` = `fulltext`. С 0037 ответ `GET /search` несёт `query_id` — номер строки журнала запросов. Устройство — [Поиск](Поиск.md).

### Связи и публикация

| Метод и путь | Доступ | Вход → результат |
|---|---|---|
| `POST /links` | `create_delete` | `{from_entity_id,to_entity_id,role?,note?,is_primary?,confidence?,justification}` → `{id, material_id, revision_id}` |
| `GET /links` | чтение | Обязательный `entity_id`; окружение с основаниями, без illustration |
| `GET /links/mentions` | публичный | `entity_id` → упоминания в опубликованных текстах |
| `POST /links/{id}/publish` | `publish` | `{revision_id?,note?}` → `{link_id,published_revision_id,status}` |
| `POST /links/{id}/unpublish` | `publish` | `{note?}` → `{link_id,unpublished_revision_id,status:"draft"}` |
| `DELETE /links/{id}` | `create_delete` | Архивирование, история остаётся |
| `GET /materials/{id}` | чтение, для непубличного `view` | Старый UID реестра → состояние владельца/история рассмотрений |
| `POST /materials/{id}/publish` | `publish` | Совместимый путь; для entities/links действует публикация владельца. Старый принадлежащий владельцу документ → 409 |
| `POST /materials/{id}/submit` | `edit` | `{note?}` → `{material_id,revision_id}`; текущая рабочая версия |
| `POST /materials/{id}/review` | `review` | `{decision: approved/rejected,note?}`; сейчас выбирается последняя версия, см. ограничение ниже |
| `DELETE /materials/{id}` | `create_delete` | Архивирует владельца/материал, сохраняя историю |

Обе стороны связи — ID entities; самосвязь отклоняется. `role` — код link_roles. `justification: {text}` либо `{body:[блоки],title?}`; обычный POST /links требует непустой массив или текст. Основание хранится в snapshot.body_json версии связи, отдельно не публикуется. У источника — общие сведения и URL, в основании — страницы/абзацы/цитата конкретного использования.

Публикация без revision_id выбирает рабочую редакцию; с UID — указанную полную редакцию владельца. Повторная публикация той же версии — 409. Исторические частичные версии не публикуются. Связанные самостоятельные сущности вместе с записью автоматически не публикуются.

### Материалы в работе (0051)

| Метод и путь | Доступ | Вход → результат |
|---|---|---|
| `GET /research-materials` | `edit` | Все привязанные папки: `{items:[{entity_id,slug,title_ru,path,synced_at,root,files}]}` |
| `GET /entities/{id}/research-materials` | `edit` | `{path,synced_at,files:[{path,size_bytes,modified_at,sha256,media_entity_id,media_slug,media_published}]}`; без папки — `path: null` |
| `PUT /entities/{id}/research-materials` | `edit` | `{path}` — путь от корня `research_notes`, без `..`; `path: null` или пусто — отвязать (файлы не трогаются) |
| `PUT /entities/{id}/research-materials/files` | `edit` | `{files:[{path,size,modified?,sha256?}]}` — опись целиком: недостающие строки удаляются, `synced_at` обновляется → `{entity_id,files}` |
| `POST /research-materials/refresh` | `su` | «Обновить файловую структуру» (0052): сопоставляет папки, положенные в Dropbox вручную (по названию или «тип_название»), досоздаёт папки записям ветвей ЧТО и КТО без папки, снимает опись через API Dropbox → `{created,linked,renamed,unmatched,entities,files}`; без ключей Dropbox — 503 |

Путь — от корня `2VHUTEMAS` в Dropbox: `ЧТО/ПРОЕКТЫ/<тип>_<название> (<English>)`, `КТО/ЛЮДИ/<тип>_<название> (<English>)`. Файлы на сервер не уходят — только путь и опись (сервер — `content_hash` Dropbox, локальный скрипт — `sha256`). Страница `/materials` (su) — таблица соответствия и кнопка обновления. Таблицы вне версий записи и не публикуются; раздел «Материалы в работе» есть только в `GET /entities/{key}/card` для редактора. Файл считается «в медиатеке», если его sha256 совпал с оригиналом файла медиатеки. Ключи Dropbox подключает `tools/dropbox_connect.py` (только в `.env` сервера); `tools/sync_materials.py` досчитывает sha256 и правит соответствие (`--link`, `--unlink`, `--list`).

## Публичные страницы вне v1

`GET /`, `/about`, `/about/{section}`, `/about/logo/tool`, `/entities/{key}`, `/entities/{key}/edit`, `/robots.txt`, `/sitemap.xml`; списки `/entities`, `/projects`, `/people`, `/lectures` зарегистрированы циклом в pages.ts. Старые адреса «О проекте» и номера опубликованных карточек перенаправляются на canonical. HTML карточки — один общий рендер. Экраны `/login`, `/media`, `/media/*`, `/parameters` получают оболочку приложения. Статические `/models/*.html`, assets и favicon обслуживает Caddy; это не API. Маршрут ключа IndexNow появляется по конфигурации, а не фиксированному секрету в WIKI.

## Границы реализации и незакрытые замечания

- Защита base_revision_id обязательна для PATCH сущности, необязательна для PUT показателей, отсутствует во многих специализированных правках. Подтверждена гонка чтения версии при ожидании блокировки; нельзя обещать полное отсутствие перезаписи параллельных правок.
- submit/review выбирают текущую последнюю редакцию, а не явно рассмотренную: A отправлена, B сохранена, одобрение может опубликовать B. Нужно закреплять UID версии.
- Специализированные `/places`, `/media` и иллюстрации публикуют изменения по `edit`/`create_delete`; это расходится с общим разделением edit/publish и требует исправления/решения, не маскируется общей формулировкой контракта.
- sourceRef хранит копию note/title; linkId не разрешается в основание и не проверяется на принадлежность паре записей. Унификация хранения источников не устранила это дублирование показа.
- В documents.ts остались ветви для документа без владельца; у всех перенесённых документов владелец есть. Не использовать эти ветви как новый поддерживаемый способ записи.
- Нет API импорта пакетов, назначения ролей/Telegram-привязки, правки представлений, универсального изменения основания связи, полного сравнения/восстановления исторических снимков. Наличие служебных таблиц не объявляет эти функции готовыми.

Незакрытые работы — [План реализации](План%20реализации.md); воспроизведение гонки — [архив ревизии](Архив/Ревизия%20общих%20версий%202026-10-01.md). Старые гарантии заменены точным описанием текущего кода; требования проекта остаются в силе.
