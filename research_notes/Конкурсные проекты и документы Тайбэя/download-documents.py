from pathlib import Path
import json,uuid,hashlib,urllib.request,concurrent.futures,os
BASE=Path(__file__).parent
OLD=BASE.parent/'Материалы для программы Тайбэйского центра'
OUT=BASE/'files/documents'; OUT.mkdir(parents=True,exist_ok=True)
manifest=[]
for x in json.loads((OLD/'competition-manifest.json').read_text(encoding='utf-8-sig')):
    if 'tpac.com.tw' not in x.get('original_url',''): continue
    p=OLD/x['relative_path'] if x.get('relative_path') else None
    e={'uid':x['uid'],'title':x['title'],'url':x['url'],'original_url':x.get('original_url'),'archive_timestamp':x.get('archive_timestamp'),'local_path':None,'status':x['status'],'bytes':None,'sha256':None,'description':'Официальные конкурсные документы из прежнего корпуса; не копируются.'}
    if p and p.exists():
        b=p.read_bytes(); e.update(local_path=os.path.relpath(p,BASE).replace('\\','/'),status='existing_file_verified',bytes=len(b),sha256=hashlib.sha256(b).hexdigest())
        if x.get('sha256') and e['sha256']!=x['sha256']: e['status']='hash_mismatch'
        if p.suffix.lower()=='.pdf':
            import fitz
            with fitz.open(p) as d:e['pdf_pages']=len(d)
    manifest.append(e)
targets=[
('architw-official-results.html','https://www.architw.org.tw/view_article.php?id=2959','Официальное сообщение организатора: итоговые места и выставка'),
('architw-announcement-jury.html','https://www.architw.org.tw/view_article.php?id=2781','Официальное объявление: семь членов жюри и календарь'),
('city-2008-chronology.html','https://culture.gov.taipei/News_Content.aspx?n=FD864505B018E5BC&s=F28B3657BD77ADEE','Городская хроника: 136 заявок из 24 стран, три финалиста и четыре поощрения'),
('first-result-en.html','https://web.archive.org/web/20090131023415id_/http://www.tpac.com.tw:80/html/first_result_e.html','Архивный итог первого тура'),
('second-result-en.html','https://web.archive.org/web/20090131023441id_/http://www.tpac.com.tw:80/html/sec_result_e.html','Архивный итог второго тура'),
('archive-programme-cdx.json','https://web.archive.org/cdx/search/cdx?url=*.tpac.com.tw/*&output=json&filter=original:.*[Pp]rogram.*&collapse=urlkey','Повторная ограниченная проверка Programme по поддоменам без фильтра HTTP-статуса'),
('programme-115-availability.json','https://archive.org/wayback/available?url=http%3A%2F%2Fwww.tpac.com.tw%2Fdownload%2F06-Program%28Chinese%26English%29_P115-P128.pdf&timestamp=2009','Проверка ближайшего снимка недостающей таблицы площадей стр.115–128')]
def fetch(t):
    name,url,desc=t
    e={'uid':str(uuid.uuid4()),'title':name,'url':url,'local_path':None,'status':'pending','bytes':None,'sha256':None,'description':desc}
    try:
        req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
        with urllib.request.urlopen(req,timeout=35) as r:b=r.read(); e['resolved_url']=r.url; e['content_type']=r.headers.get('Content-Type')
        p=OUT/name;p.write_bytes(b)
        e.update(local_path=str(p.relative_to(BASE)).replace('\\','/'),status='downloaded',bytes=len(b),sha256=hashlib.sha256(b).hexdigest())
        if name.endswith('.json'):
            j=json.loads(b);e['json_summary']=j if len(b)<3000 else 'large JSON saved'
    except Exception as err:e['status']='download_failed';e['error']=str(err)
    return e
(BASE/'documents-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
    for e in pool.map(fetch,targets):
        manifest.append(e)
        (BASE/'documents-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
        print(e['title'],e['status'],e.get('bytes'),e.get('error',''),e.get('json_summary',''),flush=True)
