from pathlib import Path
from bs4 import BeautifulSoup
import requests,json,uuid,hashlib,io,re,concurrent.futures
from PIL import Image
from urllib.parse import urljoin
root=Path('research_notes/Материалы для программы театра Тайчжуна');b=root/'files/architecture';manifest=json.loads((root/'architecture-manifest.json').read_text(encoding='utf8'));jobs=[]
def add(u,n,c,page):jobs.append(dict(uid=str(uuid.uuid4()),url=u,source_page=page,filename=n,credit=c,status='pending'))
s=BeautifulSoup((b/'record.html').read_bytes(),'html.parser');seen=set()
for x in s.find_all('img'):
 u=x.get('data-src','');m=re.search(r'National-Taichung-Theater-(\d+)\.',u)
 if m and int(m[1]) in [16,17,18,19,35,36,37,38,39,40] and u not in seen:seen.add(u);add(u,'Record-drawing-'+m[1]+'.webp','Toyo Ito & Associates / Architectural Record','https://www.architecturalrecord.com/articles/12040-national-taichung-theater-by-toyo-ito-associates')
s=BeautifulSoup((b/'twarchitect.html').read_bytes(),'html.parser')
for x in s.find_all('img'):
 u=x.get('src','')
 if '201703a1-' in u:add(u,'TwArchitect-'+u.split('/')[-1],'Toyo Ito & Associates + DAJU / TwArchitect','https://www.twarchitect.org.tw/works/臺中國家歌劇院/')
s=BeautifulSoup((b/'ntu-structure.html').read_bytes(),'html.parser')
for x in s.find_all('img'):
 u=x.get('src','');m=re.search(r'T4_25_(\d+)([a-z]?)\.jpg',u)
 if m and int(m[1])<=20:add(urljoin('https://www.ntuce-newsletter.tw/vol.98/T4_25.html',u),'NTU-'+u.split('/')[-1],'Evergreen / Arup / Toyo Ito / DAJU; see article captions','https://www.ntuce-newsletter.tw/vol.98/T4_25.html')
def run(j):
 try:
  r=requests.get(j['url'],timeout=40);r.raise_for_status();f=b/j['filename'];f.write_bytes(r.content);im=Image.open(io.BytesIO(r.content));im.verify();j.update(status='downloaded_image_verified',bytes=len(r.content),sha256=hashlib.sha256(r.content).hexdigest(),width=im.width,height=im.height,format=im.format,path=str(f),retrieved='2026-10-14')
 except Exception as e:j.update(status='failed',error=str(e))
 return j
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
 for j in pool.map(run,jobs):manifest.append(j);(root/'architecture-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8');print(j['filename'],j['status'],j.get('width'),j.get('height'),flush=True)
