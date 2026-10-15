-- Масштаб чертежа — сведение записи, а не калибровка в браузере.
--
-- Замечание пользователя 2026-10-15: «в масштабе публикации ошибка в 10 раз:
-- не 3,5 м, а 35 м». В DXF Тайчжуна единицы записаны как миллиметры
-- ($INSUNITS = 4), а начерчены в сантиметрах. Калибровка запоминалась только
-- в браузере калибровавшего; теперь у чертежа есть сведение «Единица чертежа,
-- мм» — по нему считают все. Набор «Чертёж — масштаб» действует для типа
-- «Чертёж» вместе с «Изображение — сведения».
insert into app.parameters (code, title_ru, value_type, unit, definition, sort_order) values
  ('drawing_unit_mm', 'Единица чертежа', 'number', 'мм',
   'Сколько миллиметров в одной единице чертежа: 1 — чертёж в миллиметрах, 10 — в сантиметрах, 1000 — в метрах. Файл DXF нередко указывает единицы неверно; проверяется по известному размеру.', 5);
insert into app.parameter_sets (code, title_ru, note, sort_order) values
  ('drawing_scale', 'Чертёж — масштаб', 'Масштаб чертежа для замеров на странице.', 65);
insert into app.parameter_set_items (set_id, parameter_id, sort_order)
select s.id, p.id, 10 from app.parameter_sets s, app.parameters p
 where s.code = 'drawing_scale' and p.code = 'drawing_unit_mm';
insert into app.type_parameter_sets (type_id, set_id)
select t.id, s.id from app.entity_types t, app.parameter_sets s
 where t.code = 'drawing' and s.code = 'drawing_scale';

CREATE OR REPLACE FUNCTION app.drawings_json(p_entity bigint, p_drafts boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'link_id', l.id, 'asset_id', a.id, 'entity_id', d.id, 'slug', d.slug,
           'title', x.info->>'title', 'kind', x.info->>'kind',
           'author', x.info->>'author', 'credit', x.info->>'credit',
           'source_url', x.info->>'source_url',
           'source', coalesce(x.info->>'original_caption', x.info->>'holder'), 'year', x.info->>'created_year',
           'unit_mm', (app.snapshot_value(d.id, p_drafts, (select id from app.parameters where code = 'drawing_unit_mm'))->>'num_value')::numeric,
           'license', x.info->>'license_code',
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
$function$;
