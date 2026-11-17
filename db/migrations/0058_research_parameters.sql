-- Explicitly approved: parameter visibility and reusable research parameter sets.
alter table app.parameters add column is_published boolean not null default true;
comment on column app.parameters.is_published is 'False: editor-only, including published revisions.';

-- Public projections never contain private cells. Editor working data is read
-- explicitly by an edit-authorized API, not by draft/review visibility.
create function app.public_table(p_rows jsonb) returns jsonb language sql stable as $$
 select coalesce(jsonb_agg((select coalesce(jsonb_object_agg(c.key,c.value),'{}'::jsonb)
 from jsonb_each(r.value) c join app.parameters p on p.id::text=c.key where p.is_published) order by r.ordinality),'[]'::jsonb)
 from jsonb_array_elements(p_rows) with ordinality r;
$$;
create function app.public_value(v jsonb) returns jsonb language sql stable as $$
 select case when jsonb_typeof(v->'table_value')='array' then jsonb_set(v,'{table_value}',app.public_table(v->'table_value')) else v end;
$$;
create function app.public_body(s jsonb) returns jsonb language sql stable as $$
 select case when exists(select 1 from app.parameters where code='text' and is_published) then s->'body_json' else '[]'::jsonb end;
$$;
create or replace function app.read_values(p_drafts boolean) returns setof app.indicator_values
language sql stable as $$
 select (jsonb_populate_record(null::app.indicator_values,
           app.public_value(v) || case when v ? 'place_id' and not v ? 'entity_value_id'
                     then jsonb_build_object('entity_value_id',
                            (select x.id from app.entities x where x.legacy_place_id = (v->>'place_id')::uuid))
                     else '{}'::jsonb end)).*
   from app.entities e
   join app.revisions r on r.id = case when p_drafts then e.working_revision_id else e.published_revision_id end
   cross join lateral jsonb_array_elements(r.snapshot->'values') v
  where (p_drafts or e.status='published') and exists(select 1 from app.parameters p where p.id=(v->>'parameter_id')::uuid and p.is_published);
$$;
create or replace function app.snapshot_value(p_entity bigint, p_drafts boolean, p_parameter uuid) returns jsonb
language sql stable as $$
  select app.public_value(v) || case when v ? 'place_id' and not v ? 'entity_value_id'
                   then jsonb_build_object('entity_value_id',
                          (select x.id from app.entities x where x.legacy_place_id = (v->>'place_id')::uuid))
                   else '{}'::jsonb end
    from app.entities e
    join app.revisions r on r.id = case when p_drafts then e.working_revision_id else e.published_revision_id end
    cross join lateral jsonb_array_elements(r.snapshot->'values') v
    left join lateral (select i from jsonb_array_elements(r.snapshot->'indicators') i
                        where i->>'id' = v->>'indicator_id') ind on true
   where e.id = p_entity and exists(select 1 from app.parameters p where p.id=p_parameter and p.is_published)
     and (p_drafts or e.status = 'published')
     and (v->>'parameter_id')::uuid = p_parameter
     and coalesce((ind.i->>'is_current')::boolean, true)
   order by coalesce((ind.i->>'sort_order')::int, 0), coalesce((v->>'sort_order')::int, 0)
   limit 1
$$;
create or replace function app.search_params_text(p_revision uuid) returns text
language sql stable set search_path = app, pg_catalog as $$
  select string_agg(line, chr(10) order by psort, vsort)
    from (
      select p.sort_order as psort, coalesce((v->>'sort_order')::int, 0) as vsort,
             p.title_ru || ': ' || concat_ws(' — ',
               nullif(concat_ws(' ',
                 trim_scale((v->>'num_value')::numeric)::text || coalesce(' ' || p.unit, ''),
                 v->>'text_value',
                 case (v->>'bool_value')::boolean when true then 'да' when false then 'нет' end,
                 o.title_ru,
                 case when v->>'date_start_year' is not null then
                   (case when (v->>'is_approximate')::boolean then 'около ' else '' end)
                   || (v->>'date_start_year')
                   || coalesce('–' || (v->>'date_end_year'), '')
                   || case when (v->>'is_ongoing')::boolean then ' — по наст. время' else '' end end,
                 x.title_ru), ''),
               nullif(btrim(v->>'note'), '')) as line,
             (v->>'num_value') is not null or nullif(btrim(v->>'text_value'), '') is not null
               or (v->>'bool_value') is not null or o.id is not null
               or (v->>'date_start_year') is not null or x.id is not null as has_value
        from app.revisions r
        cross join lateral jsonb_array_elements(r.snapshot->'values') v
        join app.parameters p on p.id = (v->>'parameter_id')::uuid
        left join app.parameter_options o on o.id = (v->>'option_id')::uuid
        left join app.entities x on x.id = (v->>'entity_value_id')::bigint
       where r.id = p_revision and p.value_type <> 'blocks' and p.is_published
    ) lines
   where has_value;
$$;

insert into app.parameter_sets(code,title_ru,note) values
 ('research_materials','Материалы исследования','Служебный корпус источников; только редакторам'),
 ('research_source_row','Строка источника исследования','Колонки таблицы материалов'),
 ('style_solutions','Стилистические решения','Атрибуции, признаки, фазы и части объекта'),
 ('style_solution_row','Строка стилистического решения','Колонки таблицы стилистических решений');
insert into app.parameters(code,title_ru,value_type,is_published,sort_order) values('source_uid','UID источника','text',false,0);
insert into app.parameter_set_items(set_id,parameter_id,sort_order) select s.id,p.id,0 from app.parameter_sets s,app.parameters p where s.code='research_source_row' and p.code='source_uid';
insert into app.parameters(code,title_ru,value_type,is_published,sort_order) values('source_url','URL','text',false,1);
insert into app.parameter_set_items(set_id,parameter_id,sort_order) select s.id,p.id,1 from app.parameter_sets s,app.parameters p where s.code='research_source_row' and p.code='source_url';
insert into app.parameters(code,title_ru,value_type,is_published,sort_order) values('source_title','Название','text',false,2);
insert into app.parameter_set_items(set_id,parameter_id,sort_order) select s.id,p.id,2 from app.parameter_sets s,app.parameters p where s.code='research_source_row' and p.code='source_title';
insert into app.parameters(code,title_ru,value_type,is_published,sort_order) values('source_sets','UID наборов поиска','text',false,3);
insert into app.parameter_set_items(set_id,parameter_id,sort_order) select s.id,p.id,3 from app.parameter_sets s,app.parameters p where s.code='research_source_row' and p.code='source_sets';
insert into app.parameters(code,title_ru,value_type,is_published,sort_order) values('source_queries','Поисковые запросы','text',false,4);
insert into app.parameter_set_items(set_id,parameter_id,sort_order) select s.id,p.id,4 from app.parameter_sets s,app.parameters p where s.code='research_source_row' and p.code='source_queries';
insert into app.parameters(code,title_ru,value_type,is_published,sort_order) values('source_excerpt','Поисковая выдержка','text',false,5);
insert into app.parameter_set_items(set_id,parameter_id,sort_order) select s.id,p.id,5 from app.parameter_sets s,app.parameters p where s.code='research_source_row' and p.code='source_excerpt';
insert into app.parameters(code,title_ru,value_type,is_published,sort_order) values('source_text','Полученный текст','text',false,6);
insert into app.parameter_set_items(set_id,parameter_id,sort_order) select s.id,p.id,6 from app.parameter_sets s,app.parameters p where s.code='research_source_row' and p.code='source_text';
insert into app.parameters(code,title_ru,value_type,is_published,sort_order) values('source_status','Состояние получения','text',false,7);
insert into app.parameter_set_items(set_id,parameter_id,sort_order) select s.id,p.id,7 from app.parameter_sets s,app.parameters p where s.code='research_source_row' and p.code='source_status';
insert into app.parameters(code,title_ru,value_type,is_published,sort_order) values('source_provider','Провайдер','text',false,8);
insert into app.parameter_set_items(set_id,parameter_id,sort_order) select s.id,p.id,8 from app.parameter_sets s,app.parameters p where s.code='research_source_row' and p.code='source_provider';
insert into app.parameters(code,title_ru,value_type,is_published,sort_order) values('source_fetched','Дата получения','text',false,9);
insert into app.parameter_set_items(set_id,parameter_id,sort_order) select s.id,p.id,9 from app.parameter_sets s,app.parameters p where s.code='research_source_row' and p.code='source_fetched';
insert into app.parameters(code,title_ru,value_type,is_published,sort_order) values('style_name','Стиль или признак','text',true,0);
insert into app.parameter_set_items(set_id,parameter_id,sort_order) select s.id,p.id,0 from app.parameter_sets s,app.parameters p where s.code='style_solution_row' and p.code='style_name';
insert into app.parameters(code,title_ru,value_type,is_published,sort_order) values('style_relation','Характер атрибуции','text',true,1);
insert into app.parameter_set_items(set_id,parameter_id,sort_order) select s.id,p.id,1 from app.parameter_sets s,app.parameters p where s.code='style_solution_row' and p.code='style_relation';
insert into app.parameters(code,title_ru,value_type,is_published,sort_order) values('style_phase','Строительная фаза','text',true,2);
insert into app.parameter_set_items(set_id,parameter_id,sort_order) select s.id,p.id,2 from app.parameter_sets s,app.parameters p where s.code='style_solution_row' and p.code='style_phase';
insert into app.parameters(code,title_ru,value_type,is_published,sort_order) values('style_zone','Часть здания','text',true,3);
insert into app.parameter_set_items(set_id,parameter_id,sort_order) select s.id,p.id,3 from app.parameter_sets s,app.parameters p where s.code='style_solution_row' and p.code='style_zone';
insert into app.parameters(code,title_ru,value_type,is_published,sort_order) values('style_reason','Обоснование','text',true,4);
insert into app.parameter_set_items(set_id,parameter_id,sort_order) select s.id,p.id,4 from app.parameter_sets s,app.parameters p where s.code='style_solution_row' and p.code='style_reason';
insert into app.parameters(code,title_ru,value_type,is_published,sort_order) values('style_sources','Источники','text',true,5);
insert into app.parameter_set_items(set_id,parameter_id,sort_order) select s.id,p.id,5 from app.parameter_sets s,app.parameters p where s.code='style_solution_row' and p.code='style_sources';
insert into app.parameters(code,title_ru,value_type,row_set_id,is_published) select 'research_sources','Источники и тексты','table',id,false from app.parameter_sets where code='research_source_row';
insert into app.parameter_set_items(set_id,parameter_id) select s.id,p.id from app.parameter_sets s,app.parameters p where s.code='research_materials' and p.code='research_sources';
insert into app.parameters(code,title_ru,value_type,row_set_id,is_published) select 'style_solutions','Стилистические решения','table',id,true from app.parameter_sets where code='style_solution_row';
insert into app.parameter_set_items(set_id,parameter_id) select s.id,p.id from app.parameter_sets s,app.parameters p where s.code='style_solutions' and p.code='style_solutions';

insert into app.parameters(code,title_ru,value_type,is_published) values('research_state','Состояние и предложения исследований','text',false);
insert into app.parameter_set_items(set_id,parameter_id) select s.id,p.id from app.parameter_sets s,app.parameters p where s.code='research_materials' and p.code='research_state';
-- Existing definitions remain public; retain their search chunks and vectors.
-- Newly introduced private parameters have never entered the index.

create or replace function app.search_revision_source(p_revision uuid) returns jsonb
language sql stable set search_path = app, pg_catalog as $$
  select jsonb_build_object(
           'titles', jsonb_build_array(r.snapshot->'entity'->>'title_ru',
                                       r.snapshot->'entity'->>'title_original',
                                       r.snapshot->'entity'->>'title_en',
                                       r.snapshot->'entity'->>'title_la'),
           'type_title', ty.title_ru,
           'tags', coalesce((select jsonb_agg(t->>'title') from jsonb_array_elements(r.snapshot->'tags') t), '[]'),
           'params', app.search_params_text(r.id),
           'body', coalesce(app.public_body(r.snapshot), '[]'))
    from app.revisions r
    left join app.entity_types ty on ty.id = (r.snapshot->'entity'->>'type_id')::uuid
   where r.id = p_revision;
$$;
create or replace function app.table_columns(p_parameter uuid) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', p.code, 'title', p.title_ru,
                                               'unit', p.unit, 'value_type', p.value_type, 'options', (select coalesce(jsonb_agg(jsonb_build_object('code',o.code,'title',o.title_ru)), '[]'::jsonb) from app.parameter_options o where o.parameter_id=p.id))
                            order by i.sort_order), '[]'::jsonb)
    from app.parameters t
    join app.parameter_set_items i on i.set_id = t.row_set_id
    join app.parameters p on p.id = i.parameter_id
   where t.id = p_parameter
$$;
create or replace function app.area_program_totals(p_entity bigint, p_drafts boolean) returns jsonb
language sql stable as $$
  with v as (
    select ind.i as indicator, val.v as value
      from app.entities e
      join app.revisions r on r.id = case when p_drafts then e.working_revision_id else e.published_revision_id end
      cross join lateral jsonb_array_elements(r.snapshot->'values') val(v)
      left join lateral (select i from jsonb_array_elements(r.snapshot->'indicators') i
                          where i->>'id' = val.v->>'indicator_id') ind on true
     where e.id = p_entity and (p_drafts or e.status = 'published')
       and (val.v->>'parameter_id')::uuid = (select id from app.parameters where code = 'area_program' and is_published and not exists(select 1 from app.parameter_set_items si join app.parameters cp on cp.id=si.parameter_id where si.set_id=app.parameters.row_set_id and not cp.is_published))
  ),
  rows as (
    select v.indicator, app.program_row_area(x.r) as area,
           (x.r ->> (select id::text from app.parameters where code = 'program_seats'))::numeric as people,
           app.option_path((x.r ->> (select id::text from app.parameters where code = 'program_purpose'))::uuid) as path
      from v cross join lateral jsonb_array_elements(v.value->'table_value') x(r)
     where coalesce(x.r ->> (select id::text from app.parameters where code = 'program_in_total'), '')
           <> (select o.id::text from app.parameter_options o join app.parameters p on p.id = o.parameter_id
                where p.code = 'program_in_total' and o.code = 'no')
  ),
  purposes as (
    select indicator, path->0 as zone, coalesce(path->1, path->0) as purpose,
           sum(area) as area, sum(people) as people
      from rows group by indicator, path->0, coalesce(path->1, path->0)
  ),
  zones as (
    select indicator, zone, sum(area) as area, sum(people) as people,
           jsonb_agg(jsonb_build_object('code', purpose->>'code', 'title', purpose->>'title',
                                        'area', area, 'people', people)
                     order by (select sort_order from app.parameter_options where code = purpose->>'code'
                                 and parameter_id = (select id from app.parameters where code = 'program_purpose'))) as purposes
      from purposes group by indicator, zone
  ),
  shared as (select z.*, sum(z.area) over (partition by z.indicator->>'id') as total from zones z)
  select coalesce(jsonb_agg(g order by (g->>'sort')::int), '[]'::jsonb) from (
    select jsonb_build_object(
             'indicator_id', s.indicator->>'id',
             'title', s.indicator->>'title',
             'sort', coalesce((s.indicator->>'sort_order')::int, 0),
             'total_area', max(s.total),
             'zones', jsonb_agg(jsonb_build_object(
                 'code', coalesce(s.zone->>'code', ''), 'title', coalesce(s.zone->>'title', 'Без назначения'),
                 'area', s.area, 'people', s.people,
                 'share', round(s.area / nullif(s.total, 0), 4),
                 'purposes', s.purposes)
               order by (select sort_order from app.parameter_options where code = s.zone->>'code'
                           and parameter_id = (select id from app.parameters where code = 'program_purpose')) nulls last)) as g
      from shared s
     group by s.indicator
  ) t
$$;
-- Technical definitions cannot accidentally be made public by a generic edit.
create function app.guard_parameter_visibility() returns trigger language plpgsql as $$
begin
 if new.is_published and (new.code in ('research_sources','research_state') or exists(select 1 from app.parameter_set_items i join app.parameter_sets s on s.id=i.set_id where i.parameter_id=new.id and s.code='research_source_row')) then raise exception 'Технический параметр остаётся скрытым'; end if;
 if old.is_published is distinct from new.is_published then delete from app.search_chunks; end if;
 return new;
end $$;
create trigger parameter_visibility before update of is_published on app.parameters for each row execute function app.guard_parameter_visibility();
grant execute on function app.public_table(jsonb),app.public_value(jsonb),app.public_body(jsonb) to app_api;

insert into app.parameters(code,title_ru,value_type,is_published) values('source_observations','История получения','text',false);
insert into app.parameter_set_items(set_id,parameter_id,sort_order) select s.id,p.id,11 from app.parameter_sets s,app.parameters p where s.code='research_source_row' and p.code='source_observations';
-- Transfer, retaining the complete legacy table as immutable archive.
do $$ declare e record; gid uuid; pid uuid; rows jsonb; begin
 select id into pid from app.parameters where code='research_sources';
 for e in select distinct entity_id from app.entity_external_descriptions loop
  insert into app.indicators(entity_id,title,is_current) values(e.entity_id,'Материалы исследования',true) returning id into gid;
  select jsonb_agg(jsonb_build_object('source_uid',d.id::text,'source_url',d.url,'source_title',d.title,'source_excerpt',d.excerpt,'source_provider',d.provider,'source_sets','[]','source_queries','[]','source_text','','source_status','Перенесена поисковая выдержка','source_fetched',d.updated_at::text,'source_observations',d.observations::text)) into rows from app.entity_external_descriptions d where entity_id=e.entity_id;
  insert into app.indicator_values(indicator_id,parameter_id,table_value) values(gid,pid,app.table_rows_from_codes(pid,rows));
  insert into app.indicator_values(indicator_id,parameter_id,text_value) select gid,id,'{}' from app.parameters where code='research_state';
  insert into app.entity_parameter_sets(entity_id,set_id) select e.entity_id,id from app.parameter_sets where code='research_materials' on conflict do nothing;
  insert into app.revisions(material_id,base_revision_id,edited_by,operation,summary,snapshot)
   select m.id,ent.working_revision_id,coalesce(ent.updated_by,ent.created_by),'edit','Перенос материалов исследования в параметры','{}'::jsonb from app.entities ent join app.materials m on m.entity_id=ent.id where ent.id=e.entity_id;
 end loop;
end $$;
revoke insert,update on app.entity_external_descriptions from app_api;
comment on table app.entity_external_descriptions is 'Immutable legacy archive 0057. Current corpus is research_sources table parameter (0058).';
