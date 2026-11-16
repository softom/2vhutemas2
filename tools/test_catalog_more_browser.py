"""Real built client: early SSR click, stalled analytics and complete pagination."""
import asyncio, json, mimetypes, os, re, time
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright

build=Path(os.environ['CATALOG_UI_BUILD'])
source=(Path(__file__).parents[1]/'api/src/routes/pages.ts').read_text(encoding='utf-8')
button=re.search(r'(<button type="button" class="ghost" data-catalog-more .*?</button>)',source).group(1)
def items(first,last):
    return [{'id':n,'slug':f'test-{n}','title_ru':f'Проект {n}','type':'architecture_object','type_title':'Проект',
             'material_status':'published','compact':[{'component':'title'}]} for n in range(first,last+1)]
initial={'branch':'what','page':{'items':items(1,24),'next_cursor':'second'},'chips':[]}
markup='<script type="application/json" id="catalog-initial">'+json.dumps(initial)+'</script><section><h1>Проекты</h1>'
count='<div class="list-count"><span>Показано 24 записи — есть ещё</span>'+button+'</div>'
markup+=count+'<div class="grid catalog-grid"></div>'+count+'</section>'
html=(build/'index.html').read_text(encoding='utf-8').replace('<div id="root"></div>','<div id="root">'+markup+'</div>')
assert 'script async src="https://stat.2vhutemas.ru/script.js"' in html

async def main():
    started=time.monotonic(); calls=[];errors=[];stat=[]
    async with async_playwright() as pw:
        b=await pw.chromium.launch(headless=True);page=await b.new_page()
        page.on('pageerror',lambda e:errors.append(str(e)))
        async def route(r):
            u=urlparse(r.request.url);p=u.path
            if u.netloc=='stat.2vhutemas.ru':
                stat.append(True);await asyncio.sleep(8);stat.append('finished');await r.fulfill(body='',content_type='application/javascript');return
            if p.startswith('/api/v1/'):
                if p=='/api/v1/entities':
                    cursor=parse_qs(u.query).get('cursor',[''])[0];calls.append((cursor,time.monotonic()-started))
                    await asyncio.sleep(.2)
                    data={'items':items(1,24),'next_cursor':'second'} if not cursor else {'items':items(25,48),'next_cursor':'third'} if cursor=='second' else {'items':items(49,51),'next_cursor':None}
                elif p.endswith('/site-header'):data={'html':'','footer':'','viewer':{'authenticated':False,'displayName':'Гость','permissions':[]}}
                elif p.endswith('/capabilities'):data={'entity_types':[],'catalog_hidden_roots':[],'catalog_groups':{}}
                else:data={'items':[]}
                await r.fulfill(json=data);return
            if u.netloc!='localhost:8791':await r.abort();return
            if p=='/objects':await r.fulfill(body=html,content_type='text/html');return
            f=build/p.lstrip('/')
            if not f.is_file():await r.fulfill(status=404,body='');return
            if f.name.startswith('appMount-') and f.suffix=='.js':await asyncio.sleep(2)
            await r.fulfill(body=f.read_bytes(),content_type=mimetypes.guess_type(str(f))[0] or 'application/octet-stream')
        await page.route('**/*',route)
        await page.goto('http://localhost:8791/objects',wait_until='commit')
        await page.get_by_role('button',name='Показать ещё').last.click(no_wait_after=True)
        assert await page.locator('html').get_attribute('data-catalog-more')=='/objects'
        try: await page.get_by_text('Показано 48 записей — есть ещё',exact=True).first.wait_for(timeout=15000)
        except Exception:
            print('DIAGNOSTICS',calls,errors,page.url,flush=True)
            print(await page.evaluate('document.documentElement.outerHTML'),flush=True)
            raise
        assert len(stat)==1  # application works while analytics is stalled
        assert [c[0] for c in calls]==['','second'],calls
        assert calls[0][1]<12,calls
        await page.get_by_role('button',name='Показать ещё').last.click(no_wait_after=True)
        await page.get_by_text('Показано 51 запись',exact=True).first.wait_for()
        assert await page.locator('.catalog-grid .card').count()==51
        assert len(set(await page.locator('.catalog-grid .card').evaluate_all('(nodes)=>nodes.map(n=>n.href)')))==51
        assert await page.get_by_role('button',name='Показать ещё').count()==0
        assert not errors,errors
        print('PASS early SSR click retained; stalled analytics does not block; 24→48→51 unique cards; no JS errors',flush=True)
        await b.close()

asyncio.run(main())
