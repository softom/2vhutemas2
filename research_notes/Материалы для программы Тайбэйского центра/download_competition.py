import concurrent.futures, urllib.request, json, uuid, hashlib, pathlib, re, datetime
base=pathlib.Path(r'D:/WORK/2Vhutemas/research_notes/Материалы для программы Тайбэйского центра')
rows=json.loads((base/'files/competition/archive-index.json').read_text(encoding='utf-8-sig'))[1:]
items=[]
for row in rows:
 u=row[2]
 if '/download/' in u and re.search(r'\.(pdf|dwg|doc)$',u,re.I):
  fn=u.rsplit('/',1)[1].replace('&','-and-').replace(':','-')
  items.append(dict(uid=str(uuid.uuid4()),title=fn,author='Department of Cultural Affairs, Taipei City Government',date='2008',original_url=u,url='https://web.archive.org/web/'+row[1]+'id_/'+u,archive_timestamp=row[1],relative_path='files/competition/'+fn,status='pending',bytes=None,sha256=None))
for url,title,author,date,fn in [
 ('https://www.bauwelt.de/dl/757947/10800136_847ee3885e.pdf','Performing Arts Center Taipei — Bauwelt 9/2009','Friederike Meyer / Bauwelt','2009','Bauwelt-9-2009-competition.pdf'),
 ('https://www.arauacustica.com/files/noticias/pdf_esp_312.pdf','Taipei Performing Arts Center Entry — third prize','Abalos + Sentkiewicz / Arau Acustica','2009-03-26','Abalos-Sentkiewicz-Arau-competition.pdf')]:
 items.append(dict(uid=str(uuid.uuid4()),title=title,author=author,date=date,original_url=url,url=url,relative_path='files/competition/'+fn,status='pending',bytes=None,sha256=None))
man=base/'competition-manifest.json'
def save(): man.write_text(json.dumps(items,ensure_ascii=False,indent=2),encoding='utf-8')
save()
def get(item):
 try:
  req=urllib.request.Request(item['url'],headers={'User-Agent':'Mozilla/5.0'})
  with urllib.request.urlopen(req,timeout=50) as r: data=r.read(); item['content_type']=r.headers.get('Content-Type'); item['resolved_url']=r.url
  suffix=pathlib.Path(item['relative_path']).suffix.lower()
  if suffix=='.pdf' and not data.startswith(b'%PDF'): raise ValueError('response not PDF')
  if suffix=='.dwg' and not data.startswith(b'AC10'): raise ValueError('response not DWG')
  if suffix=='.doc' and not data.startswith(bytes.fromhex('d0cf11e0')): raise ValueError('response not Word compound file')
  (base/item['relative_path']).write_bytes(data)
  item.update(status='downloaded',bytes=len(data),sha256=hashlib.sha256(data).hexdigest(),retrieved_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
 except Exception as e:item.update(status='download_failed',error=str(e))
 return item
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
 for item in pool.map(get,items):
  save(); print(item['status'],item['title'],item.get('bytes'),item.get('error',''),flush=True)
save()
