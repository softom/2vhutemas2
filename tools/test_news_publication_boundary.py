"""News publication must never create/publish catalog objects or links."""
import sys,types,copy
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'news-robot'))
fetch=types.ModuleType('robot.fetch');fetch.USER_AGENT='test';sys.modules['robot.fetch']=fetch
from robot import publish as p
class Api:
 def __init__(self):self.calls=[]
 def call(self,method,path,**kw):
  self.calls.append((method,path,kw));return {'id':900,'revision_id':1,'published_revision_id':2}
class LLM:
 live=True
 def chat_json(self,*a,**kw):raise AssertionError('News must not extract/create catalog entities')
log=lambda *a,**kw:None
api=Api();rec={'story_key':'test','story':{'news':{'title':'News'},'candidate':{}}}
p.create_draft(api,rec,{'date':'2026-11-11','time':'12:00'},log,LLM())
assert len(api.calls)==1 and api.calls[0][1]=='/entities' and api.calls[0][2]['json']['type']=='news'
assert p.link_entities(api,LLM(),rec,log)==[] and len(api.calls)==1
legacy={'created':[{'id':2815,'published':False},{'id':2816,'published':False}],'links':[1692,1693]}
rec['entities']=copy.deepcopy(legacy);api.calls=[]
p.publish(api,rec,log)
assert [(m,path) for m,path,_ in api.calls]==[('POST','/entities/900/publish')]
assert rec['entities']==legacy
print('PASS draft creates news only; no catalog LLM/mutations; legacy objects and links are not published; news publication preserved')
