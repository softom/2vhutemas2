from pathlib import Path
from bs4 import BeautifulSoup
import requests,json,uuid,hashlib,io,re,concurrent.futures
from PIL import Image
root=Path('research_notes/Материалы для программы Тайбэйского центра');b=root/'files/architecture';s=BeautifulSoup((b/'gooood.html').read_bytes(),'html.parser');manifest=json.loads((root/'architecture-manifest.json').read_text(encoding='utf8'));jobs=[]
for x in s.find_all('img'):
 u=x.get('src','');m=re.search(r'/(\d+)-Taipei-Performing-Arts-Center_OMA',u)
 if m and int(m[1])>=28:
  n=int(m[1]);jobs.append(dict(uid=str(uuid.uuid4()),url=u,filename='gooood-'+u.split('/')[-1],source_page='https://www.gooood.cn/taipei-performing-arts-center-oma.htm',credit='OMA / gooood, 2021-01-22',kind='drawing',status='pending'))
def run(j):
 try:
  r=requests.get(j['url'],timeout=30);r.raise_for_status();f=b/j['filename'];f.write_bytes(r.content);im=Image.open(io.BytesIO(r.content));im.verify();j.update(status='downloaded_image_verified',bytes=len(r.content),sha256=hashlib.sha256(r.content).hexdigest(),width=im.width,height=im.height,format=im.format,path=str(f),retrieved='2026-10-14')
 except Exception as e:j.update(status='failed',error=str(e))
 return j
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
 for j in pool.map(run,jobs):manifest.append(j);print(j['filename'],j['status'],flush=True)
(root/'architecture-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
# Author's own outgoing publication index (links as links, no full-text republishing).
s=BeautifulSoup((b/'oma.html').read_bytes(),'html.parser');links=[]
for a in s.find_all('a',href=True):
 u=a['href'];label=a.get_text(' ',strip=True)
 if label and (u.startswith('http') or '/lectures/' in u or '/news/' in u):links.append({'uid':str(uuid.uuid4()),'title':label,'url':u if u.startswith('http') else 'https://www.oma.com'+u,'source_page':'https://www.oma.com/projects/taipei-performing-arts-center','status':'link_listed_by_OMA_not_all_opened'})
(root/'architecture-oma-bibliography.json').write_text(json.dumps(links,ensure_ascii=False,indent=2),encoding='utf8');print('bibliography',len(links))
