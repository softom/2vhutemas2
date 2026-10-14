import pathlib,json,uuid,hashlib,fitz,urllib.request,re,html,zipfile
base=pathlib.Path(r'D:/WORK/2Vhutemas/research_notes/Материалы для программы театра Тайчжуна');out=base/'files/technical';out.mkdir(parents=True,exist_ok=True)
url='https://www.npac-ntt.org/venuehire/technical';txt=urllib.request.urlopen(url).read().decode('utf8');(out/'official-technical-page.html').write_text(txt,encoding='utf8')
links=[]
for u,title in re.findall(r'<a[^>]+href=[\"\x27]([^\"\x27]+)[\"\x27][^>]*>(.*?)</a>',txt,re.S):
 if 'getFile' in u:links.append((html.unescape(u),html.unescape(re.sub('<[^>]+>','',title)).strip()))
print('links',len(links));print(links[:3])
root=pathlib.Path(r'D:/WORK/2Vhutemas/WIKI/assets/taichung-national-theater/npac-technical');m=[]
for f in sorted(root.rglob('*')):
 if not f.is_file():continue
 raw=f.read_bytes();fid=f.name.split('__')[-1];found=[(u,t) for u,t in links if fid in u];u=found[0][0] if found else None
 if u and u.startswith('/'):u='https://www.npac-ntt.org'+u
 e={'uid':str(uuid.uuid4()),'title':f.name.split('__')[0],'filename':f.name,'local_path':str(f),'source':'National Taichung Theater / NPAC','author':'NPAC; original drawing credits preserved','source_url':url,'original_url':u,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'category':f.parent.name,'download_status':'existing_file_verified','verified_at':'2026-10-14'}
 if raw.startswith(b'%PDF-'):
  d=fitz.open(f);e['verified_format']='PDF';e['pages']=len(d);p=out/(e['uid']+'.txt');p.write_text('\n'.join('\n--- PAGE '+str(i+1)+' ---\n'+p.get_text() for i,p in enumerate(d)),encoding='utf8');e['extracted_text_path']=str(p)
 elif raw.startswith(b'AC10'):e['verified_format']='DWG '+raw[:6].decode();e['verification_note']='Header only; not opened in CAD'
 elif raw.startswith(b'PK'):
  with zipfile.ZipFile(f) as z:assert z.testzip() is None;e['verified_format']='ZIP';e['archive_members']=z.namelist()
 else:e['verified_format']='unknown'
 m.append(e)
(base/'technical-manifest.json').write_text(json.dumps(m,ensure_ascii=False,indent=2),encoding='utf8')
print('files',len(m),'matched urls',sum(bool(x['original_url']) for x in m),'pdf pages',sum(x.get('pages',0) for x in m))
for e in m:
 if e['verified_format']=='PDF' and any(k in e['title'] for k in ['後台設備','技術手冊','Technical Specifications','使用範圍','共用空間','後台空間']):
  print('\nFILE',e['uid'],e['title'],e['pages']);t=pathlib.Path(e['extracted_text_path']).read_text(encoding='utf8');print(t[:1700])
(base/'technical.md').write_text('# Тайчжун: официальный технический пакет\n\nСтатус: файлы проверены и индексированы, экспликация составляется. Существующие оригиналы не изменены.\n',encoding='utf8')
