"""Build a local catalogue from preserved competition manifests; no network/API writes."""
from pathlib import Path
from html import escape as h
from urllib.parse import quote, urljoin
import argparse, hashlib, json, uuid
from bs4 import BeautifulSoup

ap = argparse.ArgumentParser()
ap.add_argument('folder', type=Path)
b = ap.parse_args().folder.resolve()
def save(name, obj):
    (b / name).write_bytes((json.dumps(obj, ensure_ascii=False, indent=2) + '\n').encode())
def link(path, title):
    return f'<a href="{quote(str(path).replace(chr(92), "/"), safe="/:#")}">{h(title)}</a>'

old_inventory = json.loads((b/'inventory-2026-10-15.json').read_text(encoding='utf-8-sig'))
audit = []
for x in old_inventory:
    p = b/x['path']
    audit.append({'path':x['path'], 'exists':p.is_file(), 'sha256_matches':p.is_file() and hashlib.sha256(p.read_bytes()).hexdigest()==x['sha256']})
save('inventory-check-2026-10-16.json', audit)

images = json.loads((b/'finalists-manifest.json').read_text()) + json.loads((b/'ito-manifest.json').read_text())
images = [x for x in images if x.get('local_path','').lower().endswith(('.jpg','.jpeg','.png'))]
for x in images:
    p=b/x['local_path']
    assert p.is_file(), p
    assert hashlib.sha256(p.read_bytes()).hexdigest()==x['sha256'], p
save('catalog-images.json', images)

cdx = json.loads((b/'documents/wayback-cdx-tmoh.json').read_text())
sources = []
titles = {'tender_documents.html':'Исходный перечень конкурсных документов', 'plan_competition.htm':'Правила, календарь и премии конкурса', 'plan_final-1.htm':'Участники первого этапа', 'plan_final-2.htm':'Пять финалистов и итоговые места', 'plan_judge.htm':'Жюри', 'plan_prohibition.htm':'Выставка конкурсных проектов', 'plan_comment_juror.htm':'Страница комментариев жюри — текст не восстановлен', 'plan_dataofbase.htm':'Страница участка — интерактивная панорама не восстановлена'}
for fn, title in titles.items():
    p=b/'documents'/fn
    row=next((x for x in cdx[1:] if x[2].endswith('/'+fn)),None)
    url=('https://web.archive.org/web/'+row[1]+'id_/'+row[2]) if row else None
    sources.append({'uid':str(uuid.uuid5(uuid.NAMESPACE_URL,url or str(p))), 'title':title, 'url':url, 'local_path':p.relative_to(b).as_posix(), 'sha256':hashlib.sha256(p.read_bytes()).hexdigest(), 'status':'local_html_verified'})
for fn,title,url in [('culture-first-round-33-04-09.pdf','Официальная публикация управления культуры: проекты и комментарии','https://www.culture.taichung.gov.tw/media/827516/33-04-09.pdf'),('announcement-architw.html','Объявление Тайваньского архитектурного института','https://www.architw.org.tw/view_article.php?id=1741')]:
    p=b/'documents'/fn
    sources.append({'uid':str(uuid.uuid5(uuid.NAMESPACE_URL,url)), 'title':title, 'url':url, 'local_path':p.relative_to(b).as_posix(), 'sha256':hashlib.sha256(p.read_bytes()).hexdigest(), 'status':'local_file_verified'})
save('catalog-documents.json',sources)

page=BeautifulSoup((b/'documents/tender_documents.html').read_bytes(),'html.parser')
downloads=[]
for a in page.find_all('a',href=True):
    target=a['href']
    if any(s in target.lower() for s in ('.pdf','.zip','.dwg','.dxf','.doc')):
        url=urljoin('http://www.tmoh.com.tw/html/tender_documents.html',target)
        if not any(x['url']==url for x in downloads):
            downloads.append({'uid':str(uuid.uuid5(uuid.NAMESPACE_URL,url)), 'title':a.get_text(' ',strip=True), 'url':url, 'status':'link_in_original_inventory_file_not_obtained'})
save('original-tender-downloads.json',downloads)

report='''# Конкурс театра Тайчжуна 2005

Проверка и завершение каталога: 16 октября 2026. Папка конкурса соответствует новой записи пользователя; прежняя опись inventory-2026-10-15.json не изменялась.

## Площадная программа: точный статус

Сам исходный Design Program не скачан. В перечне организатора есть пункт 06-3 空間設計原則 — принципы пространственного проектирования, китайский и английский языки, PDF 6 900 K. Имя файла: 06-Design_Program(Chinese&English).pdf. Он является главным кандидатом на источник подробной программы, но без чтения файла наличие и состав конкретной таблицы площадей не подтверждены.

Исходный адрес: http://www.tmoh.com.tw/txt/chi/06-Design_Program(Chinese&English).pdf

Также перечислены полные комплекты All_Documents(English).zip (15 052 K) и All_Documents(Chinese).zip (15 251 K), вопросы/ответы, исходные DWG/DXF. Ссылки на документы не означают, что файлы получены. 16.10 прямой HTTPS-запрос Design Program вернул HTTP 406 Mod_Security; файл не сохранён как PDF. Прежняя проверка Availability вернула пустые снимки Programme, английского ZIP и Q&A. Повторный запрос полного CDX 16.10 завершился тайм-аутом, поэтому отсутствие файлов во всём архиве не утверждается.

Контактные листы всех пяти проектов просмотрены. На отдельно прочитанных планшетах Ито 07/08/10 и CHIEN «program generation + concept» нет сводной таблицы помещений с площадями. Там есть планы с подписями и функциональные схемы. Это не полная построчная проверка мелкого текста всех 56 конкурсных изображений и не доказательство отсутствия частных площадных данных. Проектные решения участников и чертежи построенного здания не подменяют задание конкурса.

Практический следующий источник — оригинал пункта 06-3 или полный конкурсный ZIP у архива организатора/участника. Сообщений им не отправляли. Название и точные адреса сохранены в original-tender-downloads.json, чтобы можно было запросить конкретный документ.

## Конкурс и материалы

По архивным страницам организатора: открытый двухэтапный конкурс объявлен 01.09.2005; первая подача — 03.10.2005; итоги — 16.12.2005. Перечень первого этапа содержит участников; итоговая страница подтверждает пять финалистов. Победитель Toyo Ito & Associates; второе место Zaha Hadid Architects; третье Claus en Kaan Architecten; поощрения CHIEN Architects & Associates и Shuhei Endo.

Сохранены 56 изображений конкурсных предложений: Ито 10, Заха Хадид 10, Claus en Kaan 14, CHIEN 10, Эндо 12. Среди них планы, разрезы, фасады, концептуальные схемы, визуализации и фотографии макетов; это не 56 одинаковых по типу планшетов. Дополнительно 36 иллюстраций раннего проектирования, разработки и выставки проекта Ито. Датировка и происхождение находятся в manifests; недатированные материалы Balmond не приписаны стадии 2005.

Архивные HTML, официальный журнал и объявление находятся в documents/. Список документов с URL и SHA-256 — catalog-documents.json. Источник изображений конкурса — публикация https://monaco.pixnet.net/blog/posts/2021522860 с оригиналами Flickr. Итоговые места отдельно сверены по plan_final-2.htm. Сохранённые архивные страницы могут иметь отсутствующие старые изображения/скрипты; каталог указывает это для страниц участка и комментариев жюри.

Местные файлы не объявляются опубликованными, переданными на сервер или свободными от авторских прав. Правообладатели и ссылки сохранены. Действующая WIKI и скрипт сборки остаются в Git.
'''
(b/'README.md').write_bytes(report.encode())
style='body{font:16px/1.6 system-ui;max-width:1240px;margin:auto;padding:32px;color:#263b36;background:#f4f1e9}h1{font-size:38px}a{color:#126458}.notice{padding:20px;background:#fff0cc;border-left:5px solid #ae7331}section{margin:28px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}figure{margin:0;padding:12px;background:white;border:1px solid #ddd}img{width:100%;height:220px;object-fit:contain}small{display:block;color:#52645d}table{width:100%;border-collapse:collapse;background:white}td,th{padding:12px;border-bottom:1px solid #ddd;text-align:left}input{padding:12px;font:inherit;width:95%}'
parts=[f'<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Конкурс театра Тайчжуна 2005</title><style>{style}</style><h1>Конкурс театра Тайчжуна 2005</h1><p>56 конкурсных изображений · 36 иллюстраций развития проекта · проверено 16 октября 2026</p><p><a href="https://2vhutemas.ru/entities/taichung-metropolitan-opera-house-competition-2005">Запись конкурса в системе</a> · <a href="README.md">Отчёт и ограничения</a> · <a href="#documents">Документы</a> · <a href="#projects">Проекты</a></p>', '<div class="notice"><strong>Официальная площадная программа пока не получена.</strong> В исходном пакете найден пункт 06-3: <b>Design Program / 空間設計原則</b>, PDF 6 900 K, китайский и английский. Сохранилась ссылка, сам PDF скачать не удалось. Подробная таблица м² не подтверждена. <a href="documents/tender_documents.html">Перечень организатора</a> · <a href="original-tender-downloads.json">Точные ссылки на файлы</a>. Планы участников ниже — самостоятельные проектные предложения.</div>', '<h2 id="projects">Проекты финалистов</h2><input id="filter" placeholder="Поиск по автору или стадии">']
groups=[('Ито — 1-е место','competition2005',None),('Заха Хадид — 2-е место',None,'zaha-hadid'),('Claus en Kaan — 3-е место',None,'claus-en-kaan'),('CHIEN — поощрение',None,'chien'),('Шухэй Эндо — поощрение',None,'shuhei-endo'),('Ито — ранние модели и выставка 2006','early-design/exhibition2006',None),('Ито / Balmond — разработка, точная дата изображений не установлена','design-development-undated',None),('Ито — выставка и развитие проекта 2014','development/exhibition2014',None)]
for title,stage,author in groups:
    selected=[x for x in images if (x.get('stage')==stage if stage else x.get('author')==author)]
    if not selected:continue
    parts.append(f'<section class="group"><h2>{h(title)}</h2><p>{len(selected)} изображений</p><div class="grid">')
    for x in selected:
        p=quote(x['local_path'],safe='/');src=x.get('source_url') or x.get('url','');caption=x.get('title','')
        parts.append(f'<figure><a href="{p}"><img loading="lazy" src="{p}" alt="{h(caption)}"></a><figcaption>{h(caption)}<small>{h(x.get("author",""))} · {h(x.get("stage",""))}</small><a href="{h(src)}">Источник</a></figcaption></figure>')
    parts.append('</div></section>')
parts.append('<h2 id="documents">Документы и архивные страницы</h2><table><tr><th>Материал</th><th>Файл</th><th>Источник</th></tr>')
for x in sources:
    parts.append(f'<tr><td>{h(x["title"])}</td><td>{link(x["local_path"],"Открыть")}</td><td><a href="{h(x["url"] or "")}">Источник</a></td></tr>')
parts.append('</table><h2>Проверка файлов</h2><p>Сохранена пользовательская опись от 15.10.2026. <a href="inventory-check-2026-10-16.json">Результат сверки</a>. Новая опись и контрольные суммы: <a href="catalog-images.json">изображения</a>, <a href="catalog-documents.json">документы</a>.</p><script>document.getElementById("filter").oninput=e=>{let q=e.target.value.toLowerCase();document.querySelectorAll(".group").forEach(s=>s.hidden=!s.textContent.toLowerCase().includes(q))}</script></html>')
(b/'index.html').write_bytes(''.join(parts).encode())
parsed=BeautifulSoup((b/'index.html').read_text(),'html.parser')
from urllib.parse import unquote, urlparse
missing=[]
for e in parsed.find_all(['a','img']):
    value=e.get('href') or e.get('src')
    if value and not urlparse(value).scheme and not value.startswith('#') and not (b/unquote(value.split('#')[0])).exists():missing.append(value)
assert not missing, missing
print(json.dumps({'images':len(images),'documents':len(sources),'inventory_entries':len(audit),'inventory_mismatches':[x for x in audit if not x['sha256_matches']],'broken_links':missing},ensure_ascii=False))
