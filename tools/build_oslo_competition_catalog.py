"""Build the local Oslo competition catalogue from verified downloaded files.

Use the bundled Python with PyMuPDF and Pillow. Does not change website content.
"""
from pathlib import Path
import json, html, hashlib, datetime, shutil, math
import fitz
from PIL import Image, ImageOps, ImageDraw

ROOT=Path(r'E:\Dropbox\2VHUTEMAS\ЧТО\ПРОЕКТЫ\Международный архитектурный конкурс на новое здание Норвежской национальной оперы в Бьёрвике, Осло, 1999–2000')
REPO=Path(__file__).resolve().parents[1]
ESC=html.escape
sources=json.loads((ROOT/'sources.json').read_text(encoding='utf-8'))
images=json.loads((ROOT/'image-manifest.json').read_text(encoding='utf-8'))
for row in sources+images:
    p=ROOT/row['path']
    assert p.is_file(),row['path']
    assert hashlib.sha256(p.read_bytes()).hexdigest()==row['sha256'],row['path']

derived=[]
render_jobs=[('documents/parliament-1999/report.pdf',[6],'programme-1999'),
             ('documents/architecture-2000-09/source.pdf',[25],'snohetta-competition-2000'),
             ('entries/perea/source.pdf',[0,1],'perea')]
(ROOT/'previews').mkdir(exist_ok=True)
for rel,pages,key in render_jobs:
    doc=fitz.open(ROOT/rel)
    for n in pages:
        out=f'previews/{key}-p{n+1:03d}.png'
        doc[n].get_pixmap(matrix=fitz.Matrix(1.7,1.7),alpha=False).save(ROOT/out)
        derived.append({'path':out,'source_path':rel,'pdf_page':n+1,'operation':'render; no cropping'})

(ROOT/'extracted-text').mkdir(exist_ok=True)
pdfs=[]
for p in ROOT.rglob('*.pdf'):
    doc=fitz.open(p)
    rel=p.relative_to(ROOT).as_posix()
    out='extracted-text/'+p.parent.name+'-'+p.stem+'.txt'
    (ROOT/out).write_text('\n\n'.join(f'=== PDF page {i+1} ===\n'+page.get_text() for i,page in enumerate(doc)),encoding='utf-8')
    pdfs.append({'path':rel,'pages':len(doc),'extracted_text':out})
    derived.append({'path':out,'source_path':rel,'operation':'PyMuPDF text extraction, all pages'})

programme=[
 ('A','Вестибюли, фойе и зрительные залы',4590),('B1','Главная сцена и сценические пространства',2280),
 ('B2','Дополнительная сцена',290),('C','Репетиционные помещения',2860),('D','Артистические уборные',1480),
 ('E','Раздевалки персонала',400),('F','Бытовые помещения персонала',960),('G','Руководство и администрация',1380),
 ('H','Мастерские',3020),('I','Склады и хранилища',3300),('J','Прочие помещения',700),
 ('K','Сценические технические помещения',160),('L','Балетная школа',480)]
assert sum(x[2] for x in programme)==21900
data={'stage':'Предконкурсная программа, январь 1999; не исполнительная экспликация и не подтверждённое окончательное ТЗ ноября 1999',
      'source_url':'https://www.stortinget.no/globalassets/pdf/innstillinger/stortinget/1998-1999/inns-199899-213.pdf',
      'source_path':'documents/parliament-1999/report.pdf','pdf_page':7,'printed_page':11,'table':'4.1',
      'rows':[dict(code=c,name_ru=n,area_m2=a) for c,n,a in programme],'net_total_m2':21900,'gross_limit_m2':35000,
      'note':'Русские наименования — перевод. Классификация по осям модели не выполнялась; A не разделена оценочно на залы и фойе.'}
(ROOT/'programme-1999.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
style='''body{font:17px/1.55 system-ui,sans-serif;color:#24221e;background:#f7f5ef;max-width:1200px;margin:40px auto;padding:0 24px}h1{font-size:36px;line-height:1.15}h2{margin-top:48px}a{color:#91412c}nav{display:flex;gap:22px;flex-wrap:wrap}.notice{background:#eee6d5;padding:18px 24px;border-left:4px solid #a45a35}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}.grid img{width:100%;height:220px;object-fit:contain;background:white}figure{margin:0}figcaption,small{font-size:13px;color:#676158}table{border-collapse:collapse;width:100%;background:#fff}th,td{text-align:left;border-bottom:1px solid #ddd;padding:9px 12px}td:last-child{text-align:right}.doc{padding:12px 0;border-bottom:1px solid #ddd}.preview{max-width:100%;max-height:900px}footer{margin:48px 0;color:#676158}'''
def head(title): return f'<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{ESC(title)}</title><style>{style}</style><body>'
table='<table><tr><th>Код</th><th>Группа помещений</th><th>м²</th></tr>'+''.join(f'<tr><td>{c}</td><td>{n}</td><td>{a:,}</td></tr>' for c,n,a in programme)+'<tr><th></th><th>Итого полезная площадь</th><th>21 900</th></tr><tr><th></th><th>Рамка общей площади</th><th>35 000</th></tr></table>'
body=head('Осло — площадная программа 1999')+'<p><a href="index.html">← Каталог конкурса</a></p><h1>Площадная программа. Январь 1999</h1><p class="notice">Предконкурсная программа заказчика. Самостоятельный исторический документ; не площади построенного здания и не подтверждённое окончательное конкурсное задание.</p><p>Источник: Innst. S. nr. 213 (1998–99), таблица 4.1, печатная с. 11 / страница PDF 7. Русский перевод названий групп.</p>'+table+'<p><a href="documents/parliament-1999/report.pdf#page=7">Полный официальный PDF — открыть таблицу</a> · <a href="programme-1999.json">Данные JSON</a></p><img class="preview" src="previews/programme-1999-p007.png" alt="Оригинальная таблица площадной программы"><p>Сумма 13 строк проверена: 21 900 м². Мастерские и склады: 6 320 м². Сопоставлять с программами других объектов следует по одной стадии и методике учёта.</p></body></html>'
(ROOT/'programme-1999.html').write_text(body,encoding='utf-8')

parts=[head('Осло 1999–2000 — конкурсные материалы'),'<h1>Опера в Осло<br>Конкурс 1999–2000</h1>',
 '<p>Документы, конкурсные предложения и развитие проекта. Собрано 16 октября 2026. Запись конкурса: UID 2668.</p>',
 '<nav><a href="#documents">Документы</a><a href="programme-1999.html">Площади</a><a href="#entries">Проекты участников</a><a href="#development">Развитие победителя</a><a href="#gaps">Что пока не найдено</a></nav>',
 '<p class="notice">Это подборка доступных публикаций, а не полный архив заявок. Программа января 1999 сохранена в официальном парламентском PDF. Полное окончательное задание конкурса и полный отчёт жюри пока не получены.</p>',
 '<h2 id="documents">Документы</h2><p><a href="programme-1999.html"><strong>Открыть программу площадей: 13 групп, 21 900 м²</strong></a></p>']
for r in sources:
    if r['group']!='documents':continue
    pages=next((f" · {x['pages']} стр." for x in pdfs if x['path']==r['path']),'')
    parts.append(f'<div class="doc"><a href="{ESC(r["path"])}">{ESC(r["title"])}</a>{pages}<br><small>{ESC(r["author"])} · <a href="{ESC(r["url"])}">Источник</a></small></div>')
parts+=['<h2 id="entries">Проекты участников</h2>', '<h3>Snøhetta — победитель</h3><p>Ранняя публикация: Architecture, September 2000, печатная с. 50 / PDF 26. План и изображения предложения, опубликованные вскоре после конкурса.</p><p><a href="documents/architecture-2000-09/source.pdf#page=26">Полный выпуск журнала</a></p><a href="previews/snohetta-competition-2000-p026.png"><img class="preview" src="previews/snohetta-competition-2000-p026.png" alt="Snøhetta, публикация 2000 года"></a>']
for group in ['entries','winner-development']:
    if group=='winner-development':parts.append('<h2 id="development">Развитие и реализация победившего проекта</h2><p>Материалы этого раздела относятся к последующим стадиям; не выдаются за конкурсную подачу.</p>')
    for src in sources:
        if src['group']!=group:continue
        key=src['key']; selected=[x for x in images if x['key']==key]
        parts.append(f'<h3>{ESC(src["author"])}</h3><p>{ESC(src["title"])}</p><p><a href="{ESC(src["path"])}">Сохранённая публикация</a> · <a href="{ESC(src["url"])}">Сайт источника</a></p><div class="grid">')
        for x in selected:
            parts.append(f'<figure><a href="{ESC(x["path"])}"><img loading="lazy" src="{ESC(x["path"])}" alt="{ESC(x["title"])}"></a><figcaption>{ESC(Path(x["path"]).name)} · {x["width"]} × {x["height"]}<br>{ESC(x["author"])}</figcaption></figure>')
        if key=='perea':
            for i in [1,2]:parts.append(f'<figure><a href="entries/perea/source.pdf#page={i}"><img src="previews/perea-p{i:03d}.png" alt="Andrés Perea, лист {i}"></a><figcaption>Лист {i} из 2 · Andrés Perea Ortega</figcaption></figure>')
        parts.append('</div>')
parts+=['<h2 id="gaps">Ограничения и продолжение поиска</h2><ul><li>Не получены: полный окончательный конкурсный комплект ноября 1999, оригинальная подоснова, DWG, полный протокол жюри, все конкурсные подачи.</li><li>Правительственные страницы и PDF возвращают 403 при прямом скачивании. Официальные парламентские документы 1999 и 2002 скачаны целиком; программа площадей есть в PDF 1999.</li><li>wettbewerbe aktuell предлагает платный полный отчёт 09/2000, с. 43–54. Сохранена открытая страница, покупка не выполнялась.</li><li>Число работ расходится по источникам: 240 в Architectural Record и ARQA; 236 в wettbewerbe aktuell; 250 участников в современной карточке Statsbygg. Это не исправлялось в записи без установления методики подсчёта.</li><li>Korn Architects: страница найдена, скачивание не удалось. Указанные автором дата 12/2000 и площадь 180000 м² расходятся с конкурсом; в подтверждённую подборку не включена.</li></ul>',
 '<p><a href="sources.json">Источники и хеши</a> · <a href="image-manifest.json">Изображения и авторство</a> · <a href="derivatives.json">Происхождение превью</a> · <a href="inventory-2026-10-16.json">Опись</a></p><footer>Файлы сохранены локально в папке Dropbox. Синхронизация с облаком отдельно не проверена. Права остаются у авторов; разрешение на перепубликацию не предполагается автоматически.</footer></body></html>']
(ROOT/'index.html').write_text('\n'.join(parts),encoding='utf-8')

for key in ['halvorsen','aranguren-gallegos','mvrdv','giencke','elliott','nieminen']:
    rows=[r for r in images if r['key']==key];w=900;cellw=300;cellh=220
    sheet=Image.new('RGB',(w,math.ceil(len(rows)/3)*cellh),'white');draw=ImageDraw.Draw(sheet)
    for i,r in enumerate(rows):
        with Image.open(ROOT/r['path']) as im: thumb=ImageOps.contain(im.convert('RGB'),(290,190))
        x=(i%3)*cellw;y=(i//3)*cellh
        sheet.paste(thumb,(x+(cellw-thumb.width)//2,y))
        draw.text((x+5,y+193),Path(r['path']).name[:42],fill='black')
    out=f'previews/contact-{key}.jpg';sheet.save(ROOT/out,quality=85)
    derived.append({'path':out,'source_paths':[r['path'] for r in rows],'operation':'contact sheet'})
(ROOT/'derivatives.json').write_text(json.dumps(derived,ensure_ascii=False,indent=2),encoding='utf-8')
(ROOT/'pdf-index.json').write_text(json.dumps(pdfs,ensure_ascii=False,indent=2),encoding='utf-8')
(ROOT/'START_HERE.md').write_text('''# Конкурс Оперы в Осло 1999–2000

Откройте index.html. Программа площадей — programme-1999.html, исходный парламентский PDF: documents/parliament-1999/report.pdf, PDF-страница 7 (печатная 11), таблица 4.1.

Собраны 7 альтернативных предложений (Stein Halvorsen, Aranguren + Gallegos, FLN/Sari Nieminen, Chris Elliott, Volker Giencke, MVRDV, Andrés Perea), ранняя публикация победителя Snøhetta в Architecture 09/2000 и последующие авторские публикации.

Это доступные публикации, не полный комплект всех заявок. Окончательное ТЗ и полный протокол жюри не получены. Полный отчёт wettbewerbe aktuell платный; сохранена открытая страница.

README.md пользователя сохранён без изменений. Источники, авторство и контрольные суммы находятся в JSON-описях. Публичный текст записи и модель площадей не изменялись. Облачная синхронизация не проверена.
''',encoding='utf-8')
for name in ['collect_oslo_competition.py','build_oslo_competition_catalog.py']:
    (ROOT/'scripts').mkdir(exist_ok=True);shutil.copy2(REPO/'tools'/name,ROOT/'scripts'/name)
inventory=[]
for p in sorted(ROOT.rglob('*')):
    if not p.is_file() or p.name=='inventory-2026-10-16.json':continue
    inventory.append({'path':p.relative_to(ROOT).as_posix(),'size':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(ROOT/'inventory-2026-10-16.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'sources':len(sources),'images':len(images),'pdfs':len(pdfs),'files':len(inventory)+1,'bytes_without_inventory':sum(r['size'] for r in inventory)},ensure_ascii=False))
