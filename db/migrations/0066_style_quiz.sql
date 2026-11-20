insert into app.widgets (name, renderer_key) values ('Угадай стиль', 'style_quiz')
on conflict (renderer_key) do nothing;
