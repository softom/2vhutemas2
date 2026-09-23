-- 0010: откат колонок, добавленных в модель объектов без запроса.
--
-- В миграции 0008 я расширил object_profile и person_profile полями под
-- здание: сохранность, использование, материалы, этажность, высота, площадь,
-- вместимость, охранный статус. Пользователь этого не просил — речь шла
-- о сведениях по медиа. Модель объектов должна оставаться общей: вид
-- «объект» охватывает книгу, фильм, постановку и концепцию, для которых
-- этажность и площадь бессмысленны.
--
-- Данных в этих колонках нет (проверено перед откатом), поэтому удаление
-- ничего не теряет. Сведения о медиа из 0008 сохраняются: они были нужны.
--
-- Предметные характеристики объектов, когда они понадобятся, делаются
-- справочником признаков и значениями, а не колонками под один класс вещей.

alter table app.object_profile
    drop column if exists status_id,
    drop column if exists current_use,
    drop column if exists materials,
    drop column if exists floors,
    drop column if exists area_sq_m,
    drop column if exists height_m,
    drop column if exists capacity,
    drop column if exists heritage_status;

alter table app.person_profile
    drop column if exists known_for,
    drop column if exists country,
    drop column if exists website_url;

drop table if exists app.object_statuses;

-- Колонка address остаётся: она заполнена пользователем и относится
-- к размещению объекта, как город и страна. Её судьба — отдельное решение.
