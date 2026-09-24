-- 0020: наборы «Большепролётное покрытие» и «Общественное здание
-- со зрелищной функцией» (состав задан пользователем 2026-09-24).
--
-- Наборы заводятся миграцией, а не руками в интерфейсе: состав из сорока
-- величин должен лежать в истории проекта вместе с определениями и списками
-- значений. Правится он потом обычным окном набора.
--
-- К ветвям дерева наборы здесь не привязываются: «большепролётное покрытие»
-- есть и у вокзала, и у рынка, а «зрелищная функция» — не у всякого здания.
-- Привязка выбирается отдельно: к узлу дерева или к отдельной записи.

-- 1. Величины набора «Большепролётное покрытие»
insert into app.parameters (code, title_ru, value_type, unit, is_repeatable, definition, sort_order)
values
    ('clear_span', 'Свободный пролёт', 'number', 'м', false,
     'Расстояние между опорами в свету. Главная величина типа', 1010),
    ('span_secondary', 'Второй габарит покрытия', 'number', 'м', false,
     'Для эллипсов и прямоугольников', 1020),
    ('plan_shape', 'Форма плана', 'option', null, false, null, 1030),
    ('rise', 'Стрела подъёма', 'number', 'м', false,
     'Вместе с пролётом даёт пологость', 1040),
    ('roof_area', 'Площадь покрытия', 'number', 'м²', false, null, 1050),
    ('structure_thickness', 'Толщина несущей конструкции', 'number', 'мм', false,
     'С пролётом даёт отношение t/L', 1060),
    ('bearing_system', 'Несущая система', 'option', null, true, null, 1070),
    ('dominant_forces', 'Преобладающие усилия', 'option', null, true, null, 1080),
    ('thrust_handling', 'Чем воспринят распор', 'option', null, false, null, 1090),
    ('roof_mass_per_m2', 'Масса покрытия', 'number', 'кг/м²', false, null, 1100),
    ('formwork', 'Опалубка', 'option', null, false, null, 1110),
    ('assembly_method', 'Способ монтажа', 'option', null, false, null, 1120),
    ('element_count', 'Число повторяющихся элементов', 'integer', 'шт.', false, null, 1130),
    ('construction_months', 'Срок строительства', 'integer', 'мес.', false, null, 1140),
    ('robustness', 'Живучесть при отказе элемента', 'option', null, false, null, 1150),
    ('roof_acoustics', 'Акустический риск формы', 'option', null, true, null, 1160),
    ('suspended_load', 'Подвесная технологическая нагрузка', 'number', 'т', false, null, 1170),
    ('status_now', 'Состояние', 'option', null, false, null, 1180),
    ('loss_year', 'Год утраты', 'integer', null, false, null, 1190);

-- 2. Величины набора «Общественное здание со зрелищной функцией»
insert into app.parameters (code, title_ru, value_type, unit, is_repeatable, definition, sort_order)
values
    ('spectacle_type', 'Тип зрелища', 'option', null, true, null, 2010),
    ('programme_mix', 'Состав комплекса', 'option', null, true, null, 2020),
    ('operator_type', 'Заказчик и оператор', 'option', null, false, null, 2030),
    ('year_round', 'Режим работы', 'option', null, false, null, 2040),
    ('daytime_use', 'Работает без события', 'boolean', null, false, null, 2050),
    ('public_space_area', 'Общедоступная часть без билета', 'number', 'м²', false,
     'Своя агора: пространство, куда можно войти без билета', 2060),
    ('hall_relation', 'Отношение зрителя и действия', 'option', null, false, null, 2110),
    ('hall_count', 'Число залов', 'integer', null, false, null, 2120),
    ('hall_capacity', 'Вместимость главного зала', 'integer', 'мест', false, null, 2130),
    ('capacity_total', 'Суммарная вместимость', 'integer', 'мест', false, null, 2140),
    ('seats_accessible', 'Места для маломобильных', 'integer', 'мест', false, null, 2150),
    ('seating_form', 'Форма рассадки', 'option', null, true, null, 2160),
    ('hall_area', 'Площадь зала', 'number', 'м²', false, null, 2170),
    ('hall_volume', 'Объём зала', 'number', 'м³', false, null, 2180),
    ('acoustics_mode', 'Акустический режим', 'option', null, false, null, 2190),
    ('reverberation_time', 'Время реверберации', 'number', 'с', false, null, 2200),
    ('transformable', 'Трансформируемость зала', 'option', null, false, null, 2210);

-- 3. Списки значений
insert into app.parameter_options (parameter_id, code, title_ru, sort_order)
select p.id, x.code, x.title, x.ord
  from (values
    ('plan_shape', 'circle', 'круг', 1),
    ('plan_shape', 'ellipse', 'эллипс', 2),
    ('plan_shape', 'rectangle', 'прямоугольник', 3),
    ('plan_shape', 'free', 'свободная', 4),

    ('bearing_system', 'beam', 'балка', 1),
    ('bearing_system', 'truss', 'ферма', 2),
    ('bearing_system', 'frame', 'рама', 3),
    ('bearing_system', 'arch', 'арка', 4),
    ('bearing_system', 'vault', 'свод', 5),
    ('bearing_system', 'folded', 'складка', 6),
    ('bearing_system', 'shell', 'оболочка', 7),
    ('bearing_system', 'dome', 'купол', 8),
    ('bearing_system', 'gridshell', 'гридшелл', 9),
    ('bearing_system', 'space_frame', 'пространственная сетка', 10),
    ('bearing_system', 'geodesic', 'геодезический купол', 11),
    ('bearing_system', 'cables', 'ванты', 12),
    ('bearing_system', 'cable_net', 'вантовая сеть', 13),
    ('bearing_system', 'membrane', 'мембрана', 14),
    ('bearing_system', 'tent', 'тент', 15),
    ('bearing_system', 'pneumatic', 'пневматическая оболочка', 16),

    ('dominant_forces', 'bending', 'изгиб', 1),
    ('dominant_forces', 'compression', 'сжатие', 2),
    ('dominant_forces', 'tension', 'растяжение', 3),
    ('dominant_forces', 'compression_tension', 'сжатие и растяжение', 4),
    ('dominant_forces', 'air_supported', 'внутреннее давление: воздухоопорная', 5),
    ('dominant_forces', 'inflated_elements', 'внутреннее давление: надувные элементы', 6),

    ('thrust_handling', 'buttress', 'контрфорс', 1),
    ('thrust_handling', 'tie', 'затяжка', 2),
    ('thrust_handling', 'ring', 'опорное кольцо', 3),
    ('thrust_handling', 'ground_anchors', 'анкеры в грунт', 4),
    ('thrust_handling', 'no_thrust', 'распора нет', 5),

    ('formwork', 'cast_in_place', 'монолитная на месте', 1),
    ('formwork', 'reusable', 'многоразовая сборная', 2),
    ('formwork', 'none', 'без опалубки', 3),
    ('formwork', 'tension_or_inflation', 'натяжение или надув', 4),

    ('assembly_method', 'scaffolding', 'на подмостях', 1),
    ('assembly_method', 'ground_lift', 'сборка на земле с подъёмом', 2),
    ('assembly_method', 'inflation', 'надув', 3),
    ('assembly_method', 'cable_tensioning', 'натяжение вант', 4),
    ('assembly_method', 'cantilever', 'навесной', 5),

    ('robustness', 'local', 'локальный отказ', 1),
    ('robustness', 'progressive', 'цепное обрушение', 2),
    ('robustness', 'unknown', 'не установлено', 3),

    ('roof_acoustics', 'concave_focus', 'вогнутая поверхность фокусирует звук', 1),
    ('roof_acoustics', 'rain_noise', 'шум осадков по лёгкой кровле', 2),
    ('roof_acoustics', 'none', 'нет', 3),

    ('status_now', 'exists', 'существует', 1),
    ('status_now', 'rebuilt', 'реконструировано', 2),
    ('status_now', 'lost', 'утрачено', 3),
    ('status_now', 'demolished', 'снесено', 4),

    ('spectacle_type', 'drama', 'драматический театр', 1),
    ('spectacle_type', 'opera_ballet', 'опера и балет', 2),
    ('spectacle_type', 'concert', 'концертный зал', 3),
    ('spectacle_type', 'philharmonic', 'филармония', 4),
    ('spectacle_type', 'cinema', 'кино', 5),
    ('spectacle_type', 'circus', 'цирк', 6),
    ('spectacle_type', 'arena', 'спортивно-зрелищная арена', 7),
    ('spectacle_type', 'immersive', 'иммерсивная площадка', 8),
    ('spectacle_type', 'open_air', 'открытая площадка', 9),
    ('spectacle_type', 'universal', 'универсальный зал', 10),
    ('spectacle_type', 'club', 'клуб', 11),

    ('programme_mix', 'hall', 'зал', 1),
    ('programme_mix', 'second_hall', 'второй малый зал', 2),
    ('programme_mix', 'museum', 'музей', 3),
    ('programme_mix', 'education', 'образование', 4),
    ('programme_mix', 'rehearsal', 'репетиционная база', 5),
    ('programme_mix', 'food', 'кафе и ресторан', 6),
    ('programme_mix', 'hotel', 'гостиница', 7),
    ('programme_mix', 'retail', 'магазин', 8),
    ('programme_mix', 'offices', 'офисы', 9),

    ('operator_type', 'state', 'государственный', 1),
    ('operator_type', 'municipal', 'муниципальный', 2),
    ('operator_type', 'private', 'частный', 3),
    ('operator_type', 'community', 'сообщество', 4),
    ('operator_type', 'mixed', 'смешанный', 5),

    ('year_round', 'all_year', 'круглогодично', 1),
    ('year_round', 'seasonal', 'сезонно', 2),
    ('year_round', 'retractable_roof', 'трансформируемая кровля', 3),

    ('hall_relation', 'frontal_stage', 'фронтальная эстрада', 1),
    ('hall_relation', 'proscenium', 'глубинная портальная', 2),
    ('hall_relation', 'thrust', 'трёхсторонняя', 3),
    ('hall_relation', 'arena', 'арена или манеж', 4),
    ('hall_relation', 'panoramic', 'панорамная и кольцевая', 5),
    ('hall_relation', 'distributed', 'распределённая', 6),

    ('seating_form', 'stalls', 'партер', 1),
    ('seating_form', 'amphitheatre', 'амфитеатр', 2),
    ('seating_form', 'balcony', 'балкон', 3),
    ('seating_form', 'tiers', 'ярусы', 4),
    ('seating_form', 'boxes', 'ложи', 5),
    ('seating_form', 'gallery', 'галерея', 6),
    ('seating_form', 'standing', 'стоячий партер', 7),

    ('acoustics_mode', 'speech', 'речь', 1),
    ('acoustics_mode', 'natural_music', 'музыка с естественной акустикой', 2),
    ('acoustics_mode', 'amplified_music', 'музыка с электроакустикой', 3),
    ('acoustics_mode', 'universal', 'универсальный', 4),

    ('transformable', 'fixed', 'стационарный', 1),
    ('transformable', 'partial', 'отдельные подвижные элементы', 2),
    ('transformable', 'transformable', 'трансформируемый', 3)
  ) as x(parameter, code, title, ord)
  join app.parameters p on p.code = x.parameter;

-- 4. Сами наборы
insert into app.parameter_sets (code, title_ru, note, sort_order)
values
    ('large_span_roof', 'Большепролётное покрытие',
     'Конструкция, перекрывающая пространство без промежуточных опор. Учётная величина — свободный пролёт, расстояние между опорами в свету',
     100),
    ('spectacle_building', 'Общественное здание со зрелищной функцией',
     'Функция и заказ, затем зал: отношение зрителя к действию, вместимость, акустика',
     110);

insert into app.parameter_set_items (set_id, parameter_id, sort_order, hint)
select s.id, p.id, p.sort_order,
       case when p.code = 'clear_span' then 'Главная величина набора: по ней сравнивают'
            when p.code = 'hall_capacity' then 'Главный зал, без приставных мест'
       end
  from app.parameter_sets s
  join app.parameters p
    on (s.code = 'large_span_roof' and p.sort_order between 1000 and 1999)
    or (s.code = 'spectacle_building' and p.sort_order between 2000 and 2999);
