"""Download public Oslo competition sources to the existing entity folder.

Originals are never overwritten with derived files. No authentication to sources.
Run with Python providing bs4 and Pillow; PDF inspection is a separate step.
"""
from pathlib import Path
import re, io
import urllib.request, urllib.parse, json, hashlib, datetime, uuid, concurrent.futures
from bs4 import BeautifulSoup

ROOT = Path(r'E:\Dropbox\2VHUTEMAS\ЧТО\ПРОЕКТЫ\Международный архитектурный конкурс на новое здание Норвежской национальной оперы в Бьёрвике, Осло, 1999–2000')
SOURCES = [
 ('programme-1999', 'documents', 'Statsbygg / Kulturdepartementet', 'Предконкурсная программа, январь 1999, письмо 02.02.1999', 'https://www.regjeringen.no/no/dokumenter/stprp-nr-48-1998-99-/id202373/?ch=14'),
 ('government-1999', 'documents', 'Kulturdepartementet', 'Правительственный доклад 1999: главы и ссылки на приложения', 'https://www.regjeringen.no/no/dokumenter/stprp-nr-48-1998-99-/id202373/'),
 ('project-2002', 'documents', 'Kulturdepartementet', 'Итоги конкурса и развитие проекта, 2002', 'https://www.regjeringen.no/no/dokumenter/stprp-nr-48-2001-2002-/id206042/?ch=3'),
 ('government-2002', 'documents', 'Kulturdepartementet', 'Правительственный доклад 2002: полный документ', 'https://www.regjeringen.no/no/dokumenter/stprp-nr-48-2001-2002-/id206042/'),
 ('statsbygg-facts', 'documents', 'Statsbygg', 'Брошюра заказчика о реализации, не конкурсное задание', 'https://dok.statsbygg.no/wp-content/uploads/2023/10/nyOperaEngelsk.pdf'),
 ('wa-results', 'documents', 'wettbewerbe aktuell', 'Объявление и итоги: указаны 236 работ, публикация 09/2000, с. 43–54', 'https://www.wettbewerbe-aktuell.de/ergebnis/neue-oper-oslo-145606'),
 ('halvorsen', 'entries', 'Stein Halvorsen Arkitekter', 'Storstuen — вторая премия; чертежи, макет и описание', 'https://steinhalvorsenarkitekter.no/prosjekter/den-norske-opera-nytt-operahus-bj%C3%B8rvika'),
 ('aranguren-gallegos', 'entries', 'Aranguren + Gallegos', 'Iceberg — третья премия; авторская публикация', 'https://www.arangurengallegos.com/ag/portfolio_page/oslo-opera/'),
 ('nieminen', 'entries', 'Sari Nieminen / Kimmo Friman / Esa Laaksonen (FLN)', 'Vesi — почётное упоминание', 'https://www.arknieminen.fi/oslon-ooppera/'),
 ('elliott', 'entries', 'Chris Elliott Architects', 'Конкурсное предложение, 2000', 'https://chriselliottarchitects.com/gallery/oslo-opera-house/'),
 ('giencke', 'entries', 'Volker Giencke', 'Авторская публикация проекта, 2000', 'https://www.giencke.com/projects_detail2_en.php?pid=giencke_073'),
 ('mvrdv', 'entries', 'MVRDV', 'Вертикальная опера — конкурсное предложение, 2000', 'https://www.mvrdv.com/projects/142/oslo-opera'),
 ('perea', 'entries', 'Andrés Perea Ortega', 'Конкурсные листы: планы, разрезы и генплан, 2000', 'https://andrespereaarq.com/wp-content/uploads/2016/02/Co_opera_Oslo_01.pdf'),
 ('snohetta-arqa', 'winner-development', 'Snøhetta / ARQA', 'Описание авторов и развитие победившей концепции; публикация 2008', 'https://arqa.com/english-es/architecture-es/operahouse.html'),
 ('snohetta-nal', 'winner-development', 'Snøhetta / Architecture Norway', 'Реализованный проект и чертежи; не оригинальная конкурсная подача', 'https://www.architecturenorway.no/projects/culture/oslo-opera-2007/'),
 ('korn', 'uncertain', 'Korn Architects / B. Blaschke', 'Требует проверки: автор указывает 12/2000 и 180000 м², что расходится со сроками и рамкой конкурса', 'https://korn-architects.com/en/project/new-oslo-opera-item31/'),
 ('government-pdf-2002', 'documents', 'Kulturdepartementet', 'Полный официальный доклад St.prp.48 (2001–2002), 56 страниц', 'https://www.regjeringen.no/contentassets/d6ea88bb2548440f87b18cb3ba42b07f/no/pdfa/stp200120020048000dddpdfa.pdf'),
 ('parliament-1999', 'documents', 'Stortinget', 'Заключение парламентского комитета, 1999', 'https://www.stortinget.no/no/Saker-og-publikasjoner/Publikasjoner/Innstillinger/Stortinget/1998-1999/inns-199899-213/?lvl=0'),
 ('snohetta-official', 'winner-development', 'Snøhetta', 'Авторская публикация победителя: развитие и реализация', 'https://old.snohetta.com/projects/42-norwegian-national-opera-and-ballet'),
]

def get(url):
    request=urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0 (research archive; public sources)'})
    with urllib.request.urlopen(request,timeout=45) as r:
        return r.read(), r.geturl(), r.headers.get('Content-Type','')

def save(url, relative, meta):
    p=ROOT/relative
    p.parent.mkdir(parents=True,exist_ok=True)
    if p.exists():
        data=p.read_bytes(); final=url; mime='cached'
    else:
        data,final,mime=get(url)
        if relative.endswith('.pdf') and not data.startswith(b'%PDF'): raise ValueError('Not PDF')
        p.write_bytes(data)
    return dict(meta, url=url, final_url=final, path=relative, size=len(data), sha256=hashlib.sha256(data).hexdigest(), content_type=mime,
                source_uuid=str(uuid.uuid5(uuid.NAMESPACE_URL,url)), retrieved_at=datetime.datetime.now(datetime.timezone.utc).isoformat(), rights='Авторские права сохраняются; разрешение на перепубликацию не установлено.')

def pages():
    rows=[]; errors=[]
    for key,group,author,title,url in SOURCES:
        ext='.pdf' if '.pdf' in url else '.html'
        try:
            row=save(url,f'{group}/{key}/source{ext}',dict(key=key,group=group,author=author,title=title,kind='source'))
            rows.append(row)
            if ext=='.html':
                soup=BeautifulSoup((ROOT/row['path']).read_bytes(),'html.parser')
                links=[{'text':a.get_text(' ',strip=True),'url':urllib.parse.urljoin(url,a.get('href',''))} for a in soup.select('a[href]')]
                (ROOT/group/key/'links.json').write_text(json.dumps(links,ensure_ascii=False,indent=2),encoding='utf-8')
            print(key,len((ROOT/row['path']).read_bytes()),flush=True)
        except Exception as e:
            errors.append(dict(key=key,url=url,error=str(e))); print(key,'ERROR',str(e),flush=True)
    (ROOT/'sources.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
    (ROOT/'download-errors.json').write_text(json.dumps(errors,ensure_ascii=False,indent=2),encoding='utf-8')

def assets():
    from PIL import Image
    rows=json.loads((ROOT/'sources.json').read_text(encoding='utf-8'))
    jobs=[]
    for src in rows:
        if not src['path'].endswith('.html'): continue
        s=BeautifulSoup((ROOT/src['path']).read_bytes(),'html.parser');key=src['key'];found=[]
        if key=='halvorsen': found=[(x['url'],'') for x in s.select('lazy-image[url]') if '0006-Den-Norske-Opera/_w_2000/' in x['url']]
        elif key=='aranguren-gallegos': found=[(x['data-lazyload'],'') for x in s.select('[data-lazyload]') if '/uploads/OS' in x['data-lazyload']]
        elif key in ('nieminen','elliott','giencke'):
            found=[(x['href'],'') for x in s.select('a[href]') if re.search(r'\.(jpg|png|jpeg)$',x['href'],re.I)]
            if key=='giencke':found += [(x['src'],'') for x in s.select('img[src]') if 'db/bilder' in x['src']]
        elif key=='mvrdv':found=[(x['src'],'') for x in s.select('img[src]') if '/scraped/' in x['src']]
        elif key=='snohetta-nal':
            found=[(x['data-large'],x.get('title','')) for x in s.select('[data-large]') if any(w in x.get('title','').lower() for w in ('plan','section','diagram','elevation','model'))]
        used=set()
        for url,caption in found:
            url=urllib.parse.urljoin(src['url'],url)
            if key=='mvrdv':url=url.split('?')[0]
            if url in used:continue
            used.add(url)
            name=Path(urllib.parse.unquote(urllib.parse.urlparse(url).path)).name
            jobs.append((url,f"{src['group']}/{key}/images/{name}",dict(key=key,group=src['group'],author=src['author'],title=caption or src['title'],kind='image',source_page=src['url'])))
    result=[];errors=[]
    def one(job):
        row=save(*job)
        with Image.open(ROOT/row['path']) as im: row['width'],row['height']=im.size; im.verify()
        return row
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        pending={pool.submit(one,job):job for job in jobs}
        for f in concurrent.futures.as_completed(pending):
            try:result.append(f.result())
            except Exception as e:errors.append(dict(url=pending[f][0],error=str(e)))
    result.sort(key=lambda r:r['path'])
    (ROOT/'image-manifest.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    (ROOT/'image-errors.json').write_text(json.dumps(errors,ensure_ascii=False,indent=2),encoding='utf-8')
    print('images',len(result),'errors',len(errors),flush=True)
    for key in sorted({r['key'] for r in result}):print(key,sum(r['key']==key for r in result),flush=True)

if __name__=='__main__':
    import sys
    if '--assets' in sys.argv:assets()
    else:pages()
