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

GEO = 'Кривые считаются по формулам прямо в браузере при каждом движении точки — ничего не нарисовано заранее.'

MODELS = [
    dict(slug='arch', group='build', src='physics/arch-rapier.html', title='Арка из семи камней',
         desc='Интерактивная модель: почему стоит арка из камней без раствора. Линия давления, шарниры и теорема о безопасности; камни можно двигать и спасать арку.',
         lead='Арка стоит, пока внутри кладки можно провести линию давления. Меняйте толщину, раздвигайте опоры, кладите груз — и смотрите, где появляются шарниры.',
         how=['Тяните камень мышью или пальцем: он висит на резинке, у своего гнезда его подхватывает магнит.',
              'Тонкая арка падает: при толщине меньше примерно 0,107 радиуса линия давления не помещается в кладку.',
              '«Кружало» — временная опора, на которой арку строят. Уберите его и проверьте, устоит ли арка сама.',
              'Включите замедление, чтобы успеть вернуть камни в гнёзда во время обрушения.']),
    dict(slug='cologne', group='build', src='physics/cologne-flying-buttresses.html', title='Кёльнский собор: путь распора',
         desc='Интерактивный разрез готического собора: распор стрельчатого свода уходит через аркбутаны в контрфорсы. Уберите аркбутаны или пинакли и посмотрите, что будет.',
         lead='Стрельчатый свод распирает стены. В Кёльне распор уходит через два пролёта аркбутанов на промежуточную опору и дальше во внешний контрфорс, а пинакли пригружают опоры сверху.',
         how=['Снимите галку «Аркбутаны»: стены не удержат распор, и свод упадёт.',
              'Сужайте контрфорс: около 2,4 м собор держится только с пинаклями.',
              'Любой камень можно потянуть мышью и вернуть на место.',
              'Разрез схематичный: своды боковых нефов и кровля не показаны. Вес каждого элемента взят на один пролёт 7,5 м — свод на всю глубину, стена как столбы между окнами.']),
    dict(slug='catalan', group='build', src='physics/catalan-vault-shape.html', title='Каталонский свод: сила формы',
         desc='Два одинаково тонких свода — по цепной линии и по полуокружности. Интерактивная модель показывает, почему каталонский свод держится формой, а не толщиной.',
         lead='Каталонский свод кладут из тонкой плитки в два-три слоя. Держит его не толщина, а форма: если свод повторяет линию давления, ему почти не нужна толщина.',
         how=['Цепная линия стоит даже при толщине 4 см; полуокружности того же пролёта нужно около 32 см.',
              'Положите груз: форма цепи совпадает только с собственным весом свода, и тонкий сухой свод падает от 5 % дополнительной нагрузки.',
              'Швы в модели сухие. Настоящий каталонский свод скрепляет быстрый гипс, а второй слой плитки кладут со смещением швов — это следующий шаг игры.']),
    dict(slug='chain', group='curves', src='curves/chain.html', title='Цепь и перевёрнутая арка',
         desc='Висящая цепь на физическом движке ложится на цепную линию, а не на параболу, как думал Галилей. Переверните её — получится арка, которая стоит без изгиба.',
         lead='Цепь работает только на растяжение и сама находит форму без изгиба — цепную линию. Переверните эту форму, и растяжение станет сжатием: так Гауди искал форму арок по висячим моделям.',
         how=['Галилей в «Беседах» (1638) считал, что цепь висит по параболе. Юнгиус опроверг это в 1669 году, а точную форму — цепную линию y = a·ch(x/a) — нашли Лейбниц, Гюйгенс и Иоганн Бернулли в 1691-м. Сравните: цепь ложится на цепную линию, а от параболы Галилея расходится тем сильнее, чем больше провис.',
              'Тяните опоры и меняйте длину цепи: при почти натянутой цепи обе кривые почти совпадают — поэтому ошибку было трудно заметить.',
              '«Перевернуть» строит по форме цепи арку из камней, «Полуокружность» — полукруглую арку того же пролёта и толщины. При 15 см арка по цепи стоит, полуокружности нужно около 47 см.',
              'Подвесьте груз и переверните цепь: арка повторит новую форму и удержит этот груз. Полуокружность с тем же грузом падает.'],
         note='Цепь и камни — физический движок Rapier. Натяжение считается из равновесия каждого звена по форме, которую дала физика: силы в суставах движок не сообщает. Арка собрана из 20 камней, цепь — из 40 звеньев, поэтому с грузом арке нужна толщина около 15 см: излом под грузом попадает внутрь камня. Модель показывает принцип, а не выполняет инженерный расчёт.'),
    dict(slug='hogarth', group='curves', src='curves/hogarth.html', title='Линия красоты Хогарта',
         desc='Семь S-линий от почти прямой до перегнутой и график их кривизны: можно ли измерить «слишком прямое» и «слишком изогнутое».',
         lead='В «Анализе красоты» (1753) Уильям Хогарт нарисовал семь волнистых линий и назвал четвёртую линией красоты: первые слишком прямы, последние слишком изогнуты. Здесь линии построены заново, изгиб задаёт угол, на который линия отклоняется от прямой.',
         how=['Двигайте изгиб или нажмите на одну из семи линий.',
              'График показывает кривизну вдоль линии: она меняется плавно и дважды проходит через ноль — так получается S.',
              '«Сравнить с ломаной»: у ломаной кривизна на отрезках равна нулю, а в вершинах скачет — глаз видит излом.'],
         note='Линии построены по формуле угла касательной θ(s) = b·sin 2πs, а не скопированы с гравюры Хогарта; соответствие номеров приближённое. ' + GEO),
    dict(slug='casteljau', group='curves', src='curves/casteljau.html', title='Алгоритм де Кастельжо',
         desc='Как три-пять точек задают гладкую кривую: вложенные отрезки де Кастельжо строят кривую Безье. Двигайте точки и параметр t.',
         lead='В 1959 году Поль де Кастельжо нашёл в Citroën способ строить гладкие линии кузова по нескольким точкам; метод держали в секрете. Точки делят отрезки ломаной в отношении t, по ним строятся новые отрезки — и так до одной точки. Её след и есть кривая.',
         how=['Нажмите «Проиграть»: точка пройдёт от t = 0 до 1 и оставит за собой кривую.',
              'Тяните контрольные точки: кривая начинается в P0 и кончается в последней точке, но через средние не проходит.',
              'Ту же кривую независимо описал Пьер Безье в Renault (1962) — она в следующей модели.'],
         note=GEO),
    dict(slug='nurbs', group='curves', src='curves/nurbs.html', title='От прямой к NURBS',
         desc='Одна ломаная — пять способов провести по ней линию: прямая и дуга по методу наименьших квадратов, кривая Безье, B-сплайн и NURBS.',
         lead='История проектной линии в одном окне. Прямая и дуга подбираются к точкам методом наименьших квадратов, Безье сглаживает все точки сразу, B-сплайн правится по частям, NURBS добавляет точкам вес и рисует точную окружность.',
         how=['Переключайте режимы и тяните одну точку: оранжевым подсвечено, какая часть линии изменилась. У прямой, дуги и Безье меняется вся линия, у B-сплайна — только участок рядом.',
              'Степень B-сплайна 2 или 3: чем выше степень, тем дальше доходит влияние точки.',
              'В режиме NURBS выберите точку и меняйте её вес: большой вес притягивает кривую.',
              '«Окружность»: квадратичный NURBS с весами √2/2 даёт точную окружность; Безье и B-сплайн по тем же точкам — нет.',
              'B-сплайны развил Карл де Бур в 1970-х, NURBS — 1970–80-е годы; сегодня это основа Rhino и параметрической архитектуры.'],
         note=GEO),
    dict(slug='grid', group='curves', src='curves/grid.html', title='Прямая и поле',
         desc='Прямоугольная сетка модернизма и притягивающие точки параметрицизма: поле искривляет кварталы и меняет их высоту, при нулевой силе сетка снова прямая.',
         lead='Ле Корбюзье: «прямая — путь людей». Параметрицизм Патрика Шумахера (Kartal Masterplan, Стамбул) оставляет ту же регулярную сетку, но управляет ею полем: улицы изгибаются к притягивающим точкам, кварталы растут.',
         how=['Тяните синие точки, добавляйте новые кнопкой «Точка».',
              'Сила 0: сетка прямая, все кварталы одной высоты — прямая остаётся частным случаем поля.',
              'Снимите галку «Объём», чтобы увидеть план.'],
         note='Поле — сумма гауссовых притяжений, высота квартала растёт у точек. Это иллюстрация принципа, а не модель Kartal. ' + GEO),
]
GROUPS = [('build', 'Конструкции', 'Почему стоят арки, своды и соборы. Камни можно тянуть, убирать опоры и смотреть, куда уходит линия давления.'),
          ('curves', 'Кривые — к лекции «О красоте»', 'От цепной линии и линии Хогарта до кривых Безье, NURBS и параметрической сетки.')]

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
    src = (ROOT / 'prototypes' / m['src']).read_text(encoding='utf-8')
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
    <p class="note">{html.escape(m.get('note', DISCLAIMER))}</p>'''
    (OUT / f'{m["slug"]}.html').write_text(
        page(m['title'], m['desc'], url, [('2ВХУТЕМАС', SITE + '/'), ('Модели', INDEX_URL), (m['title'], url)], body),
        encoding='utf-8', newline='\n')

def card(m):
    return f'      <a class="card" href="/models/{m["slug"]}.html"><b>{html.escape(m["title"])}</b><span>{html.escape(m["desc"])}</span></a>'

sections = []
for g, t, d in GROUPS:
    cards = '\n'.join(card(m) for m in MODELS if m['group'] == g)
    sections.append(f'    <h2>{html.escape(t)}</h2>\n    <p class="lead">{html.escape(d)}</p>\n    <div class="cards">\n{cards}\n    </div>')
idx_desc = 'Интерактивные модели 2ВХУТЕМАС: арка, готический собор, каталонский свод, цепная линия, линия Хогарта, кривые Безье и NURBS, параметрическая сетка.'
body = '    <h1>Интерактивные модели</h1>\n' + '\n'.join(sections) + '\n    <p class="note">Модели конструкций работают на физическом движке Rapier, модели кривых считают линии по формулам. Все показывают принцип, а не выполняют инженерный расчёт.</p>'
(OUT / 'index.html').write_text(
    page('Интерактивные модели', idx_desc, INDEX_URL, [('2ВХУТЕМАС', SITE + '/'), ('Модели', INDEX_URL)], body, ld_type='CollectionPage'),
    encoding='utf-8', newline='\n')
print('ok', [p.name for p in OUT.iterdir()])
