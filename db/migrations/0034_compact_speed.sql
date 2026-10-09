-- Компактный вид без перебора всей базы.
--
-- Замечание пользователя 2026-10-09: страницы грузятся крайне долго. Причина —
-- app.compact_json (0027, 0029): для каждой миниатюры он звал app.video_cover,
-- а тот, как и значение параметра в компактном виде, читал app.read_values —
-- значения всех записей сразу. 34–52 мс на запись; каталог, списки сайта и
-- главная зовут его сотни раз (529 записей — 17,8 с).
--
-- Теперь значение берётся из снимка одной записи, а кадр ролика ищется только
-- у записей типа «Видео». Какую редакцию читать — рабочую или опубликованную —
-- решается так же, как в app.read_values.

-- Значение параметра записи из её снимка: первое по порядку в действующей
-- группе сведений. Прежние снимки ссылались на место через place_id — он
-- переводится в номер записи-места, как в app.read_values.
create function app.snapshot_value(p_entity bigint, p_drafts boolean, p_parameter uuid) returns jsonb
language sql stable as $$
  select v || case when v ? 'place_id' and not v ? 'entity_value_id'
                   then jsonb_build_object('entity_value_id',
                          (select x.id from app.entities x where x.legacy_place_id = (v->>'place_id')::uuid))
                   else '{}'::jsonb end
    from app.entities e
    join app.revisions r on r.id = case when p_drafts then e.working_revision_id else e.published_revision_id end
    cross join lateral jsonb_array_elements(r.snapshot->'values') v
    left join lateral (select i from jsonb_array_elements(r.snapshot->'indicators') i
                        where i->>'id' = v->>'indicator_id') ind on true
   where e.id = p_entity
     and (p_drafts or e.status = 'published')
     and (v->>'parameter_id')::uuid = p_parameter
     and coalesce((ind.i->>'is_current')::boolean, true)
   order by coalesce((ind.i->>'sort_order')::int, 0), coalesce((v->>'sort_order')::int, 0)
   limit 1
$$;

-- Кадр-превью ролика: только у записи «Видео», из её собственного снимка.
create or replace function app.video_cover(p_entity bigint, p_drafts boolean) returns text
language sql stable as $$
  select 'https://i.ytimg.com/vi/' || m[1] || '/hqdefault.jpg'
    from app.entities e
    join app.entity_types t on t.id = e.type_id and t.code = 'video'
    cross join lateral app.snapshot_value(e.id, p_drafts, (select id from app.parameters where code = 'url')) sv
    cross join lateral regexp_match(sv->>'text_value',
      '(?:youtu\.be/|youtube(?:-nocookie)?\.com/(?:watch\?(?:.*&)?v=|embed/|shorts/|live/))([A-Za-z0-9_-]{11})') m
   where e.id = p_entity
$$;

create or replace function app.compact_json(p_entity bigint, p_drafts boolean) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(
           case i.component
             when 'thumbnail' then jsonb_build_object('component', 'thumbnail', 'asset', app.cover_asset(e.id, p_drafts),
                                                      'src', case when t.code = 'video'
                                                                  then app.video_cover(e.id, p_drafts) end)
             when 'portrait' then jsonb_build_object('component', 'portrait', 'asset', app.cover_asset(e.id, p_drafts))
             when 'parameter' then (
               select jsonb_build_object(
                        'component', 'parameter',
                        'parameter', (select code from app.parameters where id = i.parameter_id),
                        'value', coalesce(sv->>'text_value',
                                          (select o.title_ru from app.parameter_options o where o.id = (sv->>'option_id')::uuid),
                                          (select x.title_ru from app.entities x where x.id = (sv->>'entity_value_id')::bigint),
                                          sv->>'num_value', sv->>'date_start_year'))
                 from (select app.snapshot_value(e.id, p_drafts, i.parameter_id) as sv) s)
             else jsonb_build_object('component', i.component)
           end order by i.sort_order), '[]'::jsonb)
    from app.entities e
    join app.entity_types t on t.id = e.type_id
    join app.type_presentation_items i
      on i.presentation_id = app.presentation_for(e.type_id, 'compact')
   where e.id = p_entity
$$;

grant execute on function app.snapshot_value(bigint, boolean, uuid) to app_api;
