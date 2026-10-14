from pathlib import Path
import json,requests,uuid,hashlib,concurrent.futures,io
from PIL import Image
from pypdf import PdfReader
from bs4 import BeautifulSoup
root=Path('research_notes/Материалы для программы Тайбэйского центра');b=root/'files/architecture';manifest=json.loads((root/'architecture-manifest.json').read_text(encoding='utf-8'));jobs=[]
def add(url,name,page,credit,kind):jobs.append(dict(uid=str(uuid.uuid4()),url=url,filename=name,source_page=page,credit=credit,kind=kind,status='pending'))
add('https://www.arup.com/globalassets/downloads/arup-journal/the-arup-journal-2022-issue-2.pdf','Arup-Journal-2022-2.pdf','https://www.arup.com/projects/the-arup-journal/the-arup-journal-2022-issue-2/','Arup, Jonathan Griffiths, Gigi Kam, Rory McGowan, Chas Pope, Yuanyuan Song','engineering-journal-pdf')
s=BeautifulSoup((b/'record.html').read_bytes(),'html.parser')
for a in s.find_all('img'):
 u=a.get('src','')
 if any('Taipei-Performing-Arts-Center-'+str(i)+'.' in u for i in range(14,18)):add('https://www.architecturalrecord.com'+u,'record-'+u.split('/')[-1],'https://www.architecturalrecord.com/articles/15951-at-omas-taipei-performing-arts-center-building-as-public-performance','OMA / Architectural Record','drawing')
for key in ['tw-structure','tw-hvac']:
 for x in json.loads((b/(key+'-images.json')).read_text(encoding='utf-8')):
  if '202207' in x.get('src',''):add(x['src'],key+'.jpg','https://www.twarchitect.org.tw/special/'+('臺北表演藝術中心的結構實踐/' if key=='tw-structure' else '北藝中心的空調挑戰/'),'Evergreen Consulting Engineering / TwArchitect' if key=='tw-structure' else 'TwArchitect / HVAC engineering consultant','engineering-illustration')
for n,x in enumerate(json.loads((b/'oma-book-images.json').read_text(encoding='utf-8')),1):
 u=x.get('data-srcset','').split(' ')[0].split('?')[0]
 if u.startswith('https'):add(u,f'oma-book-excerpt-{n:02}.jpg','https://www.oma.com/publications/the-metropolitan-stage-taipei-performing-arts-center','OMA / A+Tec, The Metropolitan Stage 2023; selected official excerpts','book-excerpt')
def run(j):
 try:
  r=requests.get(j['url'],timeout=65);r.raise_for_status();f=b/j['filename'];f.write_bytes(r.content);j.update(bytes=len(r.content),sha256=hashlib.sha256(r.content).hexdigest(),path=str(f),retrieved='2026-10-14')
  if j['filename'].endswith('.pdf'):
   pdf=PdfReader(io.BytesIO(r.content));j.update(status='downloaded_pdf_verified',pages=len(pdf.pages),format='PDF');(b/(f.stem+'-text.txt')).write_text('\n\n'.join(f'--- PDF page {i+1} ---\n'+(p.extract_text() or '') for i,p in enumerate(pdf.pages)),encoding='utf-8')
  else:
   im=Image.open(io.BytesIO(r.content));im.verify();j.update(status='downloaded_image_verified',width=im.width,height=im.height,format=im.format)
 except Exception as e:j.update(status='failed',error=str(e))
 return j
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
 for j in pool.map(run,jobs):manifest.append(j);(root/'architecture-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8');print(j['filename'],j['status'],j.get('bytes'),flush=True)
