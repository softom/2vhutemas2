-- Approved by user 2026-11-11: separate prepared entity card.
alter table app.entity_intake add column sketch jsonb;
alter table app.entity_intake add constraint entity_intake_sketch_object check(sketch is null or jsonb_typeof(sketch)='object');
