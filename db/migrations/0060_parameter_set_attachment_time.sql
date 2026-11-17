-- User-approved attachment chronology. Existing attachment times are unknown.
alter table app.entity_parameter_sets add column attached_at timestamptz;
alter table app.entity_parameter_sets alter column attached_at set default clock_timestamp();
comment on column app.entity_parameter_sets.attached_at is
    'Время прикрепления; NULL у прежних связей, для которых дата не сохранялась.';
