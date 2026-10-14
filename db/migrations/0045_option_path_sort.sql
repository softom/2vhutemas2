-- Путь варианта несёт порядок узла: площадная программа на странице записи
-- выводит зоны и назначения в порядке классификатора, а не в порядке строк.
create or replace function app.option_path(p_option uuid) returns jsonb
language sql stable as $$
  with recursive up as (
      select id, parent_id, code, title_ru, sort_order, 0 as depth from app.parameter_options where id = p_option
      union all
      select o.id, o.parent_id, o.code, o.title_ru, o.sort_order, up.depth + 1
        from app.parameter_options o join up on o.id = up.parent_id)
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'title', title_ru, 'sort', sort_order)
                            order by depth desc), '[]'::jsonb)
    from up
$$;
