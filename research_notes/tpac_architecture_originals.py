from pathlib import Path
from bs4 import BeautifulSoup
import requests,json,uuid,hashlib,io,re,concurrent.futures
from PIL import Image
root=Path('research_notes/Материалы для программы Тайбэйского центра');b=root/'files/architecture';s=BeautifulSoup((b/'gooood.html').read_bytes(),'html.parser');vals=json.loads(s.find('script',id='__NUXT_DATA__').string);manifest=json.loads((root/'architecture-manifest.json').read_text(encoding='utf8'));jobs=[]
for u in vals:
 if not isinstance(u,str):continue
 m=re.fullmatch(r'http://oss.gooood.cn/uploads/2021/01/(\d+)-Taipei-Performing-Arts-Center_OMA.jpg',u)
 if m and 28<=int(m[1])<=59:jobs.append(dict(uid=str(uuid.uuid4()),url=u.replace('http:','https:'),filename='gooood-original-'+u.split('/')[-1],source_page='https://www.gooood.cn/taipei-performing-arts-center-oma.htm',credit='OMA / gooood, 2021-01-22',kind='architectural-drawing',status='pending'))
def run(j):
 try:
  r=requests.get(j['url'],timeout=30);r.raise_for_status();f=b/j['filename'];f.write_bytes(r.content);im=Image.open(io.BytesIO(r.content));im.verify();j.update(status='downloaded_image_verified',bytes=len(r.content),sha256=hashlib.sha256(r.content).hexdigest(),width=im.width,height=im.height,format=im.format,path=str(f),retrieved='2026-10-14')
 except Exception as e:j.update(status='failed',error=str(e))
 return j
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
 for j in pool.map(run,jobs):manifest.append(j);print(j['filename'],j['status'],j.get('width'),j.get('height'),flush=True)
# Remove only our redundant downloaded web thumbnails; original research files untouched.
kept=[]
for j in manifest:
 if j['filename'].startswith('gooood-') and not j['filename'].startswith('gooood-original-'):
  f=(b/j['filename']).resolve();assert f.parent==b.resolve();f.unlink(missing_ok=True)
 else:kept.append(j)
(root/'architecture-manifest.json').write_text(json.dumps(kept,ensure_ascii=False,indent=2),encoding='utf8')
