-- Снятие с публикации — решение, которое остаётся в журнале рассмотрений.
--
-- Решение пользователя 2026-10-04: опубликованную запись или связь можно
-- вернуть в черновик. Версии при этом не трогаются: указатель публикации
-- снимается, а в журнал пишется, кто, когда и какую редакцию снял — так же,
-- как пишется публикация.
alter table app.revision_reviews drop constraint if exists revision_reviews_decision_check;
alter table app.revision_reviews add constraint revision_reviews_decision_check
  check (decision in ('submitted', 'approved', 'rejected', 'published', 'unpublished'));
