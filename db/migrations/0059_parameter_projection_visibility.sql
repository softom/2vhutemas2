-- Complete parameter visibility in legacy place/image/source projections.
create or replace function app.place_json(p_entity bigint, p_drafts boolean) returns jsonb
language sql stable as $$
  select jsonb_build_object(
           'id', e.id::text, 'entity_id', e.id, 'slug', e.slug, 'title', e.title_ru,
           'country',    max(case when p.code = 'country' then v->>'text_value' end),
           'settlement', max(case when p.code = 'settlement' then v->>'text_value' end),
           'street',     max(case when p.code = 'street' then v->>'text_value' end),
           'house',      max(case when p.code = 'house' then v->>'text_value' end),
           'unit',       max(case when p.code = 'unit' then v->>'text_value' end),
           'lat',        max(case when p.code = 'latitude' then (v->>'num_value')::numeric end),
           'lon',        max(case when p.code = 'longitude' then (v->>'num_value')::numeric end),
           'precision',  coalesce(max(case when p.code = 'coord_precision'
                                            then (select o.code from app.parameter_options o
                                                   where o.id = (v->>'option_id')::uuid) end), 'building'),
           'source_url', max(case when p.code = 'info_source_url' then v->>'text_value' end))
    from app.entities e
    join app.revisions r on r.id = case when p_drafts then e.working_revision_id else e.published_revision_id end
    left join lateral jsonb_array_elements(r.snapshot->'values') v on true
    left join app.parameters p on p.id = (v->>'parameter_id')::uuid and p.is_published
   where e.id = p_entity
   group by e.id, e.slug, e.title_ru
$$;
create or replace function app.image_json(p_entity bigint, p_drafts boolean) returns jsonb
language sql stable as $$
  select jsonb_build_object(
           'entity_id', e.id, 'slug', e.slug, 'title', r.snapshot->'entity'->>'title_ru',
           'is_published', e.status = 'published',
           'kind',             max(case when p.code = 'image_kind'
                                         then (select o.code from app.parameter_options o
                                                where o.id = (v->>'option_id')::uuid) end),
           'author',           max(case when p.code = 'image_author' then v->>'text_value' end),
           'credit',           max(case when p.code = 'rights_holder' then v->>'text_value' end),
           'source_url',       max(case when p.code = 'image_source_url' then v->>'text_value' end),
           'original_caption', max(case when p.code = 'source_caption' then v->>'text_value' end),
           'holder',           max(case when p.code = 'holder' then v->>'text_value' end),
           'inventory_no',     max(case when p.code = 'inventory_no' then v->>'text_value' end),
           'created_year',     max(case when p.code = 'created_year' then (v->>'num_value')::numeric end),
           'license_code',     max(case when p.code = 'license' then v->>'text_value' end),
           'alt_text',         max(case when p.code = 'alt_text' then v->>'text_value' end),
           'description',      max(case when p.code = 'image_description' then v->>'text_value' end))
    from app.entities e
    join app.revisions r on r.id = case when p_drafts then e.working_revision_id else e.published_revision_id end
    left join lateral jsonb_array_elements(r.snapshot->'values') v on true
    left join app.parameters p on p.id = (v->>'parameter_id')::uuid and p.is_published
   where e.id = p_entity
   group by e.id, e.slug, e.status, r.snapshot
$$;
create or replace function app.sources_json(p_entity bigint, p_drafts boolean) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', src.id, 'entity_id', src.id, 'slug', src.slug, 'link_id', l.id,
           'kind', t.code, 'kind_title', t.title_ru, 'title', src.title_ru,
           'url', (select v->>'text_value'
                     from app.revisions sr, jsonb_array_elements(sr.snapshot->'values') v
                     join app.parameters p on p.id = (v->>'parameter_id')::uuid and p.is_published
                    where sr.id = case when p_drafts then src.working_revision_id else src.published_revision_id end
                      and p.code in ('url', 'wiki_url') limit 1),
           'year', (select (v->>'date_start_year')::int
                      from app.revisions sr, jsonb_array_elements(sr.snapshot->'values') v
                      join app.parameters p on p.id = (v->>'parameter_id')::uuid and p.is_published
                     where sr.id = case when p_drafts then src.working_revision_id else src.published_revision_id end
                       and p.code = 'publication' limit 1),
           'text', (select string_agg(b->'content'->0->>'text', ' ')
                      from app.revisions lr, jsonb_array_elements(app.public_body(lr.snapshot)) b
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
