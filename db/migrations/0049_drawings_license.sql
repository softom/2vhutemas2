-- Чертежи: лицензия в подписи — сведения хранят её под ключом license_code;
-- год листа — для подписи.
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
