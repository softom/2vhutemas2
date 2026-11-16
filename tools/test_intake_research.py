"""Research lifecycle/approval on isolated DB only; never invokes a paid provider."""
from pathlib import Path
import time
code=Path(__file__).with_name('test_intake_relations.py').read_text()
exec(code.split('relations=[relation')[0])
assert DB=='codex_intake_style_test', 'Run only the staged copy adapted to the isolated style DB'

d=fixture(); route='/entity-intake/'+d['id']
assert call('POST',route+'/research',{'version':d['version']},auth=False)[0]==401
assert call('POST',route+'/research',{'version':-1})[0]==409
before=d['sketch']['description']
started=ok(call('POST',route+'/research',{'version':d['version']}),202)
assert started['sketch']['research']['state']=='running'
for _ in range(50):
    current=ok(call('GET',route))
    if current['sketch']['research']['state']!='running': break
    time.sleep(.1)
assert current['sketch']['research']['state']=='error',current
assert current['sketch']['description']==before
assert len(current['history'])>=2
print('PASS guest denied, stale version, persisted job, safe failure, prose/history retained')

source_uid=str(uuid.uuid4());finding_uid=str(uuid.uuid4())
research={'state':'ready','job':str(uuid.uuid4()),'model':'fixture','prepared_at':'2026-11-16T20:00:00Z',
 'summary':'Разные строительные фазы','consensus':'split','warnings':[],
 'phases':[{'period':'1976','description':'Оригинал','zones':['body']}],
 'sources':[{'id':source_uid,'url':source,'title':'Evidence','excerpt':'Evidence excerpt','provider':'fixture','evidence':'snippet'}],
 'findings':[{'id':finding_uid,'kind':'style','title':'Брутализм','relation':'negative','level':'стиль','phase':'1976','zone':'body','rationale':'Отрицание в источнике','source_ids':[source_uid],'entity_id':None,'selected':False}]}
sql("update app.entity_intake set sketch=jsonb_set(sketch,'{research}','"+json.dumps(research).replace("'","''")+"'::jsonb) where id='"+d['id']+"'")
d=ok(call('GET',route)); original=d['version']
assert call('POST',route+'/research',{'version':original})[0]==400
d['sketch']['research_selected_ids']=['invented']
assert save(d,[])[0]==400
d['sketch']['research_selected_ids']=[finding_uid]
d['sketch']['research']['sources'][0]['url']='https://forged.example/'
d['sketch']['description']='Human prose retained'
d=ok(save(d,[]))
assert d['sketch']['research']['sources'][0]['url']==source
assert d['sketch']['research']['findings'][0]['selected']
assert call('PUT',route+'/sketch',{'version':original,'sketch':d['sketch']})[0]==409
assert sql("select count(*) from app.entities where slug='entity-"+d['id']+"'")=='0'
p=ok(approve(d)); entity=p['target_entity_id']
body=json.dumps(ok(call('GET','/entities/'+str(entity),auth=False))['body_json'],ensure_ascii=False)
assert 'Human prose retained' in body and 'Отрицание атрибуции' in body and '1976' in body and source in body,body
assert ok(approve(p))['target_entity_id']==entity
assert call('POST',route+'/research',{'version':p['version']})[0]==400
print('PASS UID-only selection, forged evidence ignored, version conflict, no early write, full publication, retry')

d=fixture();route='/entity-intake/'+d['id']
sql("update app.entity_intake set sketch=jsonb_set(sketch,'{research}','"+json.dumps({'state':'running','job':str(uuid.uuid4()),'started_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())})+"'::jsonb) where id='"+d['id']+"'")
d=ok(call('GET',route))
assert approve(d)[0]==409 and save(d,[])[0]==409
print('PASS approval and editing blocked during active research')

# Changing identity cannot publish research about the previous object.
d=fixture();route='/entity-intake/'+d['id']
research['findings'][0]['selected']=True
sql("update app.entity_intake set sketch=jsonb_set(sketch,'{research}','"+json.dumps(research).replace("'","''")+"'::jsonb) where id='"+d['id']+"'")
d=ok(call('GET',route));d['sketch']['title']='Different object';d=ok(save(d,[]))
assert d['sketch']['research']['state']=='stale'
p=ok(approve(d));body=json.dumps(ok(call('GET','/entities/'+str(p['target_entity_id']),auth=False))['body_json'],ensure_ascii=False)
assert 'Отрицание атрибуции' not in body
print('PASS changed identity invalidates previous research selection')
