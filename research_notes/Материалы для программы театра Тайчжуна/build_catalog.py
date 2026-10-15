"""Build the local Taichung research catalogue from source manifests. No network."""
from pathlib import Path
import collections
import hashlib
import html
import json
import os
import re
import uuid
from urllib.parse import quote, unquote, urlsplit

BASE = Path(__file__).resolve().parent
ROOT = BASE.parent.parent
def read(name):
    return json.loads((BASE / name).read_text(encoding='utf-8-sig'))
def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.replace('\r\n', '\n').encode('utf-8'))
def esc(value):
    return html.escape(str(value if value is not None else ''))
def href(path):
    return quote(os.path.relpath(path, BASE).replace('\\', '/'), safe='/.-')
def number(value):
    return f'{value:,.2f}'.rstrip('0').rstrip('.').replace(',', '\u00a0').replace('.', ',') if isinstance(value, (int, float)) else '—'

technical = read('technical-manifest.json')
architecture = read('architecture-manifest.json')
permits = read('permits-competition-manifest.json')
rooms = read('rooms-technical.json')['rooms']
arch = read('rooms-architecture.json')
sources = {s['uid']: s for s in technical}
archsources = {s['uid']: s for s in arch['sources']}
files, missing, seen, hash_updates = [], [], set(), []
def add(record, path, group, title, source, credit):
    if not path or not path.is_file():
        missing.append({'uid': record.get('uid'), 'title': title, 'url': source, 'status': record.get('status', 'not_local')})
        return
    key = str(path.resolve()).lower()
    if key in seen:
        return
    seen.add(key)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if record.get('sha256') and digest != record['sha256']:
        from PIL import Image
        with Image.open(path) as im:
            im.verify()
        hash_updates.append({'uid': record['uid'], 'local_url': href(path), 'previous_sha256': record['sha256'], 'current_sha256': digest, 'note': 'Image revalidated; source manifest retained, catalogue records current bytes.'})
    files.append({'uid': record['uid'], 'title': title, 'group': group, 'local_url': href(path), 'source_url': source,
                  'credit': credit, 'format': path.suffix.upper().lstrip('.'), 'bytes': path.stat().st_size,
                  'sha256': digest, 'pages': record.get('pages'), 'rights_note': record.get('rights_note', '')})

categories = {'black-box': 'Black Box', 'grand-theatre': 'Grand Theater', 'playhouse': 'Playhouse',
              'public-foyers': 'Холлы и общественные зоны', 'shared-backstage': 'Общие служебные помещения', 'other': 'NPAC — прочее'}
for s in technical:
    add(s, Path(s['local_path']), categories.get(s['category'], s['category']), s['title'], s['original_url'], s['source'])
for s in architecture:
    add(s, ROOT / s['path'] if s.get('path') else None, 'Архитектура и инженерия', s.get('title', s.get('filename', 'Источник')), s.get('source_page', s['url']), s.get('credit', ''))
for s in permits:
    add(s, BASE / s['relative_path'] if s.get('relative_path') else None, 'Конкурс, строительство и площади', s['title'], s['url'], s.get('author', ''))
for p in sorted((ROOT / 'WIKI/assets/taichung-national-theater/plans-metalocus').glob('*.jpg')):
    add({'uid': str(uuid.uuid5(uuid.NAMESPACE_URL, 'taichung-metalocus/' + p.name))}, p, 'Архитектура — проект 2008', p.name,
        'https://www.metalocus.es/en/news/toyo-itos-taichung-metropolitan-opera-house', 'Toyo Ito & Associates / DAJU; Metalocus')
p = ROOT / 'WIKI/assets/taichung-national-theater/press-toto-2014/NR_G_ITO_140822_en.pdf'
if p.exists():
    add({'uid': str(uuid.uuid5(uuid.NAMESPACE_URL, 'taichung-toto-2014'))}, p, 'Архитектура и инженерия', 'TOTO — Toyo Ito, пресс-релиз выставки 2014',
        'https://jp.toto.com/gallerma/ex140919/index_e.htm', 'TOTO GALLERY·MA')

for r in rooms:
    assert r['source_uid'] in sources, r['uid']
for r in arch['rooms']:
    assert r['source_uid'] in archsources, r['uid']
formats = dict(collections.Counter(f['format'] for f in files))
unique_hashes = len(set(f['sha256'] for f in files))
write(BASE / 'catalog-manifest.json', json.dumps({'uid': '6a4b50cf-36c8-4ca9-8851-2c8c9acf903c', 'date': '2026-10-15', 'files': files,
    'not_downloaded': missing, 'hash_updates': hash_updates, 'counts': {'local_files': len(files), 'unique_content': unique_hashes, 'formats': formats}}, ensure_ascii=False, indent=2) + '\n')

CSS = '''*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f5f2eb;color:#252b2a;font:16px/1.55 system-ui,Segoe UI,sans-serif}main{max-width:1380px;margin:auto;padding:35px 38px 80px}header{border-top:7px solid #1b655f;padding:20px 0 30px}h1{font-size:clamp(30px,4vw,52px);line-height:1.1;max-width:1000px;margin:14px 0 20px}h2{font-size:28px;margin-top:36px}h3{font-size:20px}a{color:#12645f;text-underline-offset:3px}nav{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}nav a,.button{display:inline-block;padding:8px 14px;border:1px solid #92afa5;border-radius:7px;text-decoration:none;background:#fff}p{max-width:1050px}.eyebrow{letter-spacing:.15em;text-transform:uppercase;font-size:12px;color:#52736b}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:15px}.card{background:#fff;padding:22px;border:1px solid #ddd7c9;border-radius:10px}.metric{font-size:30px;font-weight:650;line-height:1.2}.small,small{font-size:13px;color:#626b67}.notice{background:#fff2d7;border-left:4px solid #b88727;padding:16px 20px;margin:24px 0}.tools{position:sticky;top:0;background:#f5f2ebed;backdrop-filter:blur(8px);padding:12px 0;z-index:3;display:flex;gap:12px;flex-wrap:wrap}input,select{font:inherit;padding:10px;border:1px solid #aeb8ae;border-radius:6px;background:#fff}input{flex:1;min-width:200px}.scroll{overflow:auto;background:#fff;border:1px solid #ddd7c9;border-radius:8px}table{width:100%;border-collapse:collapse;font-size:14px}th{text-align:left;background:#e7eee8;font-size:12px;text-transform:uppercase;letter-spacing:.03em}td,th{padding:12px 14px;vertical-align:top;border-bottom:1px solid #e5e5df}td.num{white-space:nowrap;font-size:18px;font-weight:600}tr:last-child td{border-bottom:0}tr:hover{background:#f7faf7}td:first-child{min-width:250px}td.notes{min-width:260px;max-width:460px}.badge{display:inline-block;font-size:11px;color:#526b60;background:#eaf0e9;border-radius:4px;padding:3px 6px;margin:4px 4px 4px 0}.floor-map{max-height:270px;max-width:100%;object-fit:contain;background:white}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:18px}.gallery img{width:100%;height:205px;object-fit:contain;background:#fff}.gallery figure{margin:0;padding:14px;background:#fff;border:1px solid #ddd7c9;border-radius:8px}figcaption{font-size:13px;margin-top:8px}details{margin:18px 0}summary{cursor:pointer;font-weight:600;padding:12px;background:#e7eee8;border-radius:6px}.floor{scroll-margin-top:90px;margin-top:38px}.count{align-self:center;color:#526b60}footer{margin-top:35px;border-top:1px solid #bbb;padding-top:15px;font-size:13px;color:#626b67}@media(max-width:700px){main{padding:20px 16px}h1{font-size:34px}td,th{padding:10px}.tools{position:static}.card{padding:16px}}@media print{.tools,nav,button{display:none}main{padding:0}body{background:white}details>*{display:block!important}.scroll{overflow:visible}tr{break-inside:avoid}a{color:inherit}}'''
NAV = '<nav><a href="explication.html">Экспликация по этажам</a><a href="index.html">Все материалы</a><a href="../../reports/' + quote('Материалы для программы театра Тайчжуна.md') + '">Исследование</a></nav>'
NAV += '<nav><a href="riders-full-2026-10-15/index.html">Полный комплект райдеров — 141 файл</a><a href="NTT-technical-riders-full-2026-10-15.zip">Скачать весь комплект ZIP</a></nav>'
def page(title, body, script=''):
    return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title><style>' + CSS + '</style></head><body><main><header><div class="eyebrow">Toyo Ito + DAJU · National Taichung Theater · 2005–2016</div><h1>' + esc(title) + '</h1>' + NAV + '</header>' + body + '<footer>Сбор и проверка: 14–15 октября 2026. Локальная исследовательская подборка. Авторство и источники сохранены. Наличие файла не означает свободную лицензию. DWG проверены по сигнатурам; геометрия в CAD не проверена.</footer></main><script>' + script + '</script></body></html>'

body = f'<p>Чертежи, технические паспорта, планы этажей, разрезы, схемы, строительные публикации и конкурсные сведения для составления площадной программы.</p><div class="cards"><div class="card"><div class="metric">{len(files)}</div>локальных файлов <small>({unique_hashes} уникальных по содержимому)</small></div><div class="card"><div class="metric">125</div>официальных файлов NPAC</div><div class="card"><div class="metric">462</div>страницы в технических PDF NPAC</div><div class="card"><div class="metric">104</div>позиции технической экспликации</div></div>'
body += '<p class="small">В число файлов входят PDF, DWG, ZIP, изображения и сохранённые HTML-публикации. Фотографии строительства и схемы не названы архитектурными чертежами. Производные тексты и контрольные превью в этот счёт не включены.</p>'
body += '<h2>С чего начать</h2><div class="cards"><div class="card"><h3>Площадная программа</h3><p><a href="explication.html">Восемь уровней, площади, гримёрные, мастерские и фойе</a>. У каждого значения указан источник и характер площади.</p></div><div class="card"><h3>Оригиналы NPAC</h3><p>Выберите Grand Theater, Playhouse, Black Box или общественные зоны. В подборке есть планы, разрезы, оборудование, гримёрные и общие служебные помещения.</p></div><div class="card"><h3>Общие чертежи</h3><p>Architectural Record, Metalocus и JARA: планы этажей и разрезы. Инженерные материалы: Arup, IStructE, NTU и 地工技術.</p></div></div>'
body += '<div class="notice">Полное конкурсное ТЗ, комплект утверждённых пожарных планов, копия разрешения на эксплуатацию и полная поэтажная ведомость площадей не получены. Найдены конкурсные сведения и официальное подтверждение выдачи разрешения 30.10.2014. В JARA PDF стоит SAMPLE и указано ограничение использования вне конкурса.</div>'
body += '<h2>Планы и разрезы: быстрый просмотр</h2><div class="gallery">'
preview = [f for f in files if 'NPAC-floor-guide' in f['title'] or f['title'].startswith('Record-drawing') or f['title'] in ('01_section-carousel.jpg', '02_basement-2.jpg', '07_basement-1.jpg', '53_ground-floor.jpg', '54_sixth-floor.jpg')]
for f in preview:
    body += f'<figure><a href="{f["local_url"]}"><img loading="lazy" src="{f["local_url"]}" alt="{esc(f["title"])}"></a><figcaption>{esc(f["title"])}<br>{esc(f["credit"])} · <a href="{esc(f["source_url"])}">Источник</a></figcaption></figure>'
body += '</div><h2>Каталог файлов</h2><div class="tools"><input id="search" type="search" placeholder="Поиск: сцена, section, dressing, foyer, B2…" aria-label="Поиск по каталогу"><select id="group" aria-label="Раздел"><option value="">Все разделы</option>'
for group in sorted(set(f['group'] for f in files)):
    body += '<option>' + esc(group) + '</option>'
body += '</select><select id="format" aria-label="Формат"><option value="">Все форматы</option>' + ''.join('<option>' + esc(f) + '</option>' for f in sorted(formats)) + '</select><span class="count" id="count"></span></div><div class="scroll"><table><thead><tr><th>Файл</th><th>Раздел</th><th>Формат</th><th>Источник и авторство</th></tr></thead><tbody id="catalog">'
for f in files:
    body += f'<tr data-group="{esc(f["group"])}" data-format="{esc(f["format"])}"><td><a href="{f["local_url"]}">{esc(f["title"])}</a></td><td>{esc(f["group"])}</td><td>{esc(f["format"])}<br><small>{number(f["bytes"]/1048576)} МБ</small></td><td>{esc(f["credit"])}<br><a href="{esc(f["source_url"])}">Оригинальный источник</a>' + ('<br><small>' + esc(f['rights_note']) + '</small>' if f['rights_note'] else '') + '</td></tr>'
body += '</tbody></table></div><details><summary>Недоступные или не скачанные источники</summary><ul>'
for s in missing:
    body += f'<li><a href="{esc(s["url"])}">{esc(s["title"])}</a> — {esc(s["status"])}</li>'
body += '</ul></details><p><a href="catalog-manifest.json">Реестр файлов с UUID и SHA-256</a> · <a href="technical.md">Технические заметки</a> · <a href="architecture.md">Архитектурные заметки</a> · <a href="permits-competition.md">Конкурс и площади</a></p>'
js = '''const search=document.querySelector('#search'),group=document.querySelector('#group'),format=document.querySelector('#format'),rows=[...document.querySelectorAll('#catalog tr')];function filter(){let n=0;for(const row of rows){const show=row.textContent.toLowerCase().includes(search.value.toLowerCase())&&(!group.value||row.dataset.group===group.value)&&(!format.value||row.dataset.format===format.value);row.hidden=!show;n+=show;}document.querySelector('#count').textContent=n+' / '+rows.length;}[search,group,format].forEach(x=>x.addEventListener('input',filter));filter();'''
write(BASE / 'index.html', page('Театр Тайчжуна — все материалы', body, js))

statuses = {'not_published':'Площадь не опубликована', 'published':'Площадь из источника', 'published_rental_zone':'Выделенная арендная зона', 'calculated_dimensions':'Расчёт по габаритам', 'published_scope_unclear':'Границы площади неясны', 'published_approximate':'Приблизительная площадь из источника'}
def roomrow(r):
    s=sources[r['source_uid']]
    link=href(Path(s['local_path']))
    if r.get('source_page_1_based'):
        link += '#page=' + str(r['source_page_1_based'])
    detail=r.get('notes','')
    if r.get('dimensions_m'):
        detail += ' Габариты: ' + ' × '.join(number(x) for x in r['dimensions_m']) + ' м.'
    if r.get('capacity_persons') is not None:
        detail += ' Вместимость: ' + str(r['capacity_persons']) + '.'
    return f'<tr id="{r["uid"]}"><td>{esc(r["name_ru"])}<br><small>{esc(r["floor"])}</small></td><td class="num">{number(r.get("area_m2"))}</td><td><span class="badge">{statuses.get(r["area_status"],esc(r["area_status"]))}</span></td><td class="notes">{esc(detail)}</td><td><a href="{link}">Документ, стр. {esc(r.get("source_page_1_based","—"))}</a><br><small>{esc(r["source_title"])}</small></td></tr>'
def table(rr):
    return '<div class="scroll"><table><thead><tr><th>Помещение / зона</th><th>м²</th><th>Статус</th><th>Примечание</th><th>Основание</th></tr></thead><tbody>' + ''.join(roomrow(r) for r in rr) + '</tbody></table></div>'
body = '<p>Рабочая экспликация для составления программы: <b>104 технические позиции, 26 строк с числовой площадью</b>. Дополнительно — функции по архитектурным планам и официальному путеводителю. Это помещения, части помещений, наружные и подвижные зоны; строки не образуют полный баланс здания.</p>'
body += '<div class="cards"><div class="card"><div class="metric">51 152,19 м²</div>общая площадь, карточка Toyo Ito<br><a href="https://www.toyo-ito.co.jp/WWW/Project_Descript/2015-/2015-p_04/2015-p_04_j.html">Авторский источник</a></div><div class="card"><div class="metric">51 166 м²</div>общая площадь, DAJU + Ito, 2017<br><a href="https://www.twarchitect.org.tw/works/臺中國家歌劇院/">Публикация архитекторов</a></div><div class="card"><div class="metric">57 020,46 м²</div>участок, Toyo Ito / город<br><a href="https://www.taichung.gov.tw/8868/8872/9962/956075">Муниципальный источник</a></div><div class="card"><div class="metric">B2 + 6 этажей</div>два подземных и шесть надземных уровней</div></div>'
body += '<div class="notice">Расхождение общей площади двух авторских источников — 13,81 м²; причина не установлена. Общая площадь каждого этажа и площади большинства служебных комнат не опубликованы. Знак «—» означает отсутствие данных, а не нулевую площадь. Арендные участки, общий контур TuTu, открытая кровля и подвижные платформы не суммируются в площадь здания.</div>'
body += '<nav>' + ''.join(f'<a href="#floor-{f}">{f}</a>' for f in ['B2','B1','1F','2F','3F','4F','5F','6F']) + '<a href="#multi">Межэтажные зоны</a><a href="#areas">Все известные площади</a></nav><p>GT — Grand Theater; PH — Playhouse; BB — Black Box. В таблицах ссылки ведут на исходные PDF и нужные страницы. <a href="rooms-technical.json">Скачать техническую экспликацию JSON</a> · <a href="rooms-architecture.json">Архитектурные функции JSON</a>.</p>'
floors=['B2','B1','1F','2F','3F','4F','5F','6F']
for floor in floors:
    body += f'<section class="floor" id="floor-{floor}"><h2>{floor} <small>Общая площадь уровня: не установлена</small></h2>'
    m = BASE / f'files/architecture/NPAC-floor-guide-{floor}.png'
    if m.exists():
        body += f'<a href="{href(m)}"><img class="floor-map" loading="lazy" src="{href(m)}" alt="Карта этажа {floor}"></a><p class="small">Официальная схема для посетителей NPAC — <a href="https://www.npac-ntt.org/en/blog/c-zLZ2eQl09ki">источник</a>. Открыть изображение для увеличения.</p>'
    else:
        body += '<p class="small">В публичном путеводителе NPAC нет отдельной карты этого этажа. Использованы технические планы гримёрных; общие проектные листы доступны в <a href="index.html">каталоге</a>.</p>'
    rr=[r for r in rooms if r['floor']==floor or (floor=='1F' and r['floor']=='1F / наружная')]
    if rr:
        body += table(rr)
    aa=[r for r in arch['rooms'] if r['floor']==floor]
    body += '<details open><summary>Функции по архитектурным источникам — дополнение, возможны повторы таблицы</summary><ul>'
    for r in aa:
        s=archsources[r['source_uid']]
        link=href((BASE/s['local_path']).resolve()) if s.get('local_path') else s['url']
        body += f'<li>{esc(r["function_ru"])}. <small>{esc(r.get("note",""))} <a href="{esc(link)}">{esc(s["title"])}</a> · {esc(s["stage"])}</small></li>'
    body += '</ul></details></section>'
multi=[r for r in rooms if r['floor'] not in floors and r['floor']!='1F / наружная']
body += '<section id="multi" class="floor"><h2>Межэтажные, подвижные и прочие зоны</h2><p>Объёмы зрительных залов и подвижные платформы показаны отдельно, чтобы не присвоить их полную площадь нескольким этажам.</p>' + table(multi) + '</section>'
body += '<section id="areas" class="floor"><h2>Все известные площади</h2><p>26 строк для быстрого сопоставления. Общий итог намеренно отсутствует: области пересекаются и имеют разный характер.</p>' + table([r for r in rooms if r.get('area_m2') is not None]) + '</section>'
body += '<h2>Что ещё нужно для полного баланса</h2><p>Обмер DWG с проверкой единиц и границ, экспликация к разрешению на эксплуатацию и площади помещений по всем этажам. В имеющихся материалах площади сцен и репетиционных пригодны как отдельные аналоги; распределять остаток общей площади между этажами без основания нельзя.</p>'
write(BASE/'explication.html',page('Театр Тайчжуна — экспликация по этажам',body))

# Check all local links generated above; external URLs are already recorded in source manifests.
broken=[]
for name in ('index.html','explication.html'):
    content=(BASE/name).read_text(encoding='utf-8')
    for u in re.findall(r'(?:href|src)="([^"]+)"',content):
        if not u or u.startswith(('#','https:','http:')):
            continue
        target=BASE/unquote(html.unescape(u).split('#')[0])
        if not target.exists():
            broken.append(str(target))
print(json.dumps({'files':len(files),'unique_content':unique_hashes,'formats':formats,'technical_rooms':len(rooms),
                  'numeric_area_rows':sum(r.get('area_m2') is not None for r in rooms),'architecture_rows':len(arch['rooms']),
                  'missing_local_links':sorted(set(broken))},ensure_ascii=False,indent=2))
