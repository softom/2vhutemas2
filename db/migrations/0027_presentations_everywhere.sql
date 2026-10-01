-- Р-86, завершение: таблица отображений управляет всеми тремя видами записи.
--
-- После 0026 настройки card задавали порядок разделов карточки, compact —
-- только упоминание в строке текста, а editor не было вовсе. Здесь:
--   * компактный вид собирается одной функцией с готовыми значениями — ею
--     пользуются каталог, списки сайта, карточка в тексте и упоминание;
--   * у редактора свои настройки: какие разделы формы и в каком порядке.

-- ── 1. Компоненты редактора ──────────────────────────────────────────────────

alter table app.type_presentation_items drop constraint type_presentation_items_component_check;
alter table app.type_presentation_items add constraint type_presentation_items_component_check
  check (component in (
    'title', 'thumbnail', 'portrait', 'mark', 'parameter',
    'indicators', 'links', 'text', 'gallery', 'sources', 'mentions', 'citation',
    'tags'));

-- ── 2. Ближайшая настройка вверх по дереву ──────────────────────────────────

create function app.presentation_for(p_type uuid, p_mode text) returns uuid
language sql stable as $$
  with recursive up as (
      select t.id, t.parent_id, 0 as distance from app.entity_types t where t.id = p_type
      union all
      select p.id, p.parent_id, up.distance + 1 from up join app.entity_types p on p.id = up.parent_id)
  select tp.id from up join app.type_presentations tp on tp.type_id = up.id and tp.mode = p_mode
   order by up.distance limit 1
$$;

-- ── 3. Компактный вид записи с готовыми значениями ──────────────────────────

-- Компоненты по порядку: название, миниатюра или портрет (с номером файла
-- обложки), знак источника, значение параметра. Название не подставляется:
-- вызывающий уже знает его в нужной редакции — рабочей или опубликованной. Кто рисует — каталог,
-- список сайта, карточка в тексте, упоминание — решает только размер.
create function app.compact_json(p_entity bigint, p_drafts boolean) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(
           case i.component
             when 'thumbnail' then jsonb_build_object('component', 'thumbnail', 'asset', app.cover_asset(e.id, p_drafts))
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

-- ── 4. Каталог показывал обложку любой записи ───────────────────────────────

-- Компактный вид периода и лекции был одним названием; каталог при этом
-- показывал их обложки. Теперь каталог следует компактному виду, поэтому
-- миниатюра добавляется в настройку — облик каталога не меняется.
update app.type_presentation_items i set sort_order = 20
  from app.type_presentations tp join app.entity_types t on t.id = tp.type_id
 where i.presentation_id = tp.id and tp.mode = 'compact'
   and t.code in ('when', 'service') and i.component = 'title';

insert into app.type_presentation_items (presentation_id, component, sort_order)
select tp.id, 'thumbnail', 10
  from app.type_presentations tp join app.entity_types t on t.id = tp.type_id
 where tp.mode = 'compact' and t.code in ('when', 'service');

-- ── 5. Редактор ──────────────────────────────────────────────────────────────

-- Разделы формы: title — тип, название, адрес и другие названия (есть всегда:
-- без названия запись не сохранить); tags — метки; indicators — сведения по
-- наборам; gallery — иллюстрации; text — текст записи. Состав повторяет
-- прежнюю форму; у места и изображения нет текста, у документа — сведений.
insert into app.type_presentations (type_id, mode)
select t.id, 'editor'
  from app.entity_types t
 where t.code in ('who', 'what', 'when', 'service', 'project_pages',
                  'where', 'materials', 'image', 'document');

insert into app.type_presentation_items (presentation_id, component, sort_order)
select tp.id, x.component, x.sort
  from app.type_presentations tp
  join app.entity_types t on t.id = tp.type_id
  join (values
    ('who', 'title', 10), ('who', 'tags', 20), ('who', 'indicators', 30), ('who', 'gallery', 40), ('who', 'text', 50),
    ('what', 'title', 10), ('what', 'tags', 20), ('what', 'indicators', 30), ('what', 'gallery', 40), ('what', 'text', 50),
    ('when', 'title', 10), ('when', 'tags', 20), ('when', 'indicators', 30), ('when', 'gallery', 40), ('when', 'text', 50),
    ('service', 'title', 10), ('service', 'tags', 20), ('service', 'indicators', 30), ('service', 'gallery', 40), ('service', 'text', 50),
    ('project_pages', 'title', 10), ('project_pages', 'tags', 20), ('project_pages', 'indicators', 30), ('project_pages', 'gallery', 40), ('project_pages', 'text', 50),
    ('where', 'title', 10), ('where', 'tags', 20), ('where', 'indicators', 30),
    ('materials', 'title', 10), ('materials', 'tags', 20), ('materials', 'indicators', 30),
    ('image', 'title', 10), ('image', 'tags', 20), ('image', 'indicators', 30),
    ('document', 'title', 10), ('document', 'tags', 20), ('document', 'text', 30)
  ) as x(type_code, component, sort) on x.type_code = t.code
 where tp.mode = 'editor';

-- Прежний помощник отдавал только имена компонентов; его заменил compact_json.
drop function app.compact_components(uuid);

grant execute on function app.presentation_for(uuid, text), app.compact_json(bigint, boolean) to app_api;
