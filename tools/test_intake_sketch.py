"""Full sketch workflow. Run ONLY against an isolated test database/API.
Uses configured search model once; publishes a fixture only in that isolated DB.
"""
import os,json,uuid,time,urllib.request,urllib.error,concurrent.futures
base=os.environ['INTAKE_TEST_API'];token=os.environ['INTAKE_TEST_TOKEN']
assert ':17056/' in base, 'This test publishes a fixture: isolated API required'
def call(method,path,data=None,auth=True):
 req=urllib.request.Request(base+path,data=json.dumps(data).encode() if data is not None else None,method=method,headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+token} if auth else {})})
 try:
  with urllib.request.urlopen(req,timeout=30) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:return e.code,json.load(e)
def ok(code,body,expected=200):
 assert code==expected,(code,body)
 return body
key=str(uuid.uuid4())
d=ok(*call('POST','/entity-intake',dict(id=key,title='Берлинская филармония',description='',status='proposed',reason='',target_entity_id=None,sources=[dict(id=str(uuid.uuid4()),url='https://www.berliner-philharmoniker.de/en/about-us/philharmonie/',title='',description='',publisher='',author='',published_at=None,media=[])])),201)
assert call('POST',f'/entity-intake/{key}/approve',{'version':d['version'],'confirm':True})[0]==400
r=ok(*call('POST',f'/entity-intake/{key}/prepare',{'version':d['version']}),202)
assert call('PUT',f'/entity-intake/{key}',r)[0]==409
for i in range(70):
 time.sleep(3);d=ok(*call('GET',f'/entity-intake/{key}'))
 if d['sketch']['state']!='running':break
assert d['sketch']['state']=='ready',d.get('sketch')
print('PASS preparation with web search, sources and simple URL input',flush=True)
s=d['sketch'];assert s['description'] and s['sources'] and s['type_id']
s['title']='SMOKE isolated sketch '+key;s['target_entity_id']=None
old=d['version'];d=ok(*call('PUT',f'/entity-intake/{key}/sketch',{'version':old,'sketch':s}))
assert call('POST',f'/entity-intake/{key}/approve',{'version':old,'confirm':True})[0]==409
assert call('POST',f'/entity-intake/{key}/approve',{'version':d['version'],'confirm':False})[0]==400
payload={'version':d['version'],'confirm':True}
with concurrent.futures.ThreadPoolExecutor(2) as pool: results=list(pool.map(lambda _:call('POST',f'/entity-intake/{key}/approve',payload),range(2)))
for c,v in results:ok(c,v)
assert results[0][1]['target_entity_id']==results[1][1]['target_entity_id']
d=results[0][1];assert d['status']=='done'
entity=ok(*call('GET','/entities/'+str(d['target_entity_id']),auth=False));assert entity['is_published']
assert call('PUT',f'/entity-intake/{key}',d)[0]==400
print('PASS editing, stale-version rejection, explicit approval, atomic publication, idempotent concurrent approval, public entity and completed dossier protection',flush=True)
print('ISOLATED_FIXTURE='+key)
