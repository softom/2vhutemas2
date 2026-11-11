"""Integration checks against a running API. TOKEN is read from env; no secrets printed.
Creates only UID-tagged test dossiers. Prints cleanup UUIDs even on failure.
"""
import os,json,uuid,urllib.request,urllib.error,copy,concurrent.futures
base=os.environ.get('INTAKE_TEST_API','http://127.0.0.1:7074/api/v1'); token=os.environ['INTAKE_TEST_TOKEN']
ids=[]; passed=0
def call(method,path,data=None,auth=True):
 req=urllib.request.Request(base+path,data=json.dumps(data).encode() if data is not None else None,method=method,headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+token} if auth else {})})
 try:
  with urllib.request.urlopen(req,timeout=30) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:return e.code,json.load(e)
def check(test):
 global passed
 assert test
 passed+=1

def dossier():
 key=str(uuid.uuid4());ids.append(key)
 return dict(id=key,title='SMOKE entity intake '+key,description='Test',status='proposed',reason='',target_entity_id=None,version=0,sources=[dict(id=str(uuid.uuid4()),url='https://example.org/project',title='Source',description='Description from source',publisher='Journal',author='Author',published_at='2026-11-11',media=[dict(id=str(uuid.uuid4()),url='https://example.org/plan.jpg',media_entity_id=None,kind='plan',caption='Plan',author='Photographer',status='link',error='')])])
try:
 check(call('GET','/entity-intake',auth=False)[0]==401)
 d=dossier();status,d=call('POST','/entity-intake',d);check(status==201 and d['version']==1 and len(d['sources'][0]['media'])==1)
 check(call('POST','/entity-intake',d)[1]['version']==1)
 check(call('GET','/entity-intake/'+d['id'])[1]['sources'][0]['media'][0]['caption']=='Plan')
 bad=copy.deepcopy(d);bad['sources'][0]['media'][0]['url']='javascript:alert(1)';check(call('PUT','/entity-intake/'+d['id'],bad)[0]==400)
 bad=copy.deepcopy(d);bad['sources'][0]['media'][0]['media_entity_id']=9223372036854775000;check(call('PUT','/entity-intake/'+d['id'],bad)[0]==400)
 bad=copy.deepcopy(d);bad['status']='done';check(call('PUT','/entity-intake/'+d['id'],bad)[0]==400)
 bad=copy.deepcopy(d);bad['status']='rejected';check(call('PUT','/entity-intake/'+d['id'],bad)[0]==400)
 other=dossier();check(call('POST','/entity-intake',other)[0]==201)
 bad=copy.deepcopy(d);bad['sources'][0]['id']=other['sources'][0]['id'];check(call('PUT','/entity-intake/'+d['id'],bad)[0]==400)
 d['status']='reviewing'
 with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda _:call('PUT','/entity-intake/'+d['id'],d),range(2)))
 check(sorted(s for s,_ in results)==[200,409])
 d=next(v for s,v in results if s==200);check(d['version']==2 and len(d['history'])==1 and d['history'][0]['snapshot']['sources'][0]['media'][0]['caption']=='Plan')
 assets=call('GET','/media?limit=1')[1]['items']
 if assets:
  d['sources'][0]['media'][0]['media_entity_id']=assets[0]['entity_id']
  code,d=call('PUT','/entity-intake/'+d['id'],d);check(code==200 and d['sources'][0]['media'][0]['status']=='stored')
 entities=call('GET','/entities?limit=1')[1]['items'];check(bool(entities));d['target_entity_id']=entities[0]['id'];d['status']='ready'
 code,d=call('PUT','/entity-intake/'+d['id'],d);check(code==200)
 d['status']='done';d['reason']='Test verification';d['confirm_done']=True
 code,d=call('PUT','/entity-intake/'+d['id'],d);check(code==200 and d['target_entity_id']==entities[0]['id'])
 check(call('GET','/entity-intake?q=SMOKE%20entity%20intake')[1]['total']>=2)
 if os.environ.get('INTAKE_TEST_STORY'):
  code,seed=call('GET','/news-robot/intake-seed/'+os.environ['INTAKE_TEST_STORY']);check(code==200 and any(s['media'] for s in seed['sources']))
  ids.append(seed['id']);seed['title']='SMOKE entity intake seed '+seed['id'];check(call('POST','/entity-intake',seed)[0]==201)
 print('PASS',passed,'entity intake integration checks')
finally:
 print('CLEANUP_UUIDS='+json.dumps(ids))
