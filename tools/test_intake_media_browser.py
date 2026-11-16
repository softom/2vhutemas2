"""Mocked browser check of the reviewed-media manifest; never accesses user sessions."""
import os, json, mimetypes, base64
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
build=Path(os.environ['INTAKE_UI_BUILD'])
key='11111111-1111-4111-8111-111111111111'
uid='22222222-2222-4222-8222-222222222222'
asset='33333333-3333-4333-8333-333333333333'
revision='44444444-4444-4444-8444-444444444444'
d={'id':key,'title':'Проверка публикации','description':'','status':'ready','reason':'','target_entity_id':None,'version':1,'sources':[],
   'publication_media':[{'id':42,'asset_id':asset,'title':'Проверенная иллюстрация','revision_id':revision,'status':'draft'}],
   'sketch':{'state':'ready','title':'Проверка публикации','type_id':uid,'description':'Описание проекта','sources':[],'questions':[],'matches':[],'related':[],'target_entity_id':None}}
approved=[]; errors=[]
def route(r):
    p=urlparse(r.request.url).path
    if '/media/' in p and p.endswith('/file'):
        r.fulfill(content_type='image/png',body=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='));return
    if p.startswith('/api/v1/'):
        if p.endswith('/site-header'):result={'html':'','footer':'','viewer':{'authenticated':True,'displayName':'Test editor','permissions':['su']}}
        elif p.endswith('/options/types'):result={'items':[{'id':uid,'title_ru':'Здание'}]}
        elif p.endswith('/approve'):
            body=r.request.post_data_json
            assert body['media_manifest']==[f'42:{asset}:{revision}'],body
            approved.append(body);d['status']='done';d['sketch']['state']='published';d['target_entity_id']=123;result=d
        elif '/entity-intake/'+key in p:result=d
        else:result={}
        r.fulfill(json=result);return
    if urlparse(r.request.url).netloc!='localhost:8791':r.abort();return
    f=build/p.lstrip('/')
    if not f.is_file():f=build/'index.html'
    r.fulfill(body=f.read_bytes(),content_type=mimetypes.guess_type(str(f))[0] or 'application/octet-stream')
with sync_playwright() as pw:
    b=pw.chromium.launch(headless=True)
    page=b.new_page(viewport={'width':1100,'height':900})
    page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/*',route)
    page.goto('http://localhost:8791/entity-intake/'+key)
    page.get_by_role('heading',name='Иллюстрации публикации').wait_for()
    picture=page.get_by_role('img',name='Проверенная иллюстрация')
    picture.wait_for();page.wait_for_function('document.querySelector("figure img")?.naturalWidth > 0')
    assert page.get_by_role('button',name='Утвердить и опубликовать').is_disabled()
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.get_by_label('Карточка, иллюстрации и источники проверены').check()
    page.get_by_role('button',name='Утвердить и опубликовать').click()
    page.wait_for_timeout(200)
    assert approved and not errors,(approved,errors)
    print('PASS visible illustration, explicit approval, exact revision manifest, mobile layout, no JS errors')
    b.close()
