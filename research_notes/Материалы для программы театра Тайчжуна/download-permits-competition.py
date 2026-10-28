import pathlib,urllib.request,json,hashlib,uuid,datetime,concurrent.futures,re,pymupdf
b=pathlib.Path(r'D:/WORK/2Vhutemas/research_notes/Материалы для программы театра Тайчжуна')
urls=[
('https://www.twarchitect.org.tw/works/臺中國家歌劇院/','author-building-data-2017.html','National Taichung Theater — авторские проектные данные','DAJU Architects + Toyo Ito / 建築師雜誌','2017-03'),
('https://www.toyo-ito.co.jp/WWW/Project_Descript/2015-/2015-p_04/2015-p_04_j.html','toyo-ito-project.html','台中国家歌劇院 — проект','Toyo Ito & Associates','2016'),
('https://www.taichung.gov.tw/8868/8872/9962/956075','city-land-and-coverage-2014.html','Площадь участка, изменённая застройка и FAR','Taichung City Government','2014-10-14'),
('https://www.news.taichung.gov.tw/517186/post','city-gfa-budget-2014.html','Общая площадь и бюджет','Taichung City Government','2014-01-09'),
('https://www.taichung.gov.tw/900975/post','city-tender-area-2009.html','Тендер основных строительных работ: площади','Taichung City Government','2009'),
('https://english.taichung.gov.tw/10273/10554/10719/726459','city-competition-finalists-2005.html','Пять финалистов конкурса2005','Taichung City Government','2005-10-27'),
('https://info.jp.toto.com/gallerma/ex141017/pdf/NR_G_ITO_140822_en.pdf','TOTO-Ito-exhibition-2014.pdf','The Making of the Taichung Metropolitan Opera House2005–2014','TOTO Gallery MA / Toyo Ito','2014-08-22'),
('https://file.moc.gov.tw/Download.ashx?icon=.pdf&n=OGVmY2IwNGEtZGMwZC00N2M3LTk4NTItMTE4NDkxN2ZiODVjLnBkZg%3D%3D&u=LzAwMS9VcGxvYWQvT2xkRmlsZXMvQWRtaW5VcGxvYWRzL2ZpbGVzLzIwMTkwNS84ZWZjYjA0YS1kYzBkLTQ3YzctOTg1Mi0xMTg0OTE3ZmI4NWMucGRm','MOC-2014-evaluation-permit-date.pdf','Итоги2014: разрешение на использование выдано2014-10-30','Ministry of Culture Taiwan','2014'),
('https://volunteers.huludun.taichung.gov.tw/df_ufiles/vol/歌劇院簡介.pdf','city-brochure-2014.pdf','Муниципальная брошюра2014','Taichung City Government','2014-09-12'),
('https://www.geotech.org.tw/upload/column_zone_file/15_20190910104539349.pdf','geotech-construction-history.pdf','臺中國家歌劇院的興建歷程 — строительная история','Taiwan geotechnical engineering publication','2019'),
('https://www.jara-net.com/jara30th/sample/sample11-taichung.pdf','JARA-sample-project.pdf','Публичный образец материалов по проекту; отметка SAMPLE','JARA / Toyo Ito','2010')]
items=[]
for u,fn,t,a,date in urls:items.append(dict(uid=str(uuid.uuid4()),url=u,title=t,author=a,date=date,relative_path='files/permits-competition/'+fn,status='pending',bytes=None,sha256=None))
manifest=b/'permits-competition-manifest.json'
def save():manifest.write_text(json.dumps(items,ensure_ascii=False,indent=2),encoding='utf8')
save()
def fetch(i):
 try:
  u=urllib.parse.quote(i['url'],safe=':/?=&%+');req=urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'})
  with urllib.request.urlopen(req,timeout=30) as r:data=r.read();i['resolved_url']=r.url;i['content_type']=r.headers.get('Content-Type')
  p=b/i['relative_path']
  if p.suffix=='.pdf':
   assert data.startswith(b'%PDF');doc=pymupdf.open(stream=data,filetype='pdf');i['pages']=len(doc);txt='\n'.join('=== PDF PAGE '+str(n+1)+' ===\n'+pg.get_text() for n,pg in enumerate(doc));p.with_suffix('.txt').write_text(txt,encoding='utf8')
  p.write_bytes(data);i.update(status='downloaded',bytes=len(data),sha256=hashlib.sha256(data).hexdigest())
 except Exception as e:i.update(status='failed',error=str(e))
 return i
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
 for i in pool.map(fetch,items):save();print(i['status'],i['relative_path'],i.get('error',''),flush=True)
save()
