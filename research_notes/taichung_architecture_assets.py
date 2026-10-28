from pathlib import Path
from bs4 import BeautifulSoup
import requests,json,uuid,hashlib,concurrent.futures,io
from PIL import Image
from pypdf import PdfReader
root=Path('research_notes/Материалы для программы театра Тайчжуна');b=root/'files/architecture';manifest=json.loads((root/'architecture-manifest.json').read_text(encoding='utf8'));jobs=[]
def add(u,n,c):jobs.append(dict(uid=str(uuid.uuid4()),url=u,source_page=u,filename=n,credit=c,status='pending'))
for floor,n in [('6F','20231225201200726'),('5F','20231225201152429'),('2F','20231225201143444'),('1F','20240305195736408'),('B1','20240305195755346'),('B2','20231225204516710')]:add('https://www.npac-ntt.org/dispUploadBox/PJ-/Ckeditor/'+n+'.png','NPAC-floor-guide-'+floor+'.png','NPAC National Taichung Theater')
add('https://www.architecturalrecord.com/articles/12040-national-taichung-theater-by-toyo-ito-associates','record.html','Naomi Pollock / Architectural Record; Toyo Ito drawings')
add('https://www.ntuce-newsletter.tw/vol.98/T4_25.html','ntu-structure.html','NTU Civil Engineering / Evergreen, Arup')
add('https://www.istructe.org/IStructE/media/Public/TSE-Archive/2017/1b80f4e4-bc4e-494b-aa3d-b8d6a13ace2b.pdf','IStructE-award-2017.pdf','The Structural Engineer / Arup')
add('https://www.npac-ntt.org/blog/c-zESPGhNUQCy?tapeID=n16KIB7b','NPAC-green-theatre.html','NPAC National Taichung Theater')
add('https://www.taichung.gov.tw/media/208694/6121993171.pdf','Taichung-city-building-HVAC.pdf','Taichung City Government')
def run(j):
 try:
  r=requests.get(j['url'],timeout=50);r.raise_for_status();f=b/j['filename'];f.write_bytes(r.content);j.update(bytes=len(r.content),sha256=hashlib.sha256(r.content).hexdigest(),path=str(f),retrieved='2026-10-14')
  if f.suffix=='.html':
   s=BeautifulSoup(r.content,'html.parser');(b/(f.stem+'-images.json')).write_text(json.dumps([dict(x.attrs) for x in s.find_all('img')],ensure_ascii=False,indent=2),encoding='utf8');j['status']='downloaded_html'
  elif f.suffix=='.pdf':
   pdf=PdfReader(f);j.update(pages=len(pdf.pages),status='downloaded_pdf_verified');(b/(f.stem+'-text.txt')).write_text('\n\n'.join(f'--- PDF page {i+1} ---\n'+(p.extract_text() or '') for i,p in enumerate(pdf.pages)),encoding='utf8')
  else:
   im=Image.open(io.BytesIO(r.content));im.verify();j.update(status='downloaded_image_verified',width=im.width,height=im.height,format=im.format)
 except Exception as e:j.update(status='failed',error=str(e))
 return j
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
 for j in pool.map(run,jobs):manifest.append(j);(root/'architecture-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8');print(j['filename'],j['status'],j.get('bytes'),j.get('pages'),flush=True)
import fitz
doc=fitz.open(b/'jara-plans.pdf')
for i,page in enumerate(doc):page.get_pixmap(matrix=fitz.Matrix(2,2)).save(b/f'jara-page-{i+1}.png')
