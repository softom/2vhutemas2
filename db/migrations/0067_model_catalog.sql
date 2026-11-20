insert into app.widgets (renderer_key, name) values
  ('model_proportion', 'Пропорция: часть и целое'),
  ('model_hogarth', 'Линия красоты Хогарта'),
  ('model_chain', 'Цепь и перевёрнутая арка'),
  ('model_arch', 'Арка из семи камней'),
  ('model_catalan', 'Каталонский свод'),
  ('model_grid', 'Прямая и поле'),
  ('model_casteljau', 'Алгоритм де Кастельжо'),
  ('model_nurbs', 'От прямой к NURBS'),
  ('model_zones', 'Профили площадей'),
  ('model_cologne', 'Кёльнский собор')
on conflict (renderer_key) do nothing;
