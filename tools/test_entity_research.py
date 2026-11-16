"""Existing-entity research entry: isolated database, no paid providers."""
from pathlib import Path
exec(Path(__file__).with_name('test_intake_relations.py').read_text().split('source=')[0])
assert DB=='codex_entity_research_test'
assert sql('select current_database()')==DB
body=[{'id':str(uuid.uuid4()),'type':'paragraph','content':[{'type':'text','text':'Original human text','styles':{}}],'children':[]}]
payload={'type':'architecture_object','slug':'smoke-research-'+uuid.uuid4().hex,'title_ru':'Research fixture','body_json':body}
entity=ok(call('POST','/entities',payload),201);eid=entity['id'];revision=entity['revision_id']
path='/entity-intake/from-entity/'+str(eid);data={'base_revision_id':revision}
assert call('POST',path,data,auth=False)[0]==401
assert call('POST',path,{'base_revision_id':str(uuid.uuid4())})[0]==409
d=ok(call('POST',path,data))
assert d['sketch']['state']=='ready' and d['target_entity_id']==eid
assert d['sketch']['target_entity_id']==eid and d['sketch']['target_revision_id']==revision
assert 'Original human text' in d['sources'][0]['description']
assert 'Original human text' not in d['sketch']['description']
assert ok(call('POST',path,data))['id']==d['id']
assert sql(f'select working_revision_id from app.entities where id={eid}')==revision
assert sql(f'select is_published from app.entities where id={eid}')=='f'
print('PASS guest denial, version conflict, saved context, idempotency, no entity write or publication')
# A newer saved revision receives its own dossier; old evidence remains intact.
updated=ok(call('PATCH','/entities/'+str(eid),{**payload,'base_revision_id':revision,'title_ru':'Changed fixture'}))
assert call('POST',path,data)[0]==409
new=ok(call('POST',path,{'base_revision_id':updated['revision_id']}))
assert new['id']!=d['id']
assert ok(call('GET','/entity-intake/'+d['id']))['sketch']['title']=='Research fixture'
assert call('POST','/entity-intake/'+d['id']+'/approve',{'version':d['version'],'confirm':True,'media_manifest':[]})[0]==409
# Existing publication mechanism adds only reviewed supplement, preserving original.
research={'state':'ready','job':str(uuid.uuid4()),'sources':[{'id':str(uuid.uuid4()),'url':'https://example.org/retained-description','title':'External description','excerpt':'Retained search excerpt','provider':'fixture','evidence':'snippet'}],'findings':[]}
sql("update app.entity_intake set sketch=jsonb_set(sketch,'{research}','"+json.dumps(research)+"'::jsonb) where id='"+new['id']+"'")
published=ok(call('POST','/entity-intake/'+new['id']+'/approve',{'version':new['version'],'confirm':True,'media_manifest':[]}))
sources_path='/entity-intake/external-descriptions/'+str(eid)
assert call('GET',sources_path,auth=False)[0]==401
sources=ok(call('GET',sources_path));assert sources['total']==1 and sources['items'][0]['excerpt']=='Retained search excerpt'
assert ok(call('GET',sources_path+'?page=1'))['items']==[]
result=ok(call('GET','/entities/'+str(eid)))
text=json.dumps(result['body_json'],ensure_ascii=False)
assert text.count('Original human text')==1,text
assert 'Исследование стиля и морфологии' in text
assert result['title_ru']=='Changed fixture'
current=sql(f'select working_revision_id from app.entities where id={eid}')
again=ok(call('POST',path,{'base_revision_id':current}))
assert again['id']!=new['id'] and published['status']=='done'
print('PASS separate revision dossiers, stale approval refused, original text/title retained, published dossier immutable')
ok(call('POST','/entities/'+str(eid)+'/archive',{'base_revision_id':current}))
assert call('POST',path,{'base_revision_id':current})[0]==404
print('PASS archived entity refused')
assert call('GET',sources_path)[0]==404
# A brand-new entity receives saved search results once approval assigns its ID.
key=str(uuid.uuid4())
fresh=ok(call('POST','/entity-intake',{'id':key,'title':'New researched fixture','status':'proposed','sources':[{'id':str(uuid.uuid4()),'url':'https://example.org/retained-description','title':'Source','description':'Evidence','media':[]}]}),201)
sk={**new['sketch'],'title':'New researched fixture','target_entity_id':None,'target_revision_id':None,'research':research}
sql("update app.entity_intake set status='ready',sketch='"+json.dumps(sk).replace("'","''")+"'::jsonb where id='"+key+"'")
created=ok(call('POST','/entity-intake/'+key+'/approve',{'version':fresh['version'],'confirm':True,'media_manifest':[]}))
assert created['target_entity_id']!=eid
assert ok(call('GET','/entity-intake/external-descriptions/'+str(created['target_entity_id'])))['total']==1
print('PASS source API permissions/pagination and association after creating a new entity')

