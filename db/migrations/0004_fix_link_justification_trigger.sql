-- 0004: исправление функции проверки обоснования связи.
--
-- В 0002 переменная называлась link_id и совпадала с именем колонки
-- app.targets.link_id: PostgreSQL не мог решить, что имеется в виду, и
-- проверка падала с ошибкой «column reference link_id is ambiguous».
-- Найдено проверкой ограничений на живой схеме до наполнения данными.

create or replace function app.tg_link_requires_justification() returns trigger language plpgsql as $$
declare
    checked_link_id bigint := coalesce(new.id, old.id);
    found_justification boolean;
begin
    -- Для удаления вложения new пуст: определяем связь по цели удалённой записи.
    if tg_table_name = 'attachments' then
        select t.link_id into checked_link_id
        from app.targets t where t.id = old.target_id;
    end if;

    if checked_link_id is null then
        return null;
    end if;

    if not exists (select 1 from app.links l where l.id = checked_link_id) then
        return null;  -- связь удалена целиком, проверять нечего
    end if;

    select exists (
        select 1
        from app.attachments a
        join app.targets t on t.id = a.target_id
        join app.attachment_roles r on r.id = a.role_id
        where t.link_id = checked_link_id and r.code = 'justification'
    ) into found_justification;

    if not found_justification then
        raise exception 'Связь % не имеет обоснования: требуется вложение с ролью justification', checked_link_id
            using errcode = 'integrity_constraint_violation';
    end if;
    return null;
end;
$$;

comment on function app.tg_link_requires_justification() is
    'Отложенная проверка: у связи при фиксации транзакции есть вложение с ролью justification.';
