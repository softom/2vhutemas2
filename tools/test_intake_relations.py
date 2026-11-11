"""Integration test: ONLY isolated codex_intake_relations_test, never live data."""
import os,json,uuid,subprocess,urllib.request,urllib.error
DB='codex_intake_relations_test';base='http://127.0.0.1:17057/api/v1';token=os.environ['INTAKE_TEST_TOKEN']
def sql(query):
 p=subprocess.run(['docker','exec','-i','-e','PGPASSWORD='+os.environ['TEST_DB_PASSWORD'],'supa_db','psql','-U','supabase_admin','-d',DB,'-At','-v','ON_ERROR_STOP=1'],input=query,text=True,capture_output=True)
 assert p.returncode==0,p.stderr
 return p.stdout.strip()
def call(method,path,data=None,auth=True):
 req=urllib.request.Request(base+path,data=json.dumps(data).encode() if data is not None else None,method=method,headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+token} if auth else {})})
 try:
  with urllib.request.urlopen(req,timeout=30) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:return e.code,json.load(e)
def ok(result,code=200):
 assert result[0]==code,result
 return result[1]
def fixture(target=None):
 key=str(uuid.uuid4());d=ok(call('POST','/entity-intake',{'id':key,'title':'SMOKE relations '+key,'description':'','status':'proposed','reason':'','sources':[{'id':str(uuid.uuid4()),'url':source,'title':'Source','description':'','media':[]}]}),201)
 sk={'state':'ready','title':d['title'],'type_id':type_id,'description':'Isolated fixture','sources':[{'url':source,'title':'Source','description':'Fixture evidence'}],'questions':[],'matches':[],'related':[],'target_entity_id':target,'target_revision_id':sql('select working_revision_id from app.entities where id='+str(target)) if target else None}
 text=json.dumps(sk).replace("'","''");sql("update app.entity_intake set status='ready',sketch='"+text+"'::jsonb where id='"+key+"';")
 return ok(call('GET','/entity-intake/'+key))
def save(d,related):
 sk={**d['sketch'],'related':related};return call('PUT','/entity-intake/'+d['id']+'/sketch',{'version':d['version'],'sketch':sk})
def approve(d):return call('POST','/entity-intake/'+d['id']+'/approve',{'version':d['version'],'confirm':True})
source='https://example.org/fixture'
assert sql('select current_database()')==DB
roles=ok(call('GET','/entity-intake/options/relations'))['roles'];role=roles[0]['id']
author=json.loads(sql("with recursive t as(select id from app.entity_types where code='who' union all select c.id from app.entity_types c join t on c.parent_id=t.id) select row_to_json(e) from (select id,title_ru from app.entities where type_id in(select id from t) and is_published order by id limit 1)e"))
place=json.loads(sql("select row_to_json(e) from(select e.id,e.title_ru from app.entities e join app.entity_types t on t.id=e.type_id where t.code='place' and e.is_published order by e.id limit 1)e"))
type_id=sql("select id from app.entity_types where code='architecture_object'")
def relation(kind,entity):return {'kind':kind,'name':entity['title_ru'],'entity_id':entity['id'],'role_id':role if kind=='author' else None,'confirmed':True,'source_url':source,'reason':'Verified fixture source','matches':[]}
relations=[relation('author',author),relation('place',place)]
d=fixture();key=d['id']
assert call('GET','/entity-intake/options/relations',auth=False)[0]==401
assert save(d,[{**relations[0],'entity_id':place['id']}])[0]==400
assert save(d,[{**relations[0],'source_url':'https://unlisted.example/'}])[0]==400
assert save(d,[{**relations[0],'reason':''}])[0]==400
assert save(d,[relations[0],relations[0]])[0]==400
assert save(d,[relations[1],relations[1]])[0]==400
d=ok(save(d,relations));assert all(r['base_revision_id'] for r in d['sketch']['related'])
published=ok(approve(d));entity_id=published['target_entity_id'];assert ok(approve(d))['target_entity_id']==entity_id
assert len(published['sketch']['applied_relations'])==2
assert sql(f"select count(*) from app.links where from_entity_id={entity_id} and to_entity_id={author['id']} and role_id='{role}' and status='published'")=='1'
assert sql(f"select count(*) from app.indicator_values v join app.indicators i on i.id=v.indicator_id join app.parameters p on p.id=v.parameter_id where i.entity_id={entity_id} and p.code='address' and v.entity_value_id={place['id']}")=='1'
assert ok(call('GET',f'/entities/{entity_id}',auth=False))['is_published']
assert any(int(l['to_entity_id'])==author['id'] for l in ok(call('GET',f'/links?entity_id={entity_id}',auth=False))['items'])
# Reusing the same relations does not duplicate them or replace existing prose.
d2=fixture(entity_id);d2=ok(save(d2,relations));pub2=ok(approve(d2));assert all(r['reused'] for r in pub2['sketch']['applied_relations'])
# Unconfirmed selections remain proposals.
d3=fixture();d3=ok(save(d3,[{**relations[0],'confirmed':False}]));p3=ok(approve(d3));assert p3['sketch']['applied_relations']==[]
# A stale related entity blocks ALL publication, including creation of the owner.
d4=fixture();d4=ok(save(d4,relations));sql("update app.entity_intake set sketch=jsonb_set(sketch,'{related,0,base_revision_id}',to_jsonb('00000000-0000-4000-8000-000000000001'::text)) where id='"+d4['id']+"'")
assert approve(d4)[0]==409
assert sql("select count(*) from app.entities where slug='entity-"+d4['id']+"'")=='0'
# Existing different address is never overwritten.
d5=fixture(entity_id)
other=sql("select e.id from app.entities e join app.entity_types t on t.id=e.type_id where t.code='place' and e.is_published and e.id<>"+str(place['id'])+" limit 1")
if other:
 d5=ok(save(d5,[relation('place',{'id':int(other),'title_ru':'Other place'})]));before=sql(f'select working_revision_id from app.entities where id={entity_id}');assert approve(d5)[0]==409;assert sql(f'select working_revision_id from app.entities where id={entity_id}')==before
assert ok(call('GET','/entity-intake/options/catalogs'))['items'][0]['domain']=='archinform.net'
print('PASS relation matching/validation, evidence, explicit confirmation, published author link and place UID, atomic rollback, duplicate reuse, unconfirmed omission, stale target and address conflict; catalog registry available')
