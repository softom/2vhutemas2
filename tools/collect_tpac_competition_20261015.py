"""Continue TPAC competition collection in its canonical object folder."""
from pathlib import Path
from urllib.parse import urljoin, urlsplit, quote
from concurrent.futures import ThreadPoolExecutor
from bs4 import BeautifulSoup
from PIL import Image
import requests, json, hashlib, uuid, html, re, io

STORE=Path('E:/Dropbox/2VHUTEMAS/ЧТО/ПРОЕКТЫ')
OBJ=next(p for p in STORE.iterdir() if 'Тайбэйский центр' in p.name)
BASE=OBJ/'research_notes/Конкурсные проекты и документы Тайбэя'
BASE.mkdir(parents=True,exist_ok=True)
def write(p,t):
 p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(t.encode('utf-8'))
def uid(s):return str(uuid.uuid5(uuid.NAMESPACE_URL,s))
def fetch(url,path,title):
 rec={'uid':uid(url),'url':url,'title':title,'local_path':None,'status':'unavailable'}
 try:
  if path.exists(): data=path.read_bytes()
  else:
   r=requests.get(url,timeout=30);r.raise_for_status();data=r.content
   path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
  if path.suffix.lower() in ['.jpg','.jpeg','.png','.webp']:
   with Image.open(io.BytesIO(data)) as im:rec['dimensions']=[im.width,im.height];im.verify()
  rec.update(local_path=path.relative_to(BASE).as_posix(),status='saved',bytes=len(data),sha256=hashlib.sha256(data).hexdigest())
 except Exception as e:rec['error']=str(e)[:240]
 return rec

# Placement is only asserted when supported by the archived official results.
rows=[
 ('bu','B+U','Предложение; дата подачи и официальный результат не установлены','https://www.evolo.us/taipei-performing-arts-center-bu/','evolo','Проект, найденный пользователем. Публикация 29.11.2010; сама дата публикации не доказывает дату конкурсной подачи.'),
 ('ojanen','Ojanen Chiou Architects','Конкурсное предложение; награда не установлена','https://www.ocarch.net/portfolio-civic-cultural/taipei-performing-arts-center','ojanen','Авторская страница: планы первого, второго и четвёртого уровней, разрезы и концептуальные схемы.'),
 ('apicella','Apicella + Bunton','Конкурсное предложение; награда не установлена','https://www.apicellabunton.com/project/taipei-performing-arts-center/','apicella','Авторская страница подтверждает участие; три зала и приподнятый общественный парк.'),
 ('nl','NL Architects','Конкурсное предложение, не финалист','https://www.e-architect.com/taiwan/taipei-performing-arts-center-building','taipei','Публикация проекта бюро. Три театральных объёма подняты над общественной площадью.'),
 ('nicoletti','Studio Nicoletti Associates','Конкурсное предложение, не финалист','https://www.e-architect.com/taiwan/performing-arts-centre-taipei','taipei','Публикация 03.11.2008; проект под общим покрытием. Иллюстрации на странице могут включать сравнительное изображение OMA.'),
 ('morphosis','Morphosis + J.J. Pan','Финалист, 2-е место','https://www.e-architect.com/taiwan/taipei-performing-arts-center-morphosis','taipei','Публикация материалов второй стадии, команда и консультанты. Отдельные планы и разрезы доступны через публикации конкурсного проекта.'),
 ('abalos','Ábalos + Sentkiewicz','Финалист, 3-е место','https://www.archdaily.com/12843/abalossentkiewicz-project-for-the-taipei-performing-arts-centre','adsttc','Галерея конкурсного предложения второй стадии: планы, разрезы, модели и визуализации.'),
 ('jakob','Jakob + MacFarlane','Поощрение первого тура','https://www.designboom.com/architecture/jakob-macfarlane-dominique-jakob-tpac-taipei-performing-art-center-proposal/','taipei','Конкурсное предложение; степень детализации определяется сохранёнными иллюстрациями.'),
 ('oma','OMA','Победитель, 1-е место','https://www.archdaily.com/12728/oma-wins-competition-for-the-taipei-performing-arts-centre','adsttc','Конкурсная версия 2009 года для сравнения с альтернативами; отличается по стадии от построенного здания.'),
]
RESULT='files/documents/second-result-en.html'
FIRST='files/documents/first-result-en.html'
projects=[]
previous=json.loads((BASE/'projects.json').read_text(encoding='utf-8')) if (BASE/'projects.json').exists() else []
previous_files={f['url']:f['local_path'] for p in previous for f in p['files'] if f.get('local_path')}
def collect(row):
 slug,architect,status,url,pattern,note=row
 folder=BASE/'files/proposals'/slug
 page=fetch(url,folder/'source.html',architect+' — публикация')
 project={'uid':uid('tpac2008/'+slug),'architect':architect,'status':status,'source_url':url,'note':note,'files':[page],'images':[]}
 if page['status']!='saved':return project
 soup=BeautifulSoup((folder/'source.html').read_bytes(),'html.parser')
 scope=soup.select_one('article') or soup.select_one('main') or soup
 candidates={}
 for im in scope.select('img'):
  alt=im.get('alt','')
  vals=[im.get(k) for k in ['data-src','data-original','src'] if im.get(k)]
  # Only use URLs actually supplied by the source page, not guessed high-res paths.
  for val in vals:
   u=urljoin(url,val)
   if not u.startswith('http') or 'data:' in val:continue
   low=(u+' '+alt).lower()
   eligible=(pattern in low or (pattern=='evolo' and ('taipei' in low or 'b+u' in low)) or (pattern=='apicella' and any(x in low for x in ['taipei','tpac'])))
   if pattern=='evolo':eligible=('taipei' in low or 'b+u' in low)
   if pattern=='ojanen':eligible='taipei-performing-arts' in low
   if pattern=='adsttc':eligible='images.adsttc.com/media/images/' in u
   if slug=='nicoletti':eligible=eligible and ('sna031108' in u or 'nicoletti' in low)
   if slug in ['nicoletti','morphosis','nl'] and re.search(r'-\d+x\d+\.',u):continue
   if not eligible or any(x in low for x in ['logo','avatar','loader','banner']):continue
   key=urlsplit(u).path
   candidates.setdefault(key,(u,alt))
 if slug in ['abalos','jakob']:
  extra=BASE/'files/finalists'/f'{slug}-images.json'
  if extra.exists():
   for im in json.loads(extra.read_text(encoding='utf-8-sig')):
    u=im['url']
    if (slug=='abalos' and '/media/images/55e6/' in u) or (slug=='jakob' and '/jake' in u):
     candidates.setdefault(urlsplit(u).path,(u,im.get('alt','')))
 # Prioritize named plans and sections before renders; retain a bounded visual set.
 ordered=sorted(candidates.values(),key=lambda x:0 if re.search('plan|section|planta|corte|elevation',x[0]+' '+x[1],re.I) else 1)[:18]
 for i,(u,alt) in enumerate(ordered,1):
  ext=Path(urlsplit(u).path).suffix.lower()
  if ext not in ['.jpg','.jpeg','.png','.webp','.gif']:ext='.jpg'
  path=BASE/previous_files[u] if u in previous_files else folder/(uid(u)[:12]+ext)
  rec=fetch(u,path,alt or Path(urlsplit(u).path).name)
  rec['credit']=architect+' / '+url
  if rec['status']=='saved':
   if min(rec.get('dimensions',[0,0]))<100:continue
   project['images'].append(rec)
  project['files'].append(rec)
 print(architect,len(project['images']),'images',flush=True)
 return project
with ThreadPoolExecutor(max_workers=4) as pool:projects=list(pool.map(collect,rows))
for name in ['MVRDV + Artech Architects','SURV Associates / Hung-an Yeh','Zaha Hadid Architects']:
 projects.append({'uid':uid('tpac2008/'+name),'architect':name,'status':'Поощрение первого тура','source_url':'https://www.e-architect.com/taiwan/performing-arts-centre-taipei','note':'Статус подтверждён списком первого тура. Самостоятельный комплект чертежей в этом проходе не получен.','files':[],'images':[]})
write(BASE/'projects.json',json.dumps(projects,ensure_ascii=False,indent=2)+'\n')
docs=json.loads((BASE/'documents-manifest.json').read_text(encoding='utf-8-sig'))
for d in docs:
 if d.get('local_path'):
  p=BASE/d['local_path'];d['local_verified']=p.is_file() and (not d.get('sha256') or hashlib.sha256(p.read_bytes()).hexdigest()==d['sha256'])
write(BASE/'documents-verified.json',json.dumps(docs,ensure_ascii=False,indent=2)+'\n')
esc=html.escape
style='body{font:16px/1.55 system-ui;max-width:1300px;margin:auto;padding:35px;background:#f5f2eb;color:#263c35}h1{font-size:42px}a{color:#12665b}input{font:inherit;padding:12px;width:95%}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:20px}.card{padding:22px;background:white;border:1px solid #ddd;border-radius:10px}.images{display:grid;grid-template-columns:1fr 1fr;gap:8px}.images img{width:100%;height:180px;object-fit:contain}small{color:#60736a}.notice{padding:18px;background:#fff0ce}table{width:100%;border-collapse:collapse;background:white}td,th{text-align:left;padding:12px;border-bottom:1px solid #ddd}.scroll{overflow:auto}'
body='<h1>Конкурсные проекты и документы Тайбэя</h1><p>TPAC · конкурс 2008–2009 · проверка 15 октября 2026</p><p><a href="../../index.html">Все материалы объекта</a> · <a href="../'+quote('Материалы для программы Тайбэйского центра')+'/index.html">Прежний исследовательский каталог</a></p>'
body+='<p>Сопоставлены 12 проектных позиций, включая победителя. Сохранённые иллюстрации и страницы показаны ниже; отсутствие изображения не означает отсутствие участия.</p><div class="notice">Три финалиста: OMA, Morphosis, Ábalos + Sentkiewicz. Четыре поощрения: Jakob + MacFarlane, SURV, MVRDV + Artech, Zaha Hadid. B+U опубликован в 2010 году: точная конкурсная подача пока не установлена. DOS Architects с датой 2010 и другим описанием участка не включён. Страница MVRDV с адресом «taipei-performing-arts-centre» сейчас описывает Pop Music Centre — её изображения не присвоены TPAC.</div>'
body+='<p>Основания: <a href="'+RESULT+'">архивный результат второго тура</a> · <a href="'+FIRST+'">результат первого тура</a> · <a href="files/documents/architw-official-results.html">сообщение организатора</a>.</p><input id="q" placeholder="Найти бюро или статус"><h2>Проекты</h2><div class="cards">'
for p in projects:
 body+='<section class="card"><h2>'+esc(p['architect'])+'</h2><b>'+esc(p['status'])+'</b><p>'+esc(p['note'])+'</p><p><a href="'+esc(p['source_url'])+'">Источник</a> · '+str(len(p['images']))+' сохранённых иллюстраций</p><div class="images">'
 for im in p['images']:
  u=quote(im['local_path']);body+='<a href="'+u+'" title="'+esc(im['title'])+'"><img loading="lazy" src="'+u+'" alt="'+esc(im['title'])+'"></a>'
 body+='</div><small>Авторство: '+esc(p['architect'])+'; источник — публикация по ссылке. Изображения открываются в полном сохранённом размере.</small></section>'
body+='</div><h2>Документы конкурса</h2><p>RFP, дополнения, договор, регистрационные формы, Q&A, исправления, DWG участка и части Programme. Полная Programme не восстановлена: сохранено 48 страниц из 225; отсутствие страниц нельзя заменять сведениями о построенном здании. Недостающая таблица с продолжением программы на стр.115 требует дальнейшего поиска.</p><div class="scroll"><table><tr><th>Документ</th><th>Состояние</th><th>Источник</th></tr>'
for d in docs:
 title=esc(d['title']);local=d.get('local_verified',False)
 if local:title='<a href="'+quote(d['local_path'])+'">'+title+'</a>'
 body+='<tr><td>'+title+'</td><td>'+('Локально проверен' if local else 'Не получен')+'</td><td><a href="'+esc(d['url'])+'">Источник / архив</a></td></tr>'
body+='</table></div><p><a href="projects.json">Реестр проектов</a> · <a href="documents-verified.json">Реестр документов</a>. Новые материалы сохранены в папке объекта на Dropbox. Оригиналы, авторство и источники сохранены; разрешение на перепубликацию изображений не предполагается автоматически.</p>'
write(BASE/'index.html','<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Конкурс TPAC</title><style>'+style+'</style>'+body+'<script>document.querySelector("#q").addEventListener("input",e=>document.querySelectorAll(".card").forEach(c=>c.hidden=!c.textContent.toLowerCase().includes(e.target.value.toLowerCase())))</script></html>')
report='# Конкурсные проекты и документы Тайбэя\n\n15 октября 2026. [Интерактивный каталог](../research_notes/Конкурсные%20проекты%20и%20документы%20Тайбэя/index.html).\n\n'
report+='В подборке 12 проектных позиций; '+str(sum(len(p['images']) for p in projects))+' сохранённых иллюстраций. OMA — победитель, Morphosis — второе место, Ábalos + Sentkiewicz — третье. Четыре поощрения первого тура: Jakob + MacFarlane, SURV, MVRDV + Artech, Zaha Hadid.\n\n'
for p in projects:report+='- **'+p['architect']+'** — '+p['status']+'. '+p['note']+' [Источник]('+p['source_url']+').\n'
report+='\n## Документы\n\nВосстановлены RFP и дополнение, договор, формы, вопросы и ответы, исправления, DWG участка, результаты обоих туров и часть Programme. Programme неполная: 48/225 страниц. Локальная сохранность каждого документа проверена по реестру; недоступные адреса не выданы за скачанные.\n\n[Организатор — результаты](https://www.architw.org.tw/view_article.php?id=2959), [объявление и жюри](https://www.architw.org.tw/view_article.php?id=2781).\n\nB+U опубликован eVolo 29.11.2010, но точная дата подачи не подтверждена. Не смешаны Taipei Pop Music Centre и TPAC. DOS2010 вынесен за рамки до проверки. Это исследовательская подборка, не полный архив всех 136 конкурсных заявок.\n'
write(OBJ/'reports/Конкурсные проекты и документы Тайбэя.md',report)
print(json.dumps({'projects':len(projects),'images':sum(len(p['images']) for p in projects),'documents_verified':sum(d.get('local_verified',False) for d in docs),'catalog':str(BASE/'index.html')},ensure_ascii=False))
