-- 0009: указатель вхождений сущностей в документы.
--
-- Порядок в тексте задаёт сам документ (Р-02, ТЗ о лекциях). Эта таблица —
-- производный указатель: сервер заново извлекает её из блоков при сохранении
-- каждой версии, в одной транзакции с ней. Отдельно её не редактируют, второго
-- независимого порядка не существует.
--
-- Зачем указатель нужен:
--   * в карточке объекта видно, где он упомянут;
--   * сервер проверяет, что упомянутая сущность существует и доступна;
--   * сущность, на которую ссылаются версии, нельзя удалить незаметно.

create table app.document_entity_refs (
    revision_id      uuid not null references app.revisions(id) on delete cascade,
    occurrence_id    text not null,
    block_id         text,
    entity_id        bigint not null references app.entities(id) on delete restrict,
    pinned_revision_id uuid references app.revisions(id),
    display_mode     text not null default 'card' check (display_mode in ('card', 'inline')),
    target_block_id  text,
    media_asset_id   uuid references app.media_assets(id) on delete set null,
    note             text,
    ordinal          integer not null,
    primary key (revision_id, occurrence_id)
);

comment on table app.document_entity_refs is
    'Производный указатель вхождений сущностей в версию документа. Извлекается сервером из блоков.';
comment on column app.document_entity_refs.occurrence_id is
    'Идентификатор отдельного появления: один объект может встречаться в тексте несколько раз';
comment on column app.document_entity_refs.pinned_revision_id is
    'Закреплённая версия сущности, если автор выбрал неизменяемую учебную подборку';
comment on column app.document_entity_refs.media_asset_id is
    'Иллюстрация именно этого появления; общая обложка объекта при этом не меняется';
comment on column app.document_entity_refs.target_block_id is
    'Якорь на фрагмент подробного описания: не внешний ключ, при пропаже ведёт к карточке';

create index document_entity_refs_entity_idx   on app.document_entity_refs(entity_id);
create index document_entity_refs_revision_idx on app.document_entity_refs(revision_id, ordinal);

-- Удобный доступ к вхождениям опубликованной версии: по нему строятся
-- обратные ссылки «где упомянут объект».
create view app.published_entity_mentions as
select r.entity_id,
       m.id            as material_id,
       m.document_id,
       d.title         as document_title,
       r.display_mode,
       r.ordinal
from app.document_entity_refs r
join app.revisions rev on rev.id = r.revision_id
join app.materials m   on m.id = rev.material_id and m.published_revision_id = rev.id
join app.documents d   on d.id = m.document_id
where m.status = 'published';

comment on view app.published_entity_mentions is
    'Упоминания сущностей в опубликованных версиях документов. Черновики сюда не попадают.';
