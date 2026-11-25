-- 0085. Цвет и знак понятия: два текстовых параметра и наполнение по реестру.
--
-- Решения: Д1 (вариант Б — без новых таблиц; два текстовых параметра в наборе
-- ветви architecture_classification) и Д4 (составной индекс на связи — по
-- замерам Р32: прежний подбор «близких объектов» 769,5 мс, новый слой
-- 113,1 мс при сканировании всей таблицы связей).
--
-- Реестр: WIKI/Классификация — цвета и пиктограммы.md, 101 понятие.
--
-- Порядок: параметры → пункты набора → значения → новая версия каждого
-- понятия → публикация → индекс. Прежние версии не переписываются: цвет и
-- знак попадают в новую рабочую и в новую опубликованную версию.
--
-- Откат: отдельным решением удаляются значения, пункты набора и параметры;
-- история версий и указатели публикации не откатываются — полный возврат
-- восстановлением из резервной копии по правилам проекта.

-- Реестр понятий: UID, HEX-цвет, ключ знака.
create temporary table tmp_concept_registry (
  uid bigint primary key,
  hex text not null,
  icon text not null
) on commit drop;

insert into tmp_concept_registry (uid, hex, icon) values
(3575,'#7A5C3E','epoch_tradition'),(3577,'#4F7A65','epoch_fin_de_siecle'),(3576,'#A9381F','epoch_avant_garde'),(1769,'#2F5D8A','epoch_modernism'),(3343,'#8B4268','epoch_postmodernism'),(3651,'#2E6F73','epoch_metamodernism'),(3584,'#7E6538','style_historicism'),(3585,'#6E563B','style_neogothic'),(3586,'#8C5830','style_neorussian'),(3587,'#6D6E3E','style_arts_crafts'),(3348,'#4F725D','style_art_nouveau'),(3588,'#63734E','style_secession'),(3589,'#4B6862','style_northern_nouveau'),(3591,'#A9381F','style_rus_avantgarde'),(3351,'#B33A22','style_constructivism'),(3592,'#993D26','style_asnova'),(3593,'#B82E1F','style_suprematism'),(3594,'#C24A24','style_futurism'),(3595,'#9E4A2B','style_expressionism'),(3596,'#8E4432','style_czech_cubism'),(3597,'#A3422E','style_de_stijl'),(3590,'#3E5C76','style_chicago'),(3350,'#2E5882','style_bauhaus'),(3349,'#35648C','style_functionalism'),(3353,'#2A5075','style_international'),(3731,'#3D5E80','style_euro_rationalism'),(3607,'#466987','style_soviet_modernism'),(3613,'#4D667D','style_minimalism'),(3352,'#8A6126','style_art_deco'),(3598,'#7C6534','style_streamline'),(3599,'#7D4E35','style_monumental_neo'),(3600,'#874834','style_postconstructivism'),(3601,'#8F532E','style_soviet_artdeco'),(3602,'#7D3B3B','style_stalinist_empire'),(3603,'#8A423C','style_national_socreal'),(3354,'#5A5753','style_brutalism'),(3604,'#4B6F50','style_organic'),(3612,'#9A5A3A','style_critical_regionalism'),(3605,'#A66A38','style_midcentury'),(3609,'#696454','style_structuralism'),(3355,'#2B6E7E','style_hightech'),(3610,'#32627A','style_struct_expr'),(3608,'#2F736B','style_metabolism'),(3606,'#3A6E8C','style_googie'),(3611,'#85456D','style_postmodern'),(3356,'#783E6B','style_deconstructivism'),(3614,'#6D4E8A','style_pragmatic_icon'),(3652,'#7A4E85','style_blobitecture'),(3713,'#5B5A8C','style_biomorphic'),(3714,'#4B588F','style_computational'),(3357,'#604C8C','style_parametricism'),(3344,'#8C6229','method_tectonic'),(3579,'#7D5B30','method_geometric'),(3580,'#705E3C','method_modular'),(3345,'#3D6E6B','method_functional'),(3581,'#437056','method_environmental'),(3582,'#4A6673','method_typological'),(3346,'#9C4F3A','method_plastic'),(3347,'#8A4557','method_symbolic'),(3578,'#7A5170','method_perceptual'),(3583,'#55558C','method_algorithmic'),(3358,'#4C5661','trait_suspended_floors'),(3359,'#4C5661','trait_concrete_core'),(3615,'#4C5661','trait_pilotis'),(3616,'#4C5661','trait_cantilever'),(3617,'#4C5661','trait_thin_shell'),(3618,'#4C5661','trait_diagrid'),(3619,'#4C5661','trait_exoskeleton'),(3620,'#4C5661','trait_membrane'),(3621,'#4C5661','trait_glazed_vault'),(3622,'#7D5B3B','trait_asymmetric'),(3623,'#7D5B3B','trait_tilted_cylinder'),(3624,'#7D5B3B','trait_stepped'),(3625,'#7D5B3B','trait_intersecting'),(3626,'#7D5B3B','trait_capsules'),(3627,'#7D5B3B','trait_roof_ramp'),(3628,'#7D5B3B','trait_open_stair'),(3629,'#7D5B3B','trait_shards'),(3630,'#7D5B3B','trait_biomorphic_shell'),(3631,'#7D5B3B','trait_symmetry'),(3632,'#7D5B3B','trait_spire'),(3361,'#3B6E8C','trait_ribbon_window'),(3633,'#3B6E8C','trait_corner_glass'),(3634,'#3B6E8C','trait_curtain_wall'),(3635,'#3B6E8C','trait_sawtooth'),(3636,'#3B6E8C','trait_brise_soleil'),(3637,'#3B6E8C','trait_porthole'),(3360,'#6E6A65','trait_exposed_concrete'),(3653,'#6E6A65','trait_formwork'),(3638,'#8A7E72','trait_white_plaster'),(3639,'#8A5A44','trait_rusticated_stone'),(3640,'#8C6239','trait_timber_frame'),(3641,'#5D6B75','trait_metal_cladding'),(3642,'#964B38','trait_brickwork'),(3643,'#A9381F','trait_supergraphics'),(3644,'#8E3B46','trait_epigraphy'),(3645,'#8E3B46','trait_classical_order'),(3646,'#993B3B','trait_soviet_heraldry'),(3647,'#8E4452','trait_folk_ornament'),(3648,'#8B4268','trait_ironic_quote'),(3649,'#94483E','trait_mosaic_frieze');

-- 1. Параметры понятия.
insert into app.parameters (code, title_ru, value_type, sort_order, is_published, definition, created_by)
values
  ('concept_color','Цвет понятия','text',2,true,'HEX-цвет понятия из реестра «Классификация — цвета и пиктограммы» (Д1).','2b867aed-f62a-44e4-be3f-2363bf70c975'),
  ('concept_icon','Знак понятия','text',3,true,'Ключ знака из набора «Вх² Чертёжный алфавит» (Д1, Р9).','2b867aed-f62a-44e4-be3f-2363bf70c975')
on conflict (code) do update
  set title_ru = excluded.title_ru, definition = excluded.definition,
      is_published = true, updated_by = excluded.created_by, updated_at = now();

-- 2. Пункты набора ветви architecture_classification («Понятие классификации»).
insert into app.parameter_set_items (set_id, parameter_id, sort_order, hint, input_kind)
select s.id, p.id, p.sort_order,
       case p.code when 'concept_color' then 'HEX-цвет, например #2F5D8A'
                   else 'Ключ знака, например epoch_modernism' end,
       'text'
  from app.parameter_sets s
  join app.parameters p on p.code in ('concept_color','concept_icon')
 where s.code = 'classification_names'
on conflict (set_id, parameter_id) do update
  set sort_order = excluded.sort_order, hint = excluded.hint;

-- 3. Значения по реестру: показатель понятия и два текстовых значения.
with target as (
  select r.uid, r.hex, r.icon,
         (select i.id from app.indicators i where i.entity_id = r.uid
           order by i.is_current desc, i.sort_order, i.id limit 1) as indicator_id
    from tmp_concept_registry r
), flat as (
  select indicator_id, 'concept_color'::text as code, hex as value from target
  union all
  select indicator_id, 'concept_icon'::text, icon from target
)
insert into app.indicator_values (indicator_id, parameter_id, text_value)
select f.indicator_id, p.id, f.value
  from flat f
  join app.parameters p on p.code = f.code
 where f.indicator_id is not null
   and not exists (select 1 from app.indicator_values v
                    where v.indicator_id = f.indicator_id and v.parameter_id = p.id);

-- 4. Новая версия каждого понятия: снимок собирает база из рабочей копии.
insert into app.revisions (material_id, base_revision_id, edited_by, operation, summary, snapshot)
select m.id, e.working_revision_id, '2b867aed-f62a-44e4-be3f-2363bf70c975', 'edit',
       'Цвет и знак понятия по реестру (миграция 0085)', '{}'::jsonb
  from app.entities e
  join lateral (select mt.id from app.materials mt
                 where mt.entity_id = e.id and mt.link_id is null
                 order by mt.id limit 1) m on true
 where e.id in (select uid from tmp_concept_registry)
   and exists (select 1 from app.indicators i
                 join app.indicator_values v on v.indicator_id = i.id
                 join app.parameters p on p.id = v.parameter_id
                where i.entity_id = e.id and p.code = 'concept_color');

-- 5. Публикация: читателю видны цвет и знак понятия.
update app.entities e
   set status = 'published', published_revision_id = e.working_revision_id
 where e.id in (select uid from tmp_concept_registry)
   and e.status = 'published'
   and e.published_revision_id is distinct from e.working_revision_id;

-- 6. Журнал рассмотрений: публикация зафиксирована.
insert into app.revision_reviews (revision_id, reviewer_id, decision, note)
select e.published_revision_id, '2b867aed-f62a-44e4-be3f-2363bf70c975', 'published',
       'Цвет и знак понятия по реестру (миграция 0085)'
  from app.entities e
 where e.id in (select uid from tmp_concept_registry)
   and e.published_revision_id = e.working_revision_id
   and not exists (select 1 from app.revision_reviews rr where rr.revision_id = e.published_revision_id);

-- 7. Д4: составной индекс на связи — отбор «понятие + роль».
create index if not exists links_to_role_idx on app.links (to_entity_id, role_id);
comment on index app.links_to_role_idx is 'Д4: отбор понятий по паре «понятие + роль» в подборе близких объектов (замеры Р32).';