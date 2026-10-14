from pathlib import Path
import requests,json,uuid,hashlib,concurrent.futures
from bs4 import BeautifulSoup
root=Path('research_notes/Материалы для программы театра Тайчжуна');b=root/'files/architecture';b.mkdir(parents=True,exist_ok=True)
urls={'npac-floor-guide':'https://www.npac-ntt.org/en/blog/c-zLZ2eQl09ki','npac-guide-zh':'https://www.npac-ntt.org/blog/c-BjAqlma9i1n','arup':'https://www.arup.com/projects/the-national-taichung-theater/','jara-plans.pdf':'https://www.jara-net.com/jara30th/sample/sample11-taichung.pdf','moma-Japanese-Constellation-preview.pdf':'https://www.moma.org/momaorg/shared/pdfs/docs/publication_pdf/3234/MoMA_JapaneseConstellation_PREVIEW.pdf','geotech-153.pdf':'https://www.geotech.org.tw/upload/e_book_file/20191205170041240.pdf'}
jobs=[]
for n,u in urls.items():jobs.append(dict(uid=str(uuid.uuid4()),filename=n if n.endswith('.pdf') else n+'.html',url=u,source_page=u,credit='Toyo Ito & Associates / JARA' if n.startswith('jara') else 'MoMA' if n.startswith('moma') else 'Geotechnical Engineering Journal' if n.startswith('geotech') else 'NPAC NTT' if n.startswith('npac') else 'Arup',status='pending'))
(root/'architecture-manifest.json').write_text(json.dumps(jobs,ensure_ascii=False,indent=2),encoding='utf8')
(root/'architecture.md').write_text('# Тайчжун — архитектурные материалы\n\n## Поэтажные планы\n### Takeaway\nНайден официальный поэтажный путеводитель NPAC и авторский PDF JARA с B2/B1/1–6 этажами. Сбор продолжается.\n### Cited Findings\n- [NPAC](https://www.npac-ntt.org/en/blog/c-zLZ2eQl09ki).\n- [JARA](https://www.jara-net.com/jara30th/sample/sample11-taichung.pdf).\n### Inferences\nНужна сверка проектных и эксплуатационных планов.\n### Gaps\nСлужебные этажи 3 и 4 отсутствуют в туристическом путеводителе.\n',encoding='utf8')
def run(j):
 try:
  r=requests.get(j['url'],timeout=70);r.raise_for_status();f=b/j['filename'];f.write_bytes(r.content);j.update(status='downloaded',bytes=len(r.content),sha256=hashlib.sha256(r.content).hexdigest(),path=str(f),retrieved='2026-10-14')
  if f.suffix=='.html':
   s=BeautifulSoup(r.content,'html.parser');(b/(f.stem+'-images.json')).write_text(json.dumps([dict(x.attrs) for x in s.find_all('img')],ensure_ascii=False,indent=2),encoding='utf8')
  else:
   from pypdf import PdfReader
   pdf=PdfReader(f);j.update(pages=len(pdf.pages),status='downloaded_pdf_verified');(b/(f.stem+'-text.txt')).write_text('\n\n'.join(f'--- PDF page {i+1} ---\n'+(p.extract_text() or '') for i,p in enumerate(pdf.pages)),encoding='utf8')
 except Exception as e:j.update(status='failed',error=str(e))
 return j
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
 for j in pool.map(run,jobs):print(j['filename'],j['status'],j.get('bytes'),j.get('pages'),flush=True)
(root/'architecture-manifest.json').write_text(json.dumps(jobs,ensure_ascii=False,indent=2),encoding='utf8')
