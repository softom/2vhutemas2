"""Package every attachment linked by the official NPAC technical page snapshot."""
from pathlib import Path
from urllib.request import urlopen
from urllib.parse import urljoin, urlsplit, parse_qs, quote
from concurrent.futures import ThreadPoolExecutor
import collections, hashlib, html, json, re, shutil, uuid, zipfile
import fitz
from PIL import Image

B=Path(__file__).resolve().parent
P=B/'riders-full-2026-10-15'
P.mkdir(exist_ok=True)
URL='https://www.npac-ntt.org/venuehire/technical'
snapshot=B/'files/technical/official-technical-page-2026-10-15.html'
source=snapshot.read_text(encoding='utf-8')
existing=json.loads((B/'technical-manifest.json').read_text(encoding='utf-8'))
by_id={x['filename'].split('__')[-1]:x for x in existing}
def write(p,s):
    p.parent.mkdir(parents=True,exist_ok=True)
    p.write_bytes(s.encode('utf-8'))
def clean(s): return html.unescape(re.sub('<[^>]+>','',s)).strip()
links={}
for section in re.split(r'<section\b',source):
    heading=re.search(r'<div class="title">(.*?)</div>',section,re.S)
    group=clean(heading.group(1)) if heading else 'Прочее'
    for attrs,raw,text in re.findall(r'<a\b([^>]*?href=["\x27]([^"\x27]+)["\x27][^>]*)>(.*?)</a>',section,re.S):
        url=urljoin(URL,html.unescape(raw))
        if '/getfile/' not in url.lower(): continue
        title=clean(text)
        if not title:
            cap=re.search(r'data-caption=["\x27]([^"\x27]+)',attrs)
            title=clean(cap.group(1)) if cap else group
        links[url]=(title,group)
assert len(links)==141, f'Changed source attachment count: {len(links)}'

def collect(item):
    url,(title,group)=item
    fid=parse_qs(urlsplit(url).query)['FileName'][0]
    old=by_id.get(fid)
    uid=old['uid'] if old else str(uuid.uuid5(uuid.NAMESPACE_URL,url))
    ext=Path(fid).suffix.lower()
    cat=old['category'] if old else 'venue-images'
    p=P/'files'/cat/(uid+ext)
    p.parent.mkdir(parents=True,exist_ok=True)
    if old:
        original=Path(old['local_path'])
        assert hashlib.sha256(original.read_bytes()).hexdigest()==old['sha256']
        shutil.copyfile(original,p)
    elif not p.exists():
        with urlopen(url,timeout=60) as r: data=r.read()
        p.write_bytes(data)
    raw=p.read_bytes()
    result={'uid':uid,'title':old['title'] if old else title+' — '+fid,'section':group,'category':cat,
            'original_filename':old['filename'] if old else fid,'local_path':p.relative_to(P).as_posix(),
            'source_url':URL,'original_url':url,'author':'National Taichung Theater / NPAC; credits in original retained',
            'date_checked':'2026-10-15','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),
            'format':ext[1:].upper(),'download_status':'previously_downloaded_original_reverified' if old else 'downloaded',
            'rights_status':'No open republication license established; retain original credits and consult rights page.'}
    if ext=='.pdf':
        with fitz.open(p) as d:
            result['pages']=len(d)
            for page in d: page.get_text()
    elif ext=='.dwg':
        assert raw.startswith(b'AC10')
        result['verification']='DWG signature only, not opened in CAD'
    elif ext=='.zip':
        with zipfile.ZipFile(p) as z: assert z.testzip() is None
    else:
        with Image.open(p) as im: result['dimensions']=[im.width,im.height];im.verify()
    return result

with ThreadPoolExecutor(max_workers=4) as pool:
    records=list(pool.map(collect,links.items()))
shutil.copyfile(snapshot,P/'source-technical-page.html')
with urlopen('https://www.npac-ntt.org/about/copyright',timeout=45) as r:
    (P/'source-rights-page.html').write_bytes(r.read())
counts=dict(collections.Counter(r['format'] for r in records))
total=sum(r['bytes'] for r in records)
manifest={'uid':'81cb3254-730e-4c12-b096-77c771eb2b02','title':'National Taichung Theater — full official technical attachments',
          'date':'2026-10-15','scope':'Every attachment link on the saved official technical page, including venue images; not a full archive of the entire website.',
          'source_url':URL,'expected_links':len(links),'verified_files':len(records),'formats':counts,
          'total_bytes':total,'pdf_pages':sum(r.get('pages',0) for r in records),'files':records}
write(P/'manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
readme=f'''# Национальный театр Тайчжуна — полный комплект вложений технической страницы

Дата сверки: 15 октября 2026. Источник: {URL}

В комплекте {len(records)} из {len(links)} вложений страницы: {counts}. Объём оригиналов {total/1048576:.1f} МБ. PDF содержат {manifest['pdf_pages']} страниц.

Открыть index.html для списка файлов с поиском. Все ссылки на оригиналы внутри пакета относительные; каталог работает после распаковки без сети. Для интернет-источников нужна сеть.

125 ранее загруженных оригиналов повторно проверены по SHA-256 и скопированы без изменений; 16 JPG дополнительно скачаны. PDF проверены программным чтением всех страниц, ZIP — CRC, изображения — декодером; DWG — по сигнатуре, без открытия в CAD. Внешние JPG — самостоятельные иллюстрации разделов, не изображения страниц PDF. Исходные названия, UID, даты, размеры и SHA-256 — в manifest.json. Короткие имена файлов на диске используют UID для переносимости; названия документов показаны в оглавлении.

Полнота относится ко всем вложениям сохранённой страницы технических материалов на дату проверки. Это технические руководства, оборудование и чертежи Grand Theater, Playhouse, Black Box, общественных и служебных зон, а также иллюстрации. Чертежи JARA и другие сторонние публикации в пакет не включены.

Для публикации: National Taichung Theater / NPAC; исходные авторские штампы и подписи сохранены. Размещение материалов в открытом доступе не установлено как свободная лицензия на полную перепубликацию. На сайте есть отдельный порядок лицензирования изображений и иных объектов: https://www.npac-ntt.org/about/copyright. Сохранена копия страницы source-rights-page.html. Применимость этого порядка к конкретным техническим PDF требует отдельной проверки; этот пакет не утверждает, что разрешение получено. Сведения об авторстве и источнике уже подготовлены для редакционного использования.

Ничего не опубликовано в БД или на публичном сайте. Исходные файлы не редактировались.
'''
write(P/'README.md',readme)
esc=html.escape
body=''
for r in records:
    body+=f'<tr><td><a href="{quote(r["local_path"])}">{esc(r["title"])}</a></td><td>{esc(r["section"])}</td><td>{r["format"]}</td><td>{r["bytes"]/1048576:.2f}</td><td><a href="{esc(r["original_url"])}">NPAC: оригинал</a></td></tr>'
write(P/'index.html',f'''<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Тайчжун — полный технический комплект</title><style>body{{font:16px/1.5 system-ui;margin:40px auto;padding:0 24px;max-width:1300px;background:#f6f3ec;color:#243832}}h1{{font-size:38px}}a{{color:#12685e}}input{{padding:12px;width:90%;font:inherit}}table{{width:100%;border-collapse:collapse;background:white;margin-top:20px}}td,th{{padding:12px;text-align:left;border-bottom:1px solid #ddd}}small{{color:#596b63}}.note{{padding:16px;background:#fff0cf}}.scroll{{overflow:auto}}</style><h1>Национальный театр Тайчжуна<br>Полный технический комплект</h1><p><b>{len(records)} / {len(links)} вложений официальной страницы</b> · {total/1048576:.1f} МБ · проверено 15.10.2026</p><p>Grand Theater · Playhouse · Black Box · служебные и общественные пространства</p><p><a href="README.md">Описание и проверка</a> · <a href="manifest.json">Реестр с источниками и SHA-256</a> · <a href="{URL}">Официальная страница</a></p><p class="note">Для публикации сохранены авторство и источники. Свободная лицензия на полную перепубликацию не установлена. <a href="https://www.npac-ntt.org/about/copyright">Порядок лицензирования NPAC</a>.</p><input id="q" placeholder="Поиск по названию, залу или формату"><p id="count"></p><div class="scroll"><table><thead><tr><th>Документ / оригинальное название</th><th>Раздел</th><th>Формат</th><th>МБ</th><th>Источник</th></tr></thead><tbody>{body}</tbody></table></div><script>const q=document.querySelector('#q'),rows=[...document.querySelectorAll('tbody tr')];function filter(){{let n=0;for(const r of rows){{r.hidden=!r.textContent.toLowerCase().includes(q.value.toLowerCase());n+=!r.hidden;}}document.querySelector('#count').textContent=n+' файлов';}}q.addEventListener('input',filter);filter();</script></html>''')
archive=B/'NTT-technical-riders-full-2026-10-15.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=1) as z:
    for p in sorted(P.rglob('*')):
        if p.is_file(): z.write(p,p.relative_to(P).as_posix())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert len([n for n in z.namelist() if n.startswith('files/')])==len(records)
validation={'date':'2026-10-15','attachments':len(records),'formats':counts,'pdf_pages':manifest['pdf_pages'],
            'original_bytes':total,'archive_bytes':archive.stat().st_size,'archive_sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),
            'zip_crc':'passed','missing_files':0}
write(B/'riders-validation.json',json.dumps(validation,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(validation,ensure_ascii=False,indent=2))
