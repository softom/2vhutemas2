-- Р-78: одна редакция сущности вместе с МультиТекстом.
-- Прежние документы, материалы и снимки остаются неизменной историей.
-- materials сохраняет прежние ID и авторские подписи, но не управляет
-- публикацией сущностей/связей; их состояние находится у владельца.
alter table app.entities
  add column status text not null default 'draft' check (status in ('draft','published','archived')),
  add column published_revision_id uuid,
  add column working_revision_id uuid,
  add column legacy_description_id bigint references app.documents(id);
alter table app.links
  add column status text not null default 'draft' check (status in ('draft','published','archived')),
  add column published_revision_id uuid,
  add column working_revision_id uuid;
alter table app.revisions
  add column entity_id bigint references app.entities(id) on delete cascade,
  add column link_id bigint references app.links(id) on delete cascade,
  add constraint revisions_owner_exclusive check (num_nonnulls(entity_id,link_id) <= 1);
create index revisions_entity_idx on app.revisions(entity_id, created_at desc);
create index revisions_link_idx on app.revisions(link_id, created_at desc);
-- Идентификация прежних версий: содержимое и авторство не переписываются.
update app.revisions r set entity_id=m.entity_id,link_id=m.link_id
from app.materials m where m.id=r.material_id and (m.entity_id is not null or m.link_id is not null);
alter table app.entities disable trigger entities_audit_trg;
alter table app.links disable trigger links_audit_trg;
update app.entities e set status=m.status from app.materials m where m.entity_id=e.id;
update app.links l set status=m.status from app.materials m where m.link_id=l.id;
update app.entities e set legacy_description_id=(
 select d.id from app.attachments a join app.targets t on t.id=a.target_id
 join app.attachment_roles ar on ar.id=a.role_id join app.documents d on d.id=a.document_id
 left join app.materials m on m.document_id=d.id
 where t.entity_id=e.id and ar.code in ('description','wiki') and coalesce(m.status,'draft')<>'archived'
 order by a.sort_order,a.id limit 1);

create function app.entity_snapshot(p_id bigint, p_body jsonb default null) returns jsonb
language sql stable as $$
 select jsonb_build_object('entity',to_jsonb(e)-'published_revision_id'-'working_revision_id',
   'body_json',coalesce(p_body,r.snapshot->'body_json','[]'::jsonb),
   'indicators',coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order,i.id) from app.indicators i where i.entity_id=e.id),'[]'::jsonb),
   'values',coalesce((select jsonb_agg(to_jsonb(v) order by v.id) from app.indicator_values v join app.indicators i on i.id=v.indicator_id where i.entity_id=e.id),'[]'::jsonb),
   'tags',coalesce((select jsonb_agg(to_jsonb(t) order by t.title) from app.entity_tags et join app.tags t on t.id=et.tag_id where et.entity_id=e.id),'[]'::jsonb))
 from app.entities e left join app.revisions r on r.id=e.working_revision_id where e.id=p_id;
$$;

-- Первый единый снимок фиксирует реально показывавшиеся сведения. У прежних
-- снимков параметров не было значений, поэтому они не объявляются полными.
-- Для гостя переносится только прежний публичный текст; рабочий текст отдельно.
do $$
declare e record; d record; pub_body jsonb; work_body jsonb; rid uuid; wid uuid;
begin
 for e in select x.*,m.id as mid,m.created_by as author from app.entities x join app.materials m on m.entity_id=x.id loop
   select body_json into work_body from app.documents where id=e.legacy_description_id;
   work_body:=coalesce(work_body,'[]'::jsonb);
   select doc.body_json into pub_body from app.attachments a join app.targets t on t.id=a.target_id
    join app.attachment_roles ar on ar.id=a.role_id join app.documents doc on doc.id=a.document_id
    join app.materials dm on dm.document_id=doc.id
    where t.entity_id=e.id and ar.code in ('description','wiki') and dm.status='published'
    order by a.sort_order,a.id limit 1;
   pub_body:=coalesce(pub_body,'[]'::jsonb);
   insert into app.revisions(material_id,entity_id,edited_by,operation,summary,schema_version,snapshot)
    values(e.mid,e.id,e.author,'edit','Р-78: перенос единой редакции',2,app.entity_snapshot(e.id,case when e.status='published' then pub_body else work_body end)) returning id into rid;
   wid:=rid;
   if e.status='published' and work_body<>pub_body then
     insert into app.revisions(material_id,entity_id,base_revision_id,edited_by,operation,summary,schema_version,snapshot)
      values(e.mid,e.id,rid,e.author,'edit','Р-78: сохранён рабочий текст',2,app.entity_snapshot(e.id,work_body)) returning id into wid;
   end if;
   update app.entities set working_revision_id=wid,published_revision_id=case when e.status='published' then rid end where id=e.id;
 end loop;
 for e in select l.*,m.id as mid,m.created_by as author from app.links l join app.materials m on m.link_id=l.id loop
   select doc.body_json into work_body from app.attachments a join app.targets t on t.id=a.target_id
    join app.attachment_roles ar on ar.id=a.role_id join app.documents doc on doc.id=a.document_id
    where t.link_id=e.id and ar.code='justification' order by a.sort_order,a.id limit 1;
   insert into app.revisions(material_id,link_id,edited_by,operation,summary,schema_version,snapshot)
    values(e.mid,e.id,e.author,'edit','Р-78: перенос основания связи',2,
     jsonb_build_object('link',to_jsonb(e)-'mid'-'author','body_json',coalesce(work_body,'[]'::jsonb))) returning id into rid;
   update app.links set working_revision_id=rid,published_revision_id=case when e.status='published' then rid end where id=e.id;
 end loop;
end $$;

alter table app.entities enable trigger entities_audit_trg;
alter table app.links enable trigger links_audit_trg;

alter table app.revisions add constraint revisions_id_entity_unique unique(id,entity_id),
 add constraint revisions_id_link_unique unique(id,link_id);
alter table app.entities add constraint entities_public_revision_owner foreign key(published_revision_id,id) references app.revisions(id,entity_id),
 add constraint entities_work_revision_owner foreign key(working_revision_id,id) references app.revisions(id,entity_id),
 add constraint entities_public_state check ((status='published')=(published_revision_id is not null));
alter table app.links add constraint links_public_revision_owner foreign key(published_revision_id,id) references app.revisions(id,link_id),
 add constraint links_work_revision_owner foreign key(working_revision_id,id) references app.revisions(id,link_id),
 add constraint links_public_state check ((status='published')=(published_revision_id is not null));

-- Любой существующий путь правки параметров получает полный снимок автоматически.
create function app.tg_owned_revision() returns trigger language plpgsql as $$
declare m record;
begin
 select * into m from app.materials where id=new.material_id;
 new.entity_id:=m.entity_id; new.link_id:=m.link_id;
 if new.entity_id is not null then
   perform 1 from app.entities where id=new.entity_id for update;
   new.snapshot:=app.entity_snapshot(new.entity_id,new.snapshot->'body_json');
   new.schema_version:=2;
 elsif new.link_id is not null then
   perform 1 from app.links where id=new.link_id for update;
   new.snapshot:=jsonb_build_object('link',(select to_jsonb(l) from app.links l where id=new.link_id),
     'body_json',coalesce(new.snapshot->'body_json',(select snapshot->'body_json' from app.revisions where id=(select working_revision_id from app.links where id=new.link_id)),'[]'::jsonb));
   new.schema_version:=2;
 end if;
 return new;
end $$;
create trigger revisions_owned_before before insert on app.revisions for each row execute function app.tg_owned_revision();
create function app.tg_owned_revision_head() returns trigger language plpgsql as $$
begin
 if new.entity_id is not null then update app.entities set working_revision_id=new.id where id=new.entity_id;
 elsif new.link_id is not null then update app.links set working_revision_id=new.id where id=new.link_id; end if;
 if new.entity_id is not null and new.base_revision_id is not null then
   insert into app.document_entity_refs select new.id,occurrence_id,block_id,entity_id,pinned_revision_id,display_mode,target_block_id,media_asset_id,note,ordinal
   from app.document_entity_refs where revision_id=new.base_revision_id;
 end if;
 return null;
end $$;
create trigger revisions_owned_after after insert on app.revisions for each row execute function app.tg_owned_revision_head();

-- Состояние публикации принадлежит сущности. Старый реестр обслуживает
-- независимые медиа/источники и остаётся архивом ID для старых интеграций.
create or replace function app.tg_sync_published() returns trigger language plpgsql as $$
declare published boolean:=(new.status='published' and new.published_revision_id is not null);
begin
 if new.reference_item_id is not null then update app.reference_items set is_published=published where id=new.reference_item_id;
 elsif new.asset_id is not null then update app.media_assets set is_published=published,
 archived_at=case when new.status='archived' then coalesce(archived_at,now()) else null end where id=new.asset_id; end if;
 return null;
end $$;
create function app.tg_entity_public_flag() returns trigger language plpgsql as $$
begin new.is_published:=(new.status='published' and new.published_revision_id is not null);return new;end $$;
create trigger entities_public_flag before insert or update on app.entities for each row execute function app.tg_entity_public_flag();

-- Один способ выбора редакции для карточки, каталога, поиска и связей.
create function app.read_entities(p_drafts boolean) returns setof app.entities language sql stable as $$
 select (jsonb_populate_record(null::app.entities,
   r.snapshot->'entity' || jsonb_build_object('status',e.status,'is_published',e.is_published,
    'published_revision_id',e.published_revision_id,'working_revision_id',e.working_revision_id,
    'legacy_description_id',e.legacy_description_id))).*
 from app.entities e join app.revisions r on r.id=case when p_drafts then e.working_revision_id else e.published_revision_id end
 where p_drafts or e.status='published';
$$;
create function app.read_indicators(p_drafts boolean) returns setof app.indicators language sql stable as $$
 select i.* from app.entities e join app.revisions r on r.id=case when p_drafts then e.working_revision_id else e.published_revision_id end
 cross join lateral jsonb_populate_recordset(null::app.indicators,r.snapshot->'indicators') i
 where p_drafts or e.status='published';
$$;
create function app.read_values(p_drafts boolean) returns setof app.indicator_values language sql stable as $$
 select v.* from app.entities e join app.revisions r on r.id=case when p_drafts then e.working_revision_id else e.published_revision_id end
 cross join lateral jsonb_populate_recordset(null::app.indicator_values,r.snapshot->'values') v
 where p_drafts or e.status='published';
$$;
create function app.read_entity_tags(p_drafts boolean) returns table(entity_id bigint,tag_id uuid) language sql stable as $$
 select e.id,(t->>'id')::uuid from app.entities e join app.revisions r on r.id=case when p_drafts then e.working_revision_id else e.published_revision_id end
 cross join lateral jsonb_array_elements(r.snapshot->'tags') t where p_drafts or e.status='published';
$$;
create function app.read_links(p_drafts boolean) returns setof app.links language sql stable as $$
 select (jsonb_populate_record(null::app.links,r.snapshot->'link'||jsonb_build_object('status',l.status,
 'published_revision_id',l.published_revision_id,'working_revision_id',l.working_revision_id))).*
 from app.links l join app.revisions r on r.id=case when p_drafts then l.working_revision_id else l.published_revision_id end
 where l.status<>'archived' and (p_drafts or l.status='published');
$$;
grant execute on function app.entity_snapshot(bigint,jsonb),app.read_entities(boolean),app.read_indicators(boolean),app.read_values(boolean),app.read_entity_tags(boolean),app.read_links(boolean) to app_api;

-- Обязательное основание теперь находится в версии связи.
create or replace function app.tg_link_requires_justification() returns trigger language plpgsql as $$
declare checked_id bigint;
begin
 if tg_table_name='attachments' then select link_id into checked_id from app.targets where id=old.target_id;
 else checked_id:=new.id; end if;
 if checked_id is null or not exists(select 1 from app.links where id=checked_id) then return null; end if;
 if not exists(select 1 from app.links l join app.revisions r on r.id=l.working_revision_id
   where l.id=checked_id and jsonb_typeof(r.snapshot->'body_json')='array' and jsonb_array_length(r.snapshot->'body_json')>0) then
   raise exception 'Связь % не имеет обоснования',checked_id using errcode='integrity_constraint_violation';
 end if;return null;
end $$;

insert into app.document_entity_refs(revision_id,occurrence_id,block_id,entity_id,pinned_revision_id,display_mode,target_block_id,media_asset_id,note,ordinal)
 select r.id,refs.occurrence_id,refs.block_id,refs.entity_id,refs.pinned_revision_id,refs.display_mode,refs.target_block_id,refs.media_asset_id,refs.note,refs.ordinal
 from app.entities e join app.revisions r on r.id in (e.working_revision_id,e.published_revision_id)
 join lateral (
   select old.id from app.attachments a join app.targets t on t.id=a.target_id
   join app.attachment_roles ar on ar.id=a.role_id
   join app.materials dm on dm.document_id=a.document_id
   join app.revisions old on old.material_id=dm.id
   where t.entity_id=e.id and ar.code in ('description','wiki')
     and old.snapshot->'body_json'=r.snapshot->'body_json'
   order by old.created_at desc,old.id limit 1
 ) source on true
 join app.document_entity_refs refs on refs.revision_id=source.id
 on conflict do nothing;
create or replace view app.published_entity_mentions as
 select refs.entity_id,m.id as material_id,coalesce(e.legacy_description_id,-e.id) as document_id,
 r.snapshot->'entity'->>'title_ru' as document_title,refs.display_mode,refs.ordinal,e.id as owner_entity_id
 from app.entities e join app.revisions r on r.id=e.published_revision_id
 join app.materials m on m.entity_id=e.id join app.document_entity_refs refs on refs.revision_id=r.id
 where e.status='published'
 union all
 select refs.entity_id,m.id,m.document_id,d.title,refs.display_mode,refs.ordinal,null::bigint
 from app.materials m join app.documents d on d.id=m.document_id
 join app.document_entity_refs refs on refs.revision_id=m.published_revision_id
 where m.status='published' and not exists(select 1 from app.attachments a join app.targets t on t.id=a.target_id
   where a.document_id=d.id and (t.entity_id is not null or t.link_id is not null));

-- Версионное содержимое после создания неизменно, в том числе для роли API.
create function app.tg_revision_immutable() returns trigger language plpgsql as $$
begin
 if new.snapshot is distinct from old.snapshot or new.edited_by is distinct from old.edited_by
 or new.created_at is distinct from old.created_at or new.base_revision_id is distinct from old.base_revision_id
 or new.entity_id is distinct from old.entity_id or new.link_id is distinct from old.link_id
 or new.material_id is distinct from old.material_id or new.schema_version is distinct from old.schema_version
 or new.operation is distinct from old.operation or new.summary is distinct from old.summary then
 raise exception 'Сохранённая версия неизменяема' using errcode='integrity_constraint_violation';end if;
 return new;
end $$;
create trigger revisions_immutable before update on app.revisions for each row execute function app.tg_revision_immutable();
