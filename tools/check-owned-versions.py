"""Integration test for Р-78. Run on server against isolated API by default.
Tokens stay in memory. Created entity IDs printed for explicit fixture cleanup.
"""
import argparse,base64,hashlib,hmac,json,time,uuid,urllib.request,urllib.error
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:17073');a=p.parse_args()
secret=dict(line.split('=',1) for line in Path('/opt/2vhutemas/.env').read_text().splitlines() if '=' in line)['JWT_SECRET']
b64=lambda b:base64.urlsafe_b64encode(b).rstrip(b'=')
head=b64(json.dumps({'alg':'HS256','typ':'JWT'}).encode());now=int(time.time())
payload=b64(json.dumps({'sub':'e6777073-6cae-46b5-8d48-a499e188f230','role':'authenticated','iat':now,'exp':now+900}).encode())
signed=head+b'.'+payload
token=(signed+b'.'+b64(hmac.new(secret.encode(),signed,hashlib.sha256).digest())).decode()
count=0;created=[]
def req(path,method='GET',data=None,auth=True,status=200):
 global count
 headers={'Content-Type':'application/json'}
 if auth:headers['Authorization']='Bearer '+token
 r=urllib.request.Request(a.base+path,data=json.dumps(data).encode() if data is not None else None,headers=headers,method=method)
 try:
  with urllib.request.urlopen(r,timeout=20) as resp:code=resp.status;raw=resp.read().decode()
 except urllib.error.HTTPError as e:code=e.code;raw=e.read().decode()
 assert code==status,(path,code,raw[:600]);count+=1
 try:return json.loads(raw)
 except ValueError:return raw

def body(text):return [{'id':'paragraph','type':'paragraph','content':[{'type':'text','text':text,'styles':{}}]}]
def assert_body(value,text):
 assert value['body_json']==body(text),value
suffix=uuid.uuid4().hex[:10]
try:
 x=req('/api/v1/entities','POST',{'type':'what','slug':'r78-'+suffix,'title_ru':'R78 initial '+suffix,'body_json':body('public A'), 'tags':['r78-'+suffix], 'indicators':[{'title':'Data','values':[{'parameter':'typology','text_value':'old value'}]}]},status=201);created.append(x['id']);eid=x['id'];mid=x['material_id'];v1=x['revision_id']
 req('/api/v1/entities/'+str(eid),auth=False,status=404)
 req('/api/v1/materials/'+mid+'/publish','POST',{'revision_id':v1})
 g=req('/api/v1/entities/'+str(eid),auth=False);assert_body(g,'public A');assert g['title_ru']=='R78 initial '+suffix
 v2=req('/api/v1/entities/'+str(eid),'PATCH',{'base_revision_id':v1,'title_ru':'R78 working '+suffix,'body_json':body('private B'), 'tags':['r78-working-'+suffix], 'indicators':[{'title':'Data','values':[{'parameter':'typology','text_value':'new value'}]}]})['revision_id']
 g=req('/api/v1/entities/'+str(eid),auth=False);assert_body(g,'public A');assert g['title_ru']=='R78 initial '+suffix;assert g['indicators'][0]['values'][0]['text_value']=='old value'
 assert_body(req('/api/v1/entities/'+str(eid)),'private B')
 assert not req('/api/v1/entities?q=R78%20working%20'+suffix,auth=False)['items']
 history=req('/api/v1/entities/'+str(eid)+'/versions')['items'];assert any(v['id']==v1 and v['is_public'] for v in history);assert any(v['id']==v2 and v['is_working'] for v in history)
 req('/api/v1/entities/'+str(eid)+'/versions',auth=False,status=403)
 html=req('/entities/r78-'+suffix,auth=False);assert 'public A' in html and 'private B' not in html and 'new value' not in html
 req('/api/v1/entities/'+str(eid),'PATCH',{'base_revision_id':v1,'body_json':body('stale')},status=409)
 # Invalid complete save rolls back title and body together.
 req('/api/v1/entities/'+str(eid),'PATCH',{'base_revision_id':v2,'title_ru':'BROKEN','body_json':body('bad'),'indicators':[{'values':[{'parameter':'no-such-parameter','text_value':'bad'}]}]},status=400)
 assert req('/api/v1/entities/'+str(eid))['title_ru']=='R78 working '+suffix
 req('/api/v1/materials/'+mid+'/publish','POST',{'revision_id':v2},auth=False,status=401)
 req('/api/v1/materials/'+mid+'/publish','POST',{'revision_id':v2})
 g=req('/api/v1/entities/'+str(eid),auth=False);assert_body(g,'private B');assert g['indicators'][0]['values'][0]['text_value']=='new value'
 # Rollback publication doesn't overwrite the latest working snapshot.
 req('/api/v1/materials/'+mid+'/publish','POST',{'revision_id':v1})
 assert_body(req('/api/v1/entities/'+str(eid),auth=False),'public A')
 assert_body(req('/api/v1/entities/'+str(eid)),'private B')
 # Another entity/version cannot be published as ours.
 y=req('/api/v1/entities','POST',{'type':'what','slug':'r78-other-'+suffix,'title_ru':'R78 other','body_json':body('other')},status=201);created.append(y['id'])
 req('/api/v1/materials/'+mid+'/publish','POST',{'revision_id':y['revision_id']},status=400)
 req('/api/v1/materials/'+y['material_id']+'/publish','POST',{})
 l=req('/api/v1/links','POST',{'from_entity_id':eid,'to_entity_id':y['id'],'justification':{'text':'pages 42-43'}},status=201)
 assert not any(z['id']==l['id'] for z in req('/api/v1/links?entity_id='+str(eid),auth=False)['items'])
 req('/api/v1/materials/'+l['material_id']+'/publish','POST',{})
 assert any(z['justification']=='pages 42-43' for z in req('/api/v1/links?entity_id='+str(eid),auth=False)['items'])
 req('/api/v1/documents','POST',{'attach_to_entity_id':eid,'body':body('separate')},status=409)
 # Every non-text change preserves text and creates a complete working version.
 req('/api/v1/tags/entities/'+str(eid),'PUT',{'tags':['r78-component-'+suffix]})
 assert_body(req('/api/v1/entities/'+str(eid)),'private B')
 assert_body(req('/api/v1/entities/'+str(eid),auth=False),'public A')
 # A real existing card round-trip in TEST DATABASE ONLY; production is read-only here.
 if ':17073' in a.base:
  museum=req('/api/v1/entities/muzey-terrakotovoy-armii');old_values=[v for i in museum['indicators'] for v in i['values']]
  req('/api/v1/entities/'+str(museum['id']),'PATCH',{'base_revision_id':museum['latest_revision_id'],'body_json':museum['body_json'],'indicators':museum['indicators'],'tags':[t['title'] for t in museum['tags']]})
  after=req('/api/v1/entities/'+str(museum['id']));assert [v for i in after['indicators'] for v in i['values']]==old_values,'Parameter fields lost on round trip'

 req('/api/v1/materials/'+mid,'DELETE',status=204)
 req('/api/v1/entities/'+str(eid),auth=False,status=404)
 req('/api/v1/materials/'+mid+'/publish','POST',{'revision_id':v2})
 assert_body(req('/api/v1/entities/'+str(eid),auth=False),'private B')
 print('PASS',count,'requests; atomic saves, public/working isolation, conflicts, rollback, link bases, ownership, archive')
finally:
 print('FIXTURE_ENTITIES',json.dumps(created))
