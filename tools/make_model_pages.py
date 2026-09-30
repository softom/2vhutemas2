"""Страницы моделей конструкций для сайта (Р-80).

Собирает web/public/models/*.html из прототипов prototypes/physics/*.html:
виджет берётся из прототипа, счётчик Метрики и значок — из web/index.html.
Запуск: python tools/make_model_pages.py
"""
import json, re, html, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'web/public/models'
OUT.mkdir(parents=True, exist_ok=True)
SITE = 'https://2vhutemas.ru'

tpl = (ROOT / 'web/index.html').read_text(encoding='utf-8')
metrika_head = tpl[tpl.index('    <!-- Yandex.Metrika counter -->'):tpl.index('    <!-- /Yandex.Metrika counter -->') + len('    <!-- /Yandex.Metrika counter -->')]
metrika_body = re.search(r'    <noscript>.*?</noscript>', tpl, re.S).group(0)
favicon = re.search(r'    <link rel="icon".*?\n    <link rel="apple-touch-icon"[^\n]*', tpl, re.S).group(0)

STYLE = '''
:root{--text-primary:#1f1e1d;--text-secondary:#5f5e5a;--text-success:#3b6d11;--text-danger:#a32d2d;--text-warning:#854f0b;--text-accent:#185fa5;--border:rgba(0,0,0,.15);--bg:#faf9f5;--card:#fff}
@media (prefers-color-scheme:dark){:root{--text-primary:#f1efe8;--text-secondary:#b4b2a9;--text-success:#97c459;--text-danger:#f09595;--text-warning:#fac775;--text-accent:#85b7eb;--border:rgba(255,255,255,.18);--bg:#1f1e1d;--card:#2c2c2a}}
*{box-sizing:border-box}
body{margin:0 auto;padding:16px;max-width:712px;background:var(--bg);color:var(--text-primary);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--text-accent)}
nav.crumbs{font-size:14px;color:var(--text-secondary);margin:0 0 12px}
nav.crumbs a{color:inherit}
h1{font-size:26px;font-weight:500;line-height:1.25;margin:0 0 8px}
h2{font-size:18px;font-weight:500;margin:28px 0 8px}
p.lead{color:var(--text-secondary);margin:0 0 20px}
.note{font-size:14px;color:var(--text-secondary);border-left:3px solid var(--border);padding:4px 0 4px 12px;margin:20px 0}
ul{padding-left:20px}li{margin:4px 0}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
button,select{font:inherit;font-size:14px;padding:4px 10px;border-radius:8px;border:.5px solid var(--border);background:transparent;color:inherit;cursor:pointer}
input[type=range]{accent-color:#D85A30}
footer{margin:40px 0 8px;font-size:13px;color:var(--text-secondary)}
.cards{display:grid;gap:12px}
.card{display:block;background:var(--card);border:.5px solid var(--border);border-radius:12px;padding:14px 16px;text-decoration:none;color:inherit}
.card b{font-weight:500;font-size:17px;color:var(--text-accent)}
.card span{display:block;font-size:14px;color:var(--text-secondary);margin-top:4px}
'''

DISCLAIMER = 'Модель показывает принцип, а не выполняет инженерный расчёт. Силы и линия давления берутся из физического движка Rapier: это импульсы в швах между камнями, а не заранее нарисованная картинка.'

MODELS = [
    dict(slug='arch', src='arch-rapier.html', title='Арка из семи камней',
         desc='Интерактивная модель: почему стоит арка из камней без раствора. Линия давления, шарниры и теорема о безопасности; камни можно двигать и спасать арку.',
         lead='Арка стоит, пока внутри кладки можно провести линию давления. Меняйте толщину, раздвигайте опоры, кладите груз — и смотрите, где появляются шарниры.',
         how=['Тяните камень мышью или пальцем: он висит на резинке, у своего гнезда его подхватывает магнит.',
              'Тонкая арка падает: при толщине меньше примерно 0,107 радиуса линия давления не помещается в кладку.',
              '«Кружало» — временная опора, на которой арку строят. Уберите его и проверьте, устоит ли арка сама.',
              'Включите замедление, чтобы успеть вернуть камни в гнёзда во время обрушения.']),
    dict(slug='cologne', src='cologne-flying-buttresses.html', title='Кёльнский собор: путь распора',
         desc='Интерактивный разрез готического собора: распор стрельчатого свода уходит через аркбутаны в контрфорсы. Уберите аркбутаны или пинакли и посмотрите, что будет.',
         lead='Стрельчатый свод распирает стены. В Кёльне распор уходит через два пролёта аркбутанов на промежуточную опору и дальше во внешний контрфорс, а пинакли пригружают опоры сверху.',
         how=['Снимите галку «Аркбутаны»: стены не удержат распор, и свод упадёт.',
              'Сужайте контрфорс: около 2,4 м собор держится только с пинаклями.',
              'Любой камень можно потянуть мышью и вернуть на место.',
              'Разрез схематичный: своды боковых нефов и кровля не показаны. Вес каждого элемента взят на один пролёт 7,5 м — свод на всю глубину, стена как столбы между окнами.']),
    dict(slug='catalan', src='catalan-vault-shape.html', title='Каталонский свод: сила формы',
         desc='Два одинаково тонких свода — по цепной линии и по полуокружности. Интерактивная модель показывает, почему каталонский свод держится формой, а не толщиной.',
         lead='Каталонский свод кладут из тонкой плитки в два-три слоя. Держит его не толщина, а форма: если свод повторяет линию давления, ему почти не нужна толщина.',
         how=['Цепная линия стоит даже при толщине 4 см; полуокружности того же пролёта нужно около 32 см.',
              'Положите груз: форма цепи совпадает только с собственным весом свода, и тонкий сухой свод падает от 5 % дополнительной нагрузки.',
              'Швы в модели сухие. Настоящий каталонский свод скрепляет быстрый гипс, а второй слой плитки кладут со смещением швов — это следующий шаг игры.']),
]

def page(title, desc, url, crumbs, body, ld_type='LearningResource'):
    full = f'{title} — 2ВХУТЕМАС'
    ld = [{
        '@context': 'https://schema.org', '@type': ld_type, 'name': title, 'description': desc, 'url': url,
        'inLanguage': 'ru', 'isAccessibleForFree': True,
        'publisher': {'@type': 'Organization', 'name': '2ВХУТЕМАС', 'url': SITE + '/'},
    }, {
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        'itemListElement': [{'@type': 'ListItem', 'position': i + 1, 'name': n, 'item': u} for i, (n, u) in enumerate(crumbs)],
    }]
    if ld_type == 'LearningResource':
        ld[0]['learningResourceType'] = 'Интерактивная модель'
    nav = ' / '.join(f'<a href="{u[len(SITE):]}">{html.escape(n)}</a>' for n, u in crumbs[:-1])
    e = html.escape
    return f'''<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{e(full)}</title>
    <meta name="description" content="{e(desc)}" />
    <link rel="canonical" href="{url}" />
    <meta property="og:title" content="{e(full)}" />
    <meta property="og:description" content="{e(desc)}" />
    <meta property="og:locale" content="ru_RU" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="{url}" />
{favicon}
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3/dist/tabler-icons.min.css" />
    <style>{STYLE}</style>
    <script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>
    <!-- Яндекс.Метрика (Р-66) — копия кода из web/index.html; отдельные страницы моделей — исключение из правила «один шаблон» (Р-80). -->
{metrika_head}
  </head>
  <body>
{metrika_body}
    <nav class="crumbs">{nav}</nav>
{body}
    <footer>2ВХУТЕМАС · учебный проект курса «Квантовая архитектура» · <a href="/">каталог</a> · <a href="/models/index.html">все модели</a></footer>
  </body>
</html>
'''

INDEX_URL = SITE + '/models/index.html'
for m in MODELS:
    src = (ROOT / 'prototypes/physics' / m['src']).read_text(encoding='utf-8')
    widget = src[src.index('<h2 class="sr-only">'):src.rindex('</script>') + len('</script>')]
    url = f'{SITE}/models/{m["slug"]}.html'
    how = '\n'.join(f'      <li>{html.escape(x)}</li>' for x in m['how'])
    body = f'''    <h1>{html.escape(m["title"])}</h1>
    <p class="lead">{html.escape(m["lead"])}</p>
{widget}
    <h2>Что попробовать</h2>
    <ul>
{how}
    </ul>
    <p class="note">{html.escape(DISCLAIMER)}</p>'''
    (OUT / f'{m["slug"]}.html').write_text(
        page(m['title'], m['desc'], url, [('2ВХУТЕМАС', SITE + '/'), ('Модели', INDEX_URL), (m['title'], url)], body),
        encoding='utf-8', newline='\n')

cards = '\n'.join(f'      <a class="card" href="/models/{m["slug"]}.html"><b>{html.escape(m["title"])}</b><span>{html.escape(m["desc"])}</span></a>' for m in MODELS)
idx_desc = 'Интерактивные физические модели конструкций: арка из камней, готический собор с аркбутанами, каталонский свод. Двигайте камни и смотрите, как работают силы.'
body = f'''    <h1>Модели конструкций</h1>
    <p class="lead">Почему стоят арки, своды и соборы. Каждая модель — физическая: камни можно тянуть, убирать опоры и смотреть, куда уходит линия давления.</p>
    <div class="cards">
{cards}
    </div>
    <p class="note">{html.escape(DISCLAIMER)}</p>'''
(OUT / 'index.html').write_text(
    page('Модели конструкций', idx_desc, INDEX_URL, [('2ВХУТЕМАС', SITE + '/'), ('Модели', INDEX_URL)], body, ld_type='CollectionPage'),
    encoding='utf-8', newline='\n')
print('ok', [p.name for p in OUT.iterdir()])
