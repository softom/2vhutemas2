-- Тип «Видео»: ролик по ссылке (YouTube, VK Видео, Rutube), а не сайт, где он лежит.
--
-- Решение пользователя 2026-10-01: ссылок на YouTube будет много; тип —
-- по сути вещи («Видео»), адрес только подсказывает его при заведении. На
-- странице — ссылка и изображение обложки: кадр-превью самого ролика с
-- подписью «канал · YouTube» (Р-68), если обложку не прикрепили вручную.

-- ── 1. Тип и сведения ────────────────────────────────────────────────────────

insert into app.entity_types (parent_id, code, title_ru, sort_order)
select id, 'video', 'Видео', 97 from app.entity_types where code = 'what';

insert into app.parameters (code, title_ru, value_type, unit, definition, sort_order) values
  ('video_channel', 'Автор или канал', 'text', null,
   'Кто выложил ролик: автор, канал, организация. Подписывает кадр-превью (Р-68).', 20),
  ('duration', 'Длительность', 'text', null, 'Длительность ролика, например 1:12:30.', 30);

insert into app.parameter_sets (code, title_ru, note, sort_order) values
  ('video_basic', 'Видео — сведения', 'Адрес ролика, автор, длительность, дата публикации.', 70);

insert into app.parameter_set_items (set_id, parameter_id, sort_order)
select s.id, p.id, x.sort
  from app.parameter_sets s,
       (values ('url', 10), ('video_channel', 20), ('duration', 30), ('publication', 40)) as x(code, sort)
  join app.parameters p on p.code = x.code
 where s.code = 'video_basic';

insert into app.type_parameter_sets (type_id, set_id)
select t.id, s.id from app.entity_types t, app.parameter_sets s
 where t.code = 'video' and s.code = 'video_basic';

-- ── 2. Кадр-превью ролика ────────────────────────────────────────────────────

-- Адрес кадра-превью по адресу ролика: у YouTube он выводится из номера
-- ролика. Файл не скачивается и не хранится — это ссылка на кадр самого
-- ролика; подпись к нему — автор или канал и площадка.
create function app.video_cover(p_entity bigint, p_drafts boolean) returns text
language sql stable as $$
  select 'https://i.ytimg.com/vi/' || m[1] || '/hqdefault.jpg'
    from app.read_values(p_drafts) v
    join app.read_indicators(p_drafts) i on i.id = v.indicator_id
    join app.parameters p on p.id = v.parameter_id and p.code = 'url'
    join app.entities e on e.id = i.entity_id
    join app.entity_types t on t.id = e.type_id and t.code = 'video'
    cross join lateral regexp_match(v.text_value,
      '(?:youtu\.be/|youtube(?:-nocookie)?\.com/(?:watch\?(?:.*&)?v=|embed/|shorts/|live/))([A-Za-z0-9_-]{11})') m
   where i.entity_id = p_entity and i.is_current
   limit 1
$$;

-- ── 3. Отображение ───────────────────────────────────────────────────────────

alter table app.type_presentation_items drop constraint type_presentation_items_component_check;
alter table app.type_presentation_items add constraint type_presentation_items_component_check
  check (component in (
    'title', 'thumbnail', 'portrait', 'mark', 'parameter',
    'indicators', 'links', 'text', 'gallery', 'sources', 'mentions', 'citation',
    'tags', 'video'));

insert into app.type_presentations (type_id, mode)
select t.id, m.mode from app.entity_types t, (values ('compact'), ('card')) as m(mode)
 where t.code = 'video';

-- В строке и в списке — кадром, как здание; на странице — обложка-ссылка
-- на ролик сразу после показателей.
insert into app.type_presentation_items (presentation_id, component, sort_order, link_role_id)
select tp.id, x.component, x.sort,
       case when x.component = 'gallery' then (select id from app.link_roles where code = 'illustration') end
  from app.type_presentations tp
  join app.entity_types t on t.id = tp.type_id and t.code = 'video'
  join (values ('compact', 'thumbnail', 10), ('compact', 'title', 20),
               ('card', 'indicators', 10), ('card', 'video', 15), ('card', 'links', 20),
               ('card', 'text', 30), ('card', 'gallery', 40), ('card', 'mentions', 60),
               ('card', 'citation', 70))
       as x(mode, component, sort) on x.mode = tp.mode;

-- Миниатюра без прикреплённой обложки берёт кадр ролика (поле src).
create or replace function app.compact_json(p_entity bigint, p_drafts boolean) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(
           case i.component
             when 'thumbnail' then jsonb_build_object('component', 'thumbnail', 'asset', app.cover_asset(e.id, p_drafts),
                                                      'src', app.video_cover(e.id, p_drafts))
             when 'portrait' then jsonb_build_object('component', 'portrait', 'asset', app.cover_asset(e.id, p_drafts))
             when 'parameter' then jsonb_build_object(
               'component', 'parameter',
               'parameter', (select code from app.parameters where id = i.parameter_id),
               'value', (select coalesce(v.text_value, o.title_ru, x.title_ru,
                                         v.num_value::text, v.date_start_year::text)
                           from app.read_values(p_drafts) v
                           join app.read_indicators(p_drafts) ri on ri.id = v.indicator_id
                           left join app.parameter_options o on o.id = v.option_id
                           left join app.entities x on x.id = v.entity_value_id
                          where ri.entity_id = e.id and ri.is_current and v.parameter_id = i.parameter_id
                          order by ri.sort_order, v.sort_order limit 1))
             else jsonb_build_object('component', i.component)
           end order by i.sort_order), '[]'::jsonb)
    from app.entities e
    join app.type_presentation_items i
      on i.presentation_id = app.presentation_for(e.type_id, 'compact')
   where e.id = p_entity
$$;

-- Видео — источник, как книга, статья и веб-страница (Р-80).
create or replace function app.sources_json(p_entity bigint, p_drafts boolean) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', src.id, 'entity_id', src.id, 'slug', src.slug, 'link_id', l.id,
           'kind', t.code, 'kind_title', t.title_ru, 'title', src.title_ru,
           'url', (select v->>'text_value'
                     from app.revisions sr, jsonb_array_elements(sr.snapshot->'values') v
                     join app.parameters p on p.id = (v->>'parameter_id')::uuid
                    where sr.id = case when p_drafts then src.working_revision_id else src.published_revision_id end
                      and p.code in ('url', 'wiki_url') limit 1),
           'year', (select (v->>'date_start_year')::int
                      from app.revisions sr, jsonb_array_elements(sr.snapshot->'values') v
                      join app.parameters p on p.id = (v->>'parameter_id')::uuid
                     where sr.id = case when p_drafts then src.working_revision_id else src.published_revision_id end
                       and p.code = 'publication' limit 1),
           'text', (select string_agg(b->'content'->0->>'text', ' ')
                      from app.revisions lr, jsonb_array_elements(lr.snapshot->'body_json') b
                     where lr.id = case when p_drafts then l.working_revision_id else l.published_revision_id end))
           order by l.sort_order, l.id), '[]'::jsonb)
    from app.links l
    join app.link_roles r on r.id = l.role_id and r.code = 'source'
    join app.entities src on src.id = case when l.from_entity_id = p_entity
                                           then l.to_entity_id else l.from_entity_id end
    join app.entity_types t on t.id = src.type_id
   where (l.from_entity_id = p_entity or l.to_entity_id = p_entity)
     and t.code in ('web_page', 'book', 'article', 'video')
     and case when p_drafts then l.status <> 'archived' else l.status = 'published' end
     and case when p_drafts then src.status <> 'archived' else src.status = 'published' end
$$;

grant execute on function app.video_cover(bigint, boolean) to app_api;
