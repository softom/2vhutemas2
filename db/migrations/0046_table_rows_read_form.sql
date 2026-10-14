-- Строки таблицы принимаются и в виде чтения: вариант — {code, title, path}.
--
-- Замечание пользователя 2026-10-14: «Не даёт опубликовать!» — редактор
-- отправляет строки площадной программы обратно так, как получил их из
-- GET /entities/{id} (у варианта объект с кодом, названием и путём), и база
-- отвечала «нет варианта {…}». Теперь у объекта берётся code.
CREATE OR REPLACE FUNCTION app.table_rows_from_codes(p_parameter uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
    row_set uuid;
    r jsonb;
    cell record;
    col record;
    out_row jsonb;
    result jsonb := '[]'::jsonb;
    opt uuid;
    n int := 0;
begin
    select row_set_id into row_set from app.parameters where id = p_parameter;
    if row_set is null then
        raise exception 'Параметр не табличный' using errcode = 'check_violation';
    end if;
    if jsonb_typeof(p_rows) <> 'array' then
        raise exception 'Строки таблицы — массив' using errcode = 'check_violation';
    end if;
    for r in select * from jsonb_array_elements(p_rows) loop
        n := n + 1;
        out_row := '{}'::jsonb;
        for cell in select key, value from jsonb_each(r) loop
            continue when cell.value is null or cell.value = 'null'::jsonb or cell.value = '""'::jsonb;
            -- Вариант мог прийти в виде чтения — {code, title, path}: редактор
            -- отправляет строки так, как получил их. Берётся код.
            if jsonb_typeof(cell.value) = 'object' and cell.value ? 'code' then
                cell.value := cell.value -> 'code';
            end if;
            select p.id, p.title_ru, p.value_type into col
              from app.parameters p
              join app.parameter_set_items i on i.parameter_id = p.id and i.set_id = row_set
             where p.code = cell.key;
            if not found then
                raise exception 'Строка %: колонки «%» нет в таблице', n, cell.key using errcode = 'check_violation';
            end if;
            if col.value_type = 'option' then
                select o.id into opt from app.parameter_options o
                 where o.parameter_id = col.id and o.code = cell.value #>> '{}';
                if opt is null then
                    raise exception 'Строка %: «%» — нет варианта «%»', n, col.title_ru, cell.value #>> '{}'
                        using errcode = 'check_violation';
                end if;
                out_row := out_row || jsonb_build_object(col.id::text, opt::text);
            elsif col.value_type in ('number', 'integer') and jsonb_typeof(cell.value) = 'string' then
                out_row := out_row || jsonb_build_object(col.id::text, replace(cell.value #>> '{}', ',', '.')::numeric);
            else
                out_row := out_row || jsonb_build_object(col.id::text, cell.value);
            end if;
        end loop;
        if out_row <> '{}'::jsonb then
            result := result || jsonb_build_array(out_row);
        end if;
    end loop;
    return result;
end;
$function$;
