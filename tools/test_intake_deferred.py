"""Regression on isolated codex_intake_relations_test only; includes relation baseline."""
from pathlib import Path
import runpy, concurrent.futures
globals().update(runpy.run_path(str(Path(__file__).with_name('test_intake_relations.py'))))

def get(d): return ok(call('GET','/entity-intake/'+d['id']))

def pending(kind='author', reason='Verified deferred source'):
 d=fixture()
 r={'kind':kind,'name':'Deferred candidate','entity_id':None,'confirmed':False,
    'role_id':role if kind=='author' else None,'source_url':source,'reason':reason,'matches':[]}
 d=ok(save(d,[r]))
 d=ok(call('POST',f"/entity-intake/{d['id']}/relation-candidate",{'version':d['version'],'index':0}))
 child=ok(call('GET','/entity-intake/'+d['sketch']['related'][0]['candidate_intake_id']))
 sk={**d['sketch'],'title':'Deferred child','related':[],
     'type_id':sql('select type_id from app.entities where id='+str(author['id'] if kind=='author' else place['id']))}
 sql("update app.entity_intake set status='ready',sketch='"+json.dumps(sk).replace("'","''")+"'::jsonb where id='"+child['id']+"'")
 return d,get(child)

def assert_link(d,child):
 d=get(d);r=d['sketch']['related'][0]
 assert r['entity_id']==child['target_entity_id'] and r['confirmed'],d
 assert len(d['sketch']['applied_relations'])==1,d
 assert sql(f"select count(*) from app.links where from_entity_id={d['target_entity_id']} and to_entity_id={child['target_entity_id']} and role_id='{role}' and status='published'")=='1'

# Saving edited prose with a pending candidate succeeds; publication is independent.
d,child=pending();d['sketch']['description']='Human edit preserved'
d=ok(save(d,d['sketch']['related']));assert d['sketch']['description']=='Human edit preserved'
parent=ok(approve(d));assert parent['sketch']['applied_relations']==[]
assert not parent['sketch']['related'][0]['entity_id']
child=ok(approve(child));assert_link(parent,child)
ok(approve(child));ok(approve(parent));assert_link(parent,child)
print('PASS save pending candidate, parent-first approval, automatic link, retry without duplicates')

d,child=pending();child=ok(approve(child));assert get(d)['status']=='ready'
d=ok(call('POST',f"/entity-intake/{d['id']}/relation-candidate",{'version':d['version'],'index':0,'resolve':True}))
assert not d['sketch']['related'][0]['confirmed']
parent=ok(approve(d));assert_link(parent,child)
print('PASS child-first approval, including previously refreshed candidate')

d,child=pending()
with concurrent.futures.ThreadPoolExecutor(2) as pool:
 results=list(pool.map(lambda x:ok(approve(x)),[d,child]))
assert_link(results[0],results[1])
print('PASS concurrent approval of both ends')

# A malformed deferred proposal does not undo either entity's publication.
d,child=pending(reason='');parent=ok(approve(d));child=ok(approve(child))
parent=get(parent);assert parent['status']=='done'
assert parent['sketch']['related'][0]['deferred_error']
assert parent['sketch']['applied_relations']==[]
print('PASS invalid deferred evidence retained with visible error')

# Removing the proposal before approval cancels the pending link, not the child.
d,child=pending();d=ok(save(d,[]));parent=ok(approve(d));child=ok(approve(child))
assert get(parent)['sketch']['applied_relations']==[]
print('PASS removed proposal stays removed')

# Place is an entity-valued parameter and must receive a new published snapshot.
d,child=pending('place');parent=ok(approve(d));before=sql(f"select published_revision_id from app.entities where id={parent['target_entity_id']}")
child=ok(approve(child));parent=get(parent)
assert parent['sketch']['related'][0]['entity_id']==child['target_entity_id']
assert sql(f"select published_revision_id from app.entities where id={parent['target_entity_id']}")!=before
assert sql(f"select count(*) from app.indicator_values v join app.indicators i on i.id=v.indicator_id join app.parameters p on p.id=v.parameter_id where i.entity_id={parent['target_entity_id']} and p.code='address' and v.entity_value_id={child['target_entity_id']}")=='1'
ok(approve(parent));assert len(get(parent)['sketch']['applied_relations'])==1
print('PASS deferred place, published snapshot, idempotence')
