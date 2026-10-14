import pathlib,json,uuid,hashlib,pymupdf,urllib.request,re,concurrent.futures,datetime
base=pathlib.Path(r'D:/WORK/2Vhutemas/research_notes/Материалы для программы Тайбэйского центра');manifest=base/'competition-manifest.json';items=json.loads(manifest.read_text(encoding='utf8'))
links=[
('https://www.architw.org.tw/view_article.php?id=2959','Официальные результаты конкурса: три места и выставка','Taiwan Institute of Architects','2009'),
('https://akichiatlas.com/en/archives/taipei_performing_arts.php','Объявление, график и результаты конкурса','AKICHIATLAS','2008–2009'),
('https://bustler.net/competitions/latest/541/taipei-performing-arts-center-international-competition','Объявление конкурса, краткое содержание задания','Bustler / Taipei City Government','2008'),
('https://www.buro-os.com/projects/taipei-performing-arts-center','Конкурс OMA / Rem Koolhaas and Ole Scheeren: 1-я премия, 40 000 м²','Büro Ole Scheeren / OMA','2008–2009'),
('https://www.klcse.com/taipei-performing-art-center.html','Конкурс Ábalos+Sentkiewicz / Ricky Liu: инженерные схемы, 39 125 м²','King-Le Chang & Associates','2009'),
('https://www.archdaily.cl/cl/02-14426/abalossentkiewicz','Ábalos+Sentkiewicz: финалист, галерея проекта, 48 105 м²','ArchDaily / Ábalos+Sentkiewicz','2009-01-29'),
('https://www.designboom.com/architecture/abalos-sentkiewicz-arquitectos-tpac-taipei-performing-art-center-proposal/','Ábalos+Sentkiewicz: планы, визуализации, фасад','Designboom / Ábalos+Sentkiewicz','2009-03-25'),
('https://allieddd.com/projects/taipei-performing-arts-center','Конкурсный проект Allied / Chang-Jo, 421 783 SF','Allied Design & Development / Christine Phung','2008'),
('https://damenpartners.com/projecten/taipei-performing-arts-centre/','Конкурсный проект Dam & Partners','Dam & Partners','2008'),
('https://www.e-architect.com/taiwan/taipei-performing-arts-center-building','NL Architects: конкурсный проект, схемы и изображения','NL Architects / e-architect','2009-03-23'),
('https://www.e-architect.com/taiwan/performing-arts-centre-taipei','Studio Nicoletti: конкурсный проект и изображения','Studio Nicoletti Associates / e-architect','2008-11-03'),
('https://bustler.net/news/616/taipei-performing-arts-center-competition-entry-by-architects-collective','Architects Collective: конкурсный проект и изображения','Architects Collective / Bustler','2008-11-04'),
('https://www.archdaily.com/15785/taipei-performing-arts-center-proposal-by-nl-architects','NL Architects: конкурсный проект, чертежи и схемы','NL Architects / ArchDaily','2009'),
('https://entayang.pixnet.net/blog/posts/7045915538','Каталог выставки: 3 финалиста и 4 поощрительных проекта','Yang En-Ta','2009-03-18'),
('https://www.mvrdv.com/projects/62/taipei-performing-arts-centre','НЕ TPAC: ошибочный slug ведёт к Taipei Pop Music Centre','MVRDV','2009'),
]
for u,t,a,d in links:
 items.append(dict(uid=str(uuid.uuid4()),title=t,author=a,date=d,original_url=u,url=u,relative_path=None,status='excluded_different_project' if 'mvrdv.com' in u else 'link_only',bytes=None,sha256=None))
fam='https://forgemind.net/media/%E5%8F%B0%E5%8C%97%E8%97%9D%E8%A1%93%E4%B8%AD%E5%BF%83taipei-performing-arts-center%E7%AB%B6%E5%9C%96%E7%B5%90%E6%9E%9C%E5%85%AC%E5%B8%83-%E7%94%B1-rem-koolhaas-oma-%E5%8B%9D%E5%87%BA/'
items.append(dict(uid=str(uuid.uuid4()),title='Все 7 премированных проектов: OMA, Morphosis, Ábalos, Jakob+MacFarlane, SURV, MVRDV, ZHA — планы/разрезы/фасады',author='FAM / соответствующие конкурсные бюро',date='2009-02-22',original_url=fam,url=fam,relative_path=None,status='link_only',bytes=None,sha256=None))
for it in items:
 if it['status']=='downloaded' and it['relative_path'].endswith('.pdf'):
  d=pymupdf.open(base/it['relative_path']);it['pdf_pages']=len(d);it['text_layer_characters']=sum(len(pg.get_text()) for pg in d)
  it['verification']='PDF opened in PyMuPDF; programme scans rendered and inspected' if '06-Program' in it['relative_path'] else 'PDF opened in PyMuPDF'
 elif it['status']=='downloaded' and it['relative_path'].endswith('.dwg'):it['verification']='AC10 DWG signature verified; drawing not opened in CAD'
manifest.write_text(json.dumps(items,ensure_ascii=False,indent=2),encoding='utf8')
# programme parts not found: filenames supported by official download checklist
text=(base/'files/competition/00-Download_Check_List(Chinese-and-English).txt').read_text(encoding='utf8')
parts=re.findall(r'06-Program\(Chinese&English\)_P\d+-P\d+\.pdf',text)
have={i['original_url'].rsplit('/',1)[-1] for i in items}
for fn in parts:
 if fn not in have:items.append(dict(uid=str(uuid.uuid4()),title=fn,author='Department of Cultural Affairs, Taipei City Government',date='2008',original_url='http://www.tpac.com.tw/download/'+fn,url='http://www.tpac.com.tw/download/'+fn,relative_path=None,status='not_found_in_archive_index',bytes=None,sha256=None,note='Filename verified against original download checklist; no snapshot in domain-wide CDX index.'))
manifest.write_text(json.dumps(items,ensure_ascii=False,indent=2),encoding='utf8')
# Downloads of seven accessible author-published competition illustrations.
u='https://www.buro-os.com/projects/taipei-performing-arts-center';h=urllib.request.urlopen(u,timeout=20).read().decode();images=list(dict.fromkeys(re.findall(r'data-img="(https://www.buro-os.com/upload/project/[^\"]+)"',h)))
for n,img in enumerate(images,1):
 it=dict(uid=str(uuid.uuid4()),title='OMA / Ole Scheeren — competition illustration '+str(n),author='Rem Koolhaas and Ole Scheeren © OMA',date='2008–2009',source_page=u,original_url=img,url=img,relative_path='files/competition/OMA-Scheeren-competition-'+str(n).zfill(2)+'.jpg',status='pending',bytes=None,sha256=None)
 try:
  data=urllib.request.urlopen(img,timeout=20).read();assert data[:2]==b'\xff\xd8';(base/it['relative_path']).write_bytes(data);it.update(status='downloaded',bytes=len(data),sha256=hashlib.sha256(data).hexdigest(),rights='Author copyright; local research copy, no republication license inferred')
 except Exception as e:it.update(status='download_failed',error=str(e))
 items.append(it);manifest.write_text(json.dumps(items,ensure_ascii=False,indent=2),encoding='utf8')
print('Manifest entries',len(items),'downloads',sum(i['status']=='downloaded' for i in items),'missing programme parts',sum(i['status']=='not_found_in_archive_index' for i in items))
