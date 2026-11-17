-- User-approved placement of parameter sets on public cards.
alter table app.parameter_sets add column card_side text not null default 'right'
  check (card_side in ('left', 'right'));
comment on column app.parameter_sets.card_side is 'left: в тексте; right: в колонке атрибутов';
update app.parameter_sets set card_side='left' where code in ('area_program','style_solutions');
