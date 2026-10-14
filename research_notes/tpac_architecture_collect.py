from pathlib import Path
from bs4 import BeautifulSoup
import requests,json,uuid,hashlib,concurrent.futures,io
from urllib.parse import urljoin,urlparse
from PIL import Image
root=Path('research_notes/Материалы для программы Тайбэйского центра');base=root/'files/architecture';jobs=[]
def add(url,name,page,credit,kind):
 jobs.append(dict(uid=str(uuid.uuid4()),url=url,filename=name,source_page=page,credit=credit,kind=kind,status='pending'))
for x in json.loads((base/'anc-images.json').read_text(encoding='utf-8')):
 name=x.get('data-filename','')
 if 'edited_A2-' in name or 'Sectional' in name or 'Concept' in name:
  add(x['src'],'anc-'+name.replace(' ','_').replace('.jpg','.png') if '.png?' in x['src'] else 'anc-'+name.replace(' ','_'),'https://anc.masilwide.com/2167','OMA / A&C magazine, July 2022 vol.494','plan' if 'edited_A2-' in name else 'diagram-section')
s=BeautifulSoup((base/'record.html').read_bytes(),'html.parser')
for a in s.find_all(['img','a']):
 u=a.get('href',a.get('src',''))
 if 'Taipei' in u or 'taipei' in u:
  print('RECORD',u)
for x in json.loads((base/'twarchitect-images.json').read_text(encoding='utf-8')):
 if '202207a1-' in x.get('src',''):add(x['src'],'twarchitect-'+x['src'].split('/')[-1],'https://www.twarchitect.org.tw/works/臺北表演藝術中心/','OMA + KRIS YAO ARTECH; photos Chris Stowers / 牧童攝影 / 林軒朗 / TPAC','journal-illustration')
(root/'architecture-manifest.json').write_text(json.dumps(jobs,ensure_ascii=False,indent=2),encoding='utf-8')
(root/'architecture.md').write_text('# Архитектура TPAC — сбор материалов\n\n## Промежуточные результаты\n\n### Takeaway\nA&C (июль 2022, №494) опубликовал восемь планов OMA и перспективные разрезы. Загрузка выполняется; проверенный статус каждого файла в architecture-manifest.json.\n\n### Cited Findings\n- [A&C, полный материал](https://anc.masilwide.com/2167) — планы 1–8, разрезы, схемы и фото.\n- [Arup Journal 2022 №2](https://www.arup.com/projects/the-arup-journal/the-arup-journal-2022-issue-2/) — инженерный разбор TPAC.\n- [OMA: The Metropolitan Stage (2023)](https://www.oma.com/publications/the-metropolitan-stage-taipei-performing-arts-center) — авторская книга, опубликованы выдержки.\n\n### Inferences\nПланы помогут оценить отношения помещений и блоков.\n\n### Gaps\nРабота продолжается, полная ведомость помещений пока не найдена.\n',encoding='utf-8')
def run(j):
 try:
  r=requests.get(j['url'],timeout=45);r.raise_for_status();f=base/j['filename'];f.write_bytes(r.content);im=Image.open(io.BytesIO(r.content));im.verify();j.update(status='downloaded_image_verified',bytes=len(r.content),sha256=hashlib.sha256(r.content).hexdigest(),width=im.width,height=im.height,format=im.format,path=str(f))
 except Exception as e:j.update(status='failed',error=str(e))
 return j
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:jobs=list(pool.map(run,jobs))
(root/'architecture-manifest.json').write_text(json.dumps(jobs,ensure_ascii=False,indent=2),encoding='utf-8')
print('DOWNLOADED',[(j['filename'],j['status'],j.get('bytes')) for j in jobs])
