-- Чертёж — запись своего типа: просмотр DXF на странице с замерами.
--
-- Решение пользователя 2026-10-15: чертежи (DWG → DXF) публикуются не ссылкой
-- для скачивания, а пространством для просмотра и простых замеров; как цитата
-- с указанием автора и источника (Р-68). Пример — технические чертежи
-- Национального театра Тайчжуна, официально скачанные с раздела театра.
--
-- Устроено как изображение (Р-84): файл — в медиатеке, его запись — тип
-- «Чертёж» в ветви «Материалы» со сведениями того же набора (автор,
-- правообладатель, источник, лицензия, вид — план, разрез, фасад…).
-- Прикрепление к зданию — связь «Чертёж»; на странице записи — раздел
-- «Чертежи».

-- Класс файла в реестре — чертёж.
alter table app.media_assets drop constraint if exists media_assets_asset_class_check;
alter table app.media_assets add constraint media_assets_asset_class_check
  check (asset_class in ('image', 'pdf', 'video', 'audio', 'doc', 'drawing', 'other'));

insert into app.entity_types (parent_id, code, title_ru, sort_order)
select id, 'drawing', 'Чертёж', 15 from app.entity_types where code = 'materials';

insert into app.type_parameter_sets (type_id, set_id)
select t.id, s.id from app.entity_types t, app.parameter_sets s
 where t.code = 'drawing' and s.code = 'image_basic';

insert into app.link_roles (code, title_ru, sort_order) values ('drawing', 'Чертёж', 105);

-- Раздел карточки — после изображений, где они есть.
alter table app.type_presentation_items drop constraint type_presentation_items_component_check;
alter table app.type_presentation_items add constraint type_presentation_items_component_check
  check (component in (
    'title', 'thumbnail', 'portrait', 'mark', 'parameter',
    'indicators', 'links', 'text', 'gallery', 'sources', 'mentions', 'citation',
    'tags', 'video', 'program', 'drawings'));

insert into app.type_presentation_items (presentation_id, component, sort_order)
select i.presentation_id, 'drawings', i.sort_order + 2
  from app.type_presentation_items i
  join app.type_presentations tp on tp.id = i.presentation_id and tp.mode = 'card'
 where i.component = 'gallery'
   and not exists (select 1 from app.type_presentation_items x
                    where x.presentation_id = i.presentation_id and x.component = 'drawings');

-- Чертежи записи: файл, подпись, автор и источник (цитата, Р-68).
create function app.drawings_json(p_entity bigint, p_drafts boolean) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'link_id', l.id, 'asset_id', a.id, 'entity_id', d.id, 'slug', d.slug,
           'title', x.info->>'title', 'kind', x.info->>'kind',
           'author', x.info->>'author', 'credit', x.info->>'credit',
           'source_url', x.info->>'source_url',
           'source', coalesce(x.info->>'original_caption', x.info->>'holder'),
           'license', x.info->>'license',
           'original_name', f.original_name, 'size_bytes', f.size_bytes,
           'sort_order', l.sort_order)
           order by l.sort_order, l.id), '[]'::jsonb)
    from app.links l
    join app.link_roles r on r.id = l.role_id and r.code = 'drawing'
    join app.entities d on d.id = l.to_entity_id
    join app.media_assets a on a.entity_id = d.id and a.archived_at is null
    left join app.media_files f on f.asset_id = a.id and f.variant = 'original' and f.is_current
    cross join lateral (select app.image_json(d.id, p_drafts) as info) x
   where l.from_entity_id = p_entity
     and case when p_drafts then l.status <> 'archived' else l.status = 'published' end
     and case when p_drafts then d.status <> 'archived' else d.status = 'published' end
$$;

grant execute on function app.drawings_json(bigint, boolean) to app_api;
