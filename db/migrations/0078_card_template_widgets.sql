insert into app.widgets(name, renderer_key) values
  ('Заголовок карточки', 'card_title'),
  ('Листать новости', 'news_navigation'),
  ('Новости за день', 'news_same_day')
on conflict (renderer_key) do nothing;
