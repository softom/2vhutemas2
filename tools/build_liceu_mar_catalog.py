"""Build a local guide and source-preserving PDF extracts for Liceu Mar."""
from pathlib import Path
import datetime
import hashlib
import html
import json
import re
import shutil
import sys
import urllib.parse
import fitz

def main():
    root = Path(sys.argv[1]).resolve()
    manifest = json.loads((root/'download-manifest-2026-10-16.json').read_text(encoding='utf-8'))
    byid = {r['file'].split('/')[-1].split('_')[0]: r for r in manifest}
    output = root/'extracts'
    output.mkdir(exist_ok=True)
    derivatives = []
    def extract(source_id, name, pages):
        row = byid[source_id]
        with fitz.open(root/row['file']) as original, fitz.open() as doc:
            for page in pages:
                doc.insert_pdf(original,from_page=page-1,to_page=page-1)
            doc.set_metadata({'title':name,'subject':f"Extract from {row['file']}; original PDF pages {pages}", 'author':'Source: Gran Teatre del Liceu / Port de Barcelona'})
            dest = output/name
            doc.save(dest)
        derivatives.append({'file':dest.relative_to(root).as_posix(),'source_uid':row['source_uid'],'source_file':row['file'],'source_pdf_pages':pages})
    extract('301741701','area-programme-and-relations.pdf',[30,31])
    extract('301741701','functional-programme.pdf',list(range(21,32)))
    extract('301741701','site-and-planning-constraints.pdf',list(range(7,12))+list(range(33,48)))
    extract('301741701','available-documents-topography-status.pdf',[47])
    extract('301727400','moll-espanya-planning-drawings-2001.pdf',[15,23,24,28,29,30])
    (root/'derivatives.json').write_text(json.dumps(derivatives,ensure_ascii=False,indent=2),encoding='utf-8')
    # Transcription of the visually checked category totals, source PDF page 30.
    areas=[('Вестибюль, фойе и обслуживание посетителей','VESTÍBULO',840),('Бары, рестораны и кухни','BAR-RESTAURANTES',380),('Санузлы зрителей','SERVICIOS PÚBLICOS',90),('Основной зал, включая оркестровую яму','SALA PRINCIPAL',850),('Сцена, задний и боковые объёмы, мостики','ESCENARIO',918),('Репетиционные помещения и классы','SALAS DE ENSAYO',1372),('Танцевальный блок','ÁREA DE DANZA',290),('Артистические уборные','CAMERINOS',330),('Обслуживание сцены и артистов','ESPACIOS ESCENA',390),('Склады','ALMACENES',350),('Администрация и помещения персонала','OFICINAS',355),('Прочие и технические помещения','OTROS',290)]
    assert sum(x[2] for x in areas)==6455
    def link(path,label):
        target = path if path.startswith(('https://','http://')) else urllib.parse.quote(path,safe='/#')
        return f'<a href="{html.escape(target,quote=True)}">{html.escape(label)}</a>'
    latest=byid['301741701']['file']
    planning=byid['301727403']['file']
    all_docs=''.join(f'<tr><td>{link(r["file"],r["title"])}</td><td>{r.get("pages", "—")}</td><td>{link(r["url"],"Источник")}</td></tr>' for r in manifest if r['status']=='ok')
    area_rows=''.join(f'<tr><td>{a}<small>{b}</small></td><td>{c:,}</td></tr>'.replace(',',' ') for a,b,c in areas)
    body=f'''<!doctype html><html lang="ru"><meta charset="utf-8"><title>Liceu Mar — конкурсные документы</title>
<style>body{{max-width:1100px;margin:45px auto;padding:0 24px;font:17px/1.55 system-ui;color:#202a30;background:#f8f7f3}}h1{{font-size:36px}}h2{{margin-top:40px}}a{{color:#135d89}}table{{border-collapse:collapse;width:100%;background:white}}td,th{{padding:10px 14px;border-bottom:1px solid #ddd;text-align:left}}small{{display:block;color:#68747b}}.box{{background:#e7eee8;padding:22px;border-left:5px solid #3d7661}}img{{max-width:100%;height:auto}}.gallery{{display:grid;grid-template-columns:1fr 1fr;gap:20px}}li{{margin:10px 0}}</style>
<h1>Liceu Mar · конкурс 2025–2026</h1><p>Официальные документы, площадная программа и материалы участка. Проверено 16 октября 2026 года.</p>
<div class="box"><b>Начните с этих файлов:</b><ul>
<li>{link(latest,'Актуальное найденное ТЗ: редакция 17.10.2025, испанский перевод, 54 страницы')}</li>
<li>{link('extracts/area-programme-and-relations.pdf','Площади и функциональные связи — 2 страницы')} · {link('extracts/functional-programme.pdf','Программа помещений — 11 страниц')}</li>
<li>{link('extracts/site-and-planning-constraints.pdf','Участок и ограничения конкурса — схемы и описание')}</li>
<li>{link(planning,'Port Vell: 5 листов градостроительных чертежей BA192')}</li>
<li>{link('extracts/moll-espanya-planning-drawings-2001.pdf','Moll d’Espanya: 6 страниц с чертежами из плана 2001 года')}</li></ul></div>
<h2>Где именно площади</h2><p>В обновлённом испанском ТЗ таблица §5.11 — <b>страница 30</b>, схема связей §5.12 — <b>31</b>. В старом июльском ТЗ — страницы 29 и 30. Это ориентировочная программа заказчика, а не обмеры построенного здания. При расхождении переводов приоритет имеет каталонский оригинал.</p>
<table><tr><th>Функциональная группа — рабочий перевод</th><th>Полезная площадь, м²</th></tr>{area_rows}<tr><th>Сумма помещений</th><th>6 455</th></tr><tr><td>Коммуникации, 20%</td><td>1 291</td></tr><tr><th>Полезная площадь с коммуникациями</th><th>7 746</th></tr><tr><th>Общая площадь по колонке Total construida</th><th>8 985,36</th></tr></table>
<p>Сумма 12 групп проверена: 6 455 м². Полная исходная таблица с отдельными помещениями находится в PDF и на изображении ниже.</p>
<div class="gallery"><a href="previews/brief-30.png"><img src="previews/brief-30.png" alt="Таблица площадей, стр. 30"></a><a href="previews/brief-31.png"><img src="previews/brief-31.png" alt="Схема связей, стр. 31"></a></div>
<h2>Что есть вместо DWG-подосновы</h2><p>Скачаны официальные градостроительные приложения: план Port Vell (BA192: чертежи, нормы, пояснительная записка) и изменение плана Moll d’Espanya 2001 года (B010433, 30 страниц). Это архивные сканированные PDF. Не следует считать их актуальной геодезической съёмкой или DWG.</p>
<p><b>Топосъёмка и геология:</b> §8.3 обновлённого ТЗ, стр. 47, предусматривает заказ этих исследований и передачу выбранному проектировщику после присуждения работ. Открытых DWG/DXF в скачанном перечне приложений нет. {link('extracts/available-documents-topography-status.pdf','Открыть страницу с этим условием')}.</p>
<a href="{urllib.parse.quote(planning)}"><img src="previews/port-vell-contact.jpg" alt="Пять листов плана Port Vell"></a>
<h2>Редакции и состояние конкурса</h2><p>На сайте театра лежат июльские версии. Портал закупок содержит изменённое ТЗ 17.10.2025 и обновлённые переводы условий от 31.10.2025. Все эти версии сохранены отдельно. В публичной карточке на дату проверки — «Expedient en avaluació», последняя публикация 26.03.2026; скачаны протоколы и заключение первого тура. Это не комплект финальных проектов участников.</p>
<p>{link('https://contractaciopublica.cat/ca/detall-publicacio/cb4b6f63-8576-4a62-9be3-1c70301feea6/300604574','Объявление и приложения на официальном портале')} · {link('https://contractaciopublica.cat/ca/detall-publicacio/cb4b6f63-8576-4a62-9be3-1c70301feea6/300733083','Протоколы оценки')}</p>
<h2>Все скачанные источники</h2><table><tr><th>Документ</th><th>Страниц</th><th>Оригинальный URL</th></tr>{all_docs}</table>
<p>{link('download-manifest-2026-10-16.json','Реестр источников и SHA-256')} · {link('derivatives.json','Происхождение PDF-выписок')} · {link('inventory-2026-10-16.json','Опись папки')}</p><p>Скачивание и локальная проверка не подтверждают облачную синхронизацию, независимый BackUp или обновление записи сайта.</p></html>'''
    (root/'index.html').write_text(body,encoding='utf-8')
    (root/'START_HERE.md').write_text('''# Liceu Mar — документы скачаны 16.10.2026

Откройте **index.html**: там прямые ссылки на все документы, выписки, таблицу площадей и планы.

Исходный README пользователя сохранён. Его фраза о том, что ТЗ ещё не скачано, теперь устарела.

- Площади: extracts/area-programme-and-relations.pdf (страницы 30–31 обновлённого испанского ТЗ).
- Программа помещений: extracts/functional-programme.pdf.
- Схемы участка: extracts/site-and-planning-constraints.pdf.
- Пять листов Port Vell: documents/301727403_planols_BA192.PDF.
- Чертежи Moll d’Espanya: extracts/moll-espanya-planning-drawings-2001.pdf.
- Оригиналы и приложения: documents/.

DWG/DXF в перечне приложений не обнаружены. Согласно §8.3, стр. 47 обновлённого ТЗ, топосъёмку и геологию предполагается передать выбранному проектировщику после присуждения работ. Архивные планы не заменяют актуальную геодезическую подоснову.

Обновлённая каталонская версия имеет приоритет над переводами. Для удобства выделены страницы испанского перевода; исходная июльская редакция сохранена отдельно.
''',encoding='utf-8')
    snapshots=[]
    for filename,publication_id in [('procurement-tender.json',300604574),('procurement-publication.json',300733083)]:
        snapshots.append({'file':filename,'source_url':f'https://contractaciopublica.cat/portal-api/detall-publicacio-expedient/cb4b6f63-8576-4a62-9be3-1c70301feea6/{publication_id}','retrieved_date':'2026-10-16'})
    (root/'procurement-sources.json').write_text(json.dumps(snapshots,ensure_ascii=False,indent=2),encoding='utf-8')
    for script in [Path(__file__), Path(__file__).with_name('collect_liceu_mar.py')]:
        shutil.copy2(script,root/script.name)
    inventory=[]
    for p in sorted(root.rglob('*')):
        if p.is_file() and p.name!='inventory-2026-10-16.json':
            inventory.append({'file':p.relative_to(root).as_posix(),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
    (root/'inventory-2026-10-16.json').write_text(json.dumps({'created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':inventory},ensure_ascii=False,indent=2),encoding='utf-8')
    missing=[]
    for target in re.findall(r'(?:href|src)="([^"]+)"',body):
        if '://' not in target and not (root/urllib.parse.unquote(html.unescape(target)).split('#')[0]).exists():
            missing.append(target)
    if missing:
        raise RuntimeError(f'Missing local links: {missing}')
    print(f'Sources: {len(manifest)}; inventory files: {len(inventory)}; PDF extracts: {len(derivatives)}; broken local links: 0')

if __name__=='__main__':
    main()
