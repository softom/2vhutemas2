"""Editor research UI with mocked API; no user session or paid providers."""
import os,json,mimetypes
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect
build=Path(os.environ['INTAKE_UI_BUILD']);errors=[];writes=[];starts=[];seeds=[]
revision='44444444-4444-4444-8444-444444444444';uid='22222222-2222-4222-8222-222222222222';key='11111111-1111-4111-8111-111111111111'
entity={'id':123,'type':'architecture_object','title_ru':'Saved building','slug':'saved','latest_revision_id':revision,'published_revision_id':revision,'material_id':uid,'material_status':'published','body_json':[{'id':'body','type':'paragraph','content':[{'type':'text','text':'Original text','styles':{}}],'children':[]}],'indicators':[],'tags':[],'media':[]}
d={'id':key,'title':'Saved building','status':'ready','version':1,'target_entity_id':123,'sources':[],'publication_media':[],
 'sketch':{'state':'ready','title':'Saved building','type_id':uid,'description':'Research supplement','sources':[],'questions':[],'matches':[],'related':[],'target_entity_id':123}}
research={'state':'ready','summary':'Result','consensus':'medium','sources':[],'findings':[{'id':'finding','kind':'style','title':'Verified proposal','relation':'positive','level':'style','phase':'1976','zone':'body','rationale':'Evidence','source_ids':[],'entity_id':None,'selected':False}]}
def route(r):
 p=urlparse(r.request.url).path
 if p.startswith('/api/v1/'):
  if r.request.method!='GET':writes.append((p,r.request.post_data_json))
  if p.endswith('/site-header'):result={'html':'','footer':'','viewer':{'authenticated':True,'displayName':'Test','permissions':['su']}}
  elif p.endswith('/capabilities'):result={'entity_types':[{'id':uid,'code':'architecture_object','title_ru':'Здание','parent':None}],'presentations':{'architecture_object':{'editor':[{'component':'title'},{'component':'text'}]}}}
  elif p.endswith('/me'):result={'permissions':['su']}
  elif p.endswith('/entities/123'):result=entity
  elif p.endswith('/external-descriptions/123'):result={'items':[{'id':'external','url':'https://example.org/source','title':'External source','excerpt':'Saved excerpt','provider':'Yandex','evidence':'snippet','observations_count':2}],'total':1}
  elif p.endswith('/from-entity/123'):
   seeds.append(r.request.post_data_json);assert seeds[-1]=={'base_revision_id':revision};result=d
  elif p.endswith('/research'):
   starts.append(r.request.post_data_json)
   if len(starts)==1:r.fulfill(status=503,json={'error':{'message':'Test unavailable'}});return
   d['sketch']['research']=research;d['version']+=1;result=d
  elif p.endswith('/sketch'):
   incoming=r.request.post_data_json;assert incoming['sketch']['research_selected_ids']==['finding']
   research['findings'][0]['selected']=True;d['version']+=1;result=d
  elif p.endswith('/entity-intake/'+key):result=d
  else:result={'items':[]}
  r.fulfill(json=result);return
 if urlparse(r.request.url).netloc!='localhost:8791':r.abort();return
 f=build/p.lstrip('/');f=f if f.is_file() else build/'index.html'
 r.fulfill(body=f.read_bytes(),content_type=mimetypes.guess_type(str(f))[0] or 'application/octet-stream')
with sync_playwright() as pw:
 b=pw.chromium.launch(headless=True);page=b.new_page(viewport={'width':1160,'height':900})
 page.route('**/*',route);page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://localhost:8791/entities/123/edit')
 title=page.get_by_label('Название по-русски',exact=True);title.wait_for();title.fill('Unsaved human title')
 page.locator('.bn-editor').click();page.keyboard.press('Control+End');page.keyboard.type(' Unsaved human paragraph')
 page.get_by_role('button',name='Исследование стиля…',exact=True).first.click()
 page.get_by_role('link',name='External source',exact=True).wait_for()
 page.get_by_role('button',name='Исследовать стиль и морфологию',exact=True).click()
 page.get_by_role('alert').filter(has_text='Test unavailable').wait_for()
 assert title.input_value()=='Unsaved human title' and 'Unsaved human paragraph' in page.locator('.bn-editor').inner_text()
 page.get_by_role('button',name='Исследовать стиль и морфологию',exact=True).click()
 page.get_by_label('Verified proposal',exact=True).click()
 expect(page.get_by_label('Verified proposal',exact=True)).to_be_checked()
 page.get_by_role('link',name='Открыть эскиз для проверки и утверждения ↗').wait_for()
 assert page.get_by_role('link',name='Открыть эскиз для проверки и утверждения ↗').get_attribute('target')=='_blank'
 page.get_by_role('button',name='Скрыть исследование').click()
 page.get_by_role('button',name='Исследование стиля…',exact=True).first.click()
 page.get_by_role('button',name='Исследовать стиль и морфологию',exact=True).click()
 page.get_by_label('Verified proposal',exact=True).wait_for()
 assert len(starts)==2 and len(seeds)==2,(starts,seeds)
 assert all('/entity-intake/' in p or p.endswith('/session') for p,_ in writes),writes
 assert title.input_value()=='Unsaved human title' and 'Unsaved human paragraph' in page.locator('.bn-editor').inner_text()
 assert not errors,errors
 print('PASS editor button, unsaved title/text preserved, API-only writes, error/retry, saved selection, reopen without duplicate paid call')
 b.close()


