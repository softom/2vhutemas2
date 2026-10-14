import urllib.request, urllib.parse, re, html, json, uuid, hashlib, pathlib, concurrent.futures, datetime
ROOT=pathlib.Path(r'D:/WORK/2Vhutemas/research_notes/Материалы для программы Тайбэйского центра')
OUT=ROOT/'files'/'technical'; OUT.mkdir(parents=True,exist_ok=True)
def get(url):
 url=urllib.parse.quote(url,safe=':/?&=%[]+@,;')
 req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
 with urllib.request.urlopen(req, timeout=90) as r:return r.read(),r.headers.get('Content-Type',''),r.url
def crawl(cat):
 found={}; pages=[]
 for p in range(1,10):
  url=f'https://space.tpac-taipei.org/download?type={cat}&page={p}'
  data,ct,final=get(url); txt=data.decode('utf8'); rows=re.findall(r'<tr\b[^>]*>(.*?)</tr>',txt,re.S)
  new=0
  for row in rows:
   cells=re.findall(r'<td\b[^>]*>(.*?)</td>',row,re.S)
   for link in re.findall(r'href="([^"]+)"',row):
    if '/storage/' not in link:continue
    link=html.unescape(link); title=html.unescape(re.sub('<[^>]+>','',cells[0])).strip() if cells else link.split('/')[-1]
    if link not in found:
     found[link]={'uid':str(uuid.uuid4()),'title':title,'original_url':link,'source_url':url,'source':'Taipei Performing Arts Center','author':'TPAC technical department; drawing credits retained in original','category':cat,'download_status':'pending'}; new+=1
  pages.append({'url':url,'file_count':new})
  if not new:break
 return list(found.values()),pages
entries=[]; pages=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
 for result in ex.map(crawl,['C','6','1','2','3','4','7']): entries+=result[0];pages+=result[1]
extras=[('Taipei accessibility audit 2022 with floor plans and permits','https://www-ws.gov.taipei/001/Upload/845/relfile/-1/845/62206e85-c090-4add-aeaf-9272234a4b8d.pdf','municipal_accessibility_2022.pdf'),('Municipal building and theatre diagram','https://www-ws.gov.taipei/001/Upload/388/relfile/19519/8544022/aa511de4-9670-429f-933d-24ec52724ca3.pdf','municipal_building_theatre_diagram.pdf')]
for title,url,name in extras:entries.append({'uid':str(uuid.uuid4()),'title':title,'original_url':url,'source_url':url,'source':'Taipei City Government','author':'Taipei City Government; audit architect 李彥輝 where credited','category':'municipal','filename':name,'download_status':'pending'})
# Unique URLs, preserve all categories represented in title/source index
entries=list({x['original_url']:x for x in entries}.values())
for i,e in enumerate(entries,1):
 if 'filename' not in e:
  basename=urllib.parse.unquote(e['original_url'].split('/')[-1]);basename=re.sub(r'[<>:"/\\|?*]','_',basename)
  e['filename']=f'{i:03d}_'+basename
 e['local_path']=str(OUT/e['filename']);e['downloaded_at']='2026-10-14';e['rights']='Public download; copyright retained by original rightsholders; not a public-domain declaration.'
(ROOT/'technical-discovery.json').write_text(json.dumps({'entries':entries,'pages':pages},ensure_ascii=False,indent=2),encoding='utf8')
print('DISCOVERED',len(entries),flush=True)
def download(e):
 try:
  data,ct,url=get(e['original_url']);e['content_type']=ct;e['resolved_url']=url;e['bytes']=len(data)
  if data[:5]==b'%PDF-':fmt='PDF'
  elif data[:4]==b'AC10':fmt='DWG '+data[:6].decode('ascii')
  elif data[:4]==b'PK\x03\x04':fmt='ZIP/OOXML'
  elif data[:8]==b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1':fmt='OLE compound (legacy Office)'
  else:fmt='unverified '+repr(data[:12])
  e['verified_format']=fmt
  if fmt.startswith('unverified'):raise ValueError('Unexpected signature '+fmt)
  path=pathlib.Path(e['local_path']);path.write_bytes(data);e['sha256']=hashlib.sha256(data).hexdigest();e['download_status']='downloaded_verified_signature'
  if fmt=='PDF':
   import fitz
   doc=fitz.open(path);e['pages']=len(doc);text='\n'.join(f'\n--- PAGE {i+1} ---\n'+p.get_text() for i,p in enumerate(doc)); (OUT/(path.stem+'.txt')).write_text(text,encoding='utf8');e['extracted_text_path']=str(OUT/(path.stem+'.txt'))
 except Exception as err:e['download_status']='failed';e['error']=str(err)
 print(e['download_status'],e['filename'],e.get('bytes',0),flush=True)
 return e
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:entries=list(ex.map(download,entries))
(ROOT/'technical-manifest.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2),encoding='utf8')
print('DONE',len(entries),'OK',sum(x['download_status'].startswith('downloaded') for x in entries),flush=True)
