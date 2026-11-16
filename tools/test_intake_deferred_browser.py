from pathlib import Path
import mimetypes,copy
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
import os
build=Path(os.environ.get('INTAKE_UI_BUILD','repo/.cache/intake-deferred-ui/dist'));db={};errors=[]
type_id='00000000-0000-4000-8000-000000000001'
def route(r):
 u=urlparse(r.request.url);p=u.path
 if '/api/v1/' in p:
  if 'site-header' in p:data={'html':'','footer':'','viewer':{'authenticated':True,'displayName':'Editor','permissions':['su']}}
  elif p.endswith('/options/relations'):data={'roles':[{'id':type_id,'title_ru':'Архитектор'}],'items':[]}
  elif p.endswith('/options/types'):data={'items':[{'id':type_id,'title_ru':'Здание'}]}
  elif '/entity-intake' in p:
   key=p.split('/entity-intake')[-1].strip('/').split('/')[0]
   if r.request.method=='POST' and p.endswith('/entity-intake'):
    data=r.request.post_data_json;data['version']=1;db[data['id']]=data
   elif p.endswith('/prepare'):
    data=db[key];data['version']+=1;data['status']='ready';data['sketch']={'state':'ready','title':data['title'],'type_id':type_id,'description':'Архитектурное описание проекта. [1]','sources':[{'url':'https://example.org/project','title':'Сайт автора','description':'Описание проекта'}],'questions':['Проверить дату завершения'],'matches':[],'target_entity_id':None,'related':[{'kind':'author','name':'Автор проекта','matches':[{'id':22,'title_ru':'Автор проекта','is_published':True}],'role_id':type_id,'reason':'Проект указан в портфолио автора','source_url':'https://example.org/project','confirmed':False},{'kind':'place','name':'Место объекта','matches':[{'id':33,'title_ru':'Место объекта','is_published':True}],'reason':'Адрес указан в источнике','source_url':'https://example.org/project','confirmed':False}],'catalog_checks':[{'name':'archINFORM','domain':'archinform.net','status':'unavailable','note':'Страница недоступна','urls':[]}]}
   elif p.endswith('/relation-candidate'):

    if r.request.post_data_json.get('resolve'):
     r.fulfill(status=400,json={'error':{'code':'validation_failed','message':'Кандидат ещё не опубликован'}});return
    data=db[key];i=r.request.post_data_json['index'];row=data['sketch']['related'][i];row['candidate_intake_id']='11111111-1111-4111-8111-111111111111';data['version']+=1
    if r.request.post_data_json.get('resolve'):row.update(entity_id=33,title='Место объекта',is_published=True)
   elif p.endswith('/sketch'):
    data=db[key];assert r.request.post_data_json['version']==data['version'];data['sketch']=r.request.post_data_json['sketch'];data['version']+=1
   elif p.endswith('/approve'):
    data=db[key];data['status']='done';data['sketch']['state']='published';data['target_entity_id']=123
   elif key:data=db[key]
   else:data={'items':[],'total':0}
  else:data={}
  r.fulfill(json=copy.deepcopy(data));return
 if u.netloc!='localhost:8791':r.abort();return
 f=build/p.lstrip('/')
 if not f.is_file():f=build/'index.html'
 r.fulfill(body=f.read_bytes(),content_type=mimetypes.guess_type(str(f))[0] or 'application/octet-stream')
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe',headless=True)
 page=b.new_page(viewport={'width':1280,'height':1000});page.route('**/*',route);page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://localhost:8791/entity-intake?tab=work&filter=needs_info')
 page.get_by_role('navigation',name='Подменю стека сущностей').get_by_role('link',name='Нужно уточнение',exact=True).wait_for()
 assert page.get_by_role('link',name='Нужно уточнение',exact=True).get_attribute('aria-current')=='page'
 page.reload()
 assert page.get_by_role('link',name='Нужно уточнение',exact=True).get_attribute('aria-current')=='page'
 page.get_by_role('navigation',name='Разделы стека сущностей').get_by_role('link',name='2 Подготовленные').click()
 assert 'tab=ready' in page.url
 page.get_by_role('navigation',name='Разделы стека сущностей').get_by_role('link',name='+ Добавить').click()
 page.get_by_label('Название объекта').fill('Архитектурный проект')
 page.get_by_label('Источник 1',exact=True).fill('https://example.org/project')
 page.get_by_role('button',name='+ Источник',exact=True).click();page.get_by_label('Источник 2',exact=True).fill('https://example.org/architect')
 page.get_by_role('navigation',name='Разделы стека сущностей').get_by_role('link',name='1 В работе').click()
 assert page.url.endswith('/new')
 page.get_by_role('alert').filter(has_text='Сначала сохраните').wait_for()
 page.get_by_role('button',name='Подготовить эскиз',exact=True).click();page.get_by_role('heading',name='Эскиз',exact=True).wait_for()
 page.get_by_label('Описание',exact=True).fill('Исправленное описание объекта. [1]')
 assert page.get_by_role('button',name='Утвердить и опубликовать').is_disabled()
 assert page.locator('.intake-relation-row').count()==2
 assert page.locator('dialog[open]').count()==0
 page.locator('.intake-relation-row').nth(0).get_by_role('button',name='Прикрепить',exact=True).click()
 page.get_by_label('Запись в БД 1',exact=True).select_option('22')
 page.get_by_label('Подтвердить связь 1',exact=True).check()
 page.locator('dialog[open]').get_by_role('button',name='Закрыть',exact=True).click()
 page.locator('.intake-relation-row').nth(1).get_by_role('button',name='Создать в стеке',exact=True).click()
 page.locator('.intake-relation-row').nth(1).get_by_role('link',name='Кандидат в стеке ↗').wait_for()
 page.get_by_label('Описание',exact=True).fill('Правки перед неудачным обновлением кандидата')
 page.locator('.intake-relation-row').nth(1).get_by_role('button',name='Обновить',exact=True).click()
 page.get_by_role('alert').filter(has_text='Кандидат ещё не опубликован').wait_for()
 assert page.get_by_role('button',name='Сохранить правки').is_disabled()
 page.get_by_text('Правки сохранены.',exact=True).wait_for()
 page.get_by_label('Описание',exact=True).fill('Следующие правки после ошибки')
 page.get_by_role('button',name='Сохранить правки').click()
 page.get_by_text('Правки сохранены.',exact=True).wait_for()
 assert list(db.values())[0]['sketch']['description']=='Следующие правки после ошибки'
 page.get_by_label('Карточка и источники проверены').check()
 page.get_by_role('button',name='Утвердить и опубликовать').click()
 page.get_by_role('heading',name='Отложенные связи',exact=True).wait_for()
 page.get_by_role('button',name='Повторить привязку',exact=True).wait_for()
 page.set_viewport_size({'width':390,'height':844})
 assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
 assert not errors,errors
 print('PASS pending candidate save/publication, retained version after failed resolve, deferred links, mobile layout; no JS errors')
 b.close()
