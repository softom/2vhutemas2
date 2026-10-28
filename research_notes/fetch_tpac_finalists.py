import requests,json,uuid,hashlib,re
from pathlib import Path
from bs4 import BeautifulSoup
from urllib.parse import urljoin
from concurrent.futures import ThreadPoolExecutor
R=Path('D:/WORK/2Vhutemas/research_notes/Конкурсные проекты и документы Тайбэя'); D=R/'files/finalists'; D.mkdir(parents=True,exist_ok=True)
urls={
'results':'https://forgemind.net/media/台北藝術中心taipei-performing-arts-center競圖結果公布-由-rem-koolhaas-oma-勝出/',
'jakob':'https://www.designboom.com/architecture/jakob-macfarlane-dominique-jakob-tpac-taipei-performing-art-center-proposal/',
'abalos':'https://www.archdaily.com/12843/abalossentkiewicz-project-for-the-taipei-performing-arts-centre',
'abalos-engineer':'https://www.klcse.com/taipei-performing-art-center.html',
'abalos-pdf':'https://www.arauacustica.com/files/noticias/pdf_esp_312.pdf',
'morphosis':'https://www.morphosis.com/architecture/42/',
'shortlist':'https://www.e-architect.com/taiwan/performing-arts-centre-taipei',
'awards':'https://akichiatlas.com/en/archives/taipei_performing_arts.php'}
def fetch(k,u):
 rec={'uid':str(uuid.uuid4()),'title':k,'url':u,'local_path':None,'status':'pending'}
 try:
  r=requests.get(u,timeout=35);r.raise_for_status();ext='.pdf' if 'pdf' in r.headers.get('Content-Type','') else '.html';p=D/(k+ext);p.write_bytes(r.content)
  rec.update(local_path=p.relative_to(R).as_posix(),status='downloaded',bytes=len(r.content),sha256=hashlib.sha256(r.content).hexdigest())
  if ext=='.html':
   soup=BeautifulSoup(r.content,'html.parser');imgs=[]
   for im in soup.select('img'):
    for a in ['src','data-src','data-srcset','srcset','data-original']:
     if im.get(a): imgs.append({'url':urljoin(u,im[a]),'alt':im.get('alt',''),'context':im.parent.get_text(' ',strip=True)[:200]})
   (D/(k+'-images.json')).write_text(json.dumps(imgs,ensure_ascii=False,indent=2),encoding='utf8')
   (D/(k+'-text.txt')).write_text(soup.get_text(' ',strip=True),encoding='utf8')
 except Exception as e:rec['status']='failed';rec['error']=str(e)
 return rec
with ThreadPoolExecutor(max_workers=8) as pool: records=list(pool.map(lambda kv:fetch(*kv),urls.items()))
(R/'finalists-downloads-interim.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf8')
for x in records: print(x['title'],x['status'],x.get('bytes'))
