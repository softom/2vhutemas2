"""No network/LLM: test durable news-to-dossier delivery and retry identity."""
import sys,json,tempfile
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'news-robot'))
from robot import entity_intake as intake
class Api:
 live=True
 def __init__(self):self.fail=True;self.calls=[];self.db={}
 def call(self,method,path,json):
  self.calls.append(json)
  if self.fail:raise RuntimeError('temporary API outage')
  self.db.setdefault(json['id'],json);return self.db[json['id']]
story={'candidate':{'story_key':'petra_heights_granite_highrise_groupwork','title_ru':'Project','sources':[{'url':'https://example.org/project','title':'Source','date':'invalid'}]},'source':{'адрес':'https://example.org/project'},'news':{'title':'Prepared news'},'facts':{'author':'Groupwork'}}
article={'text':'Primary source text','images':[{'url':'https://example.org/photo.jpg','caption':'Project view','credit':'Photographer'}]}
with tempfile.TemporaryDirectory() as folder:
 root=Path(folder);api=Api();logs=[];log=lambda *a,**kw:logs.append((a,kw))
 key=intake.enqueue(root,story,article,{},log,api)
 pending=list((root/'.state/entity_intake_outbox').glob('*.json'));assert len(pending)==1
 payload=json.loads(pending[0].read_text())['payload'];assert payload['sources'][0]['description']=='Primary source text'
 assert payload['sources'][0]['media'][0]['author']=='Photographer';assert payload['sources'][0]['published_at'] is None
 api.fail=False;intake.flush(root,log,api);assert not list((root/'.state/entity_intake_outbox').glob('*.json'))
 assert key in api.db and (root/'.state/entity_intake_sent'/f'{key}.json').is_file()
 assert intake.enqueue(root,story,article,{},log,api)==key and len(api.calls)==2
 assert story['entity_intake_id']==key
 # Lost delivery acknowledgement: resend uses exactly the same dossier UUID.
 (root/'.state/entity_intake_sent'/f'{key}.json').unlink();intake.enqueue(root,story,article,{},log,api);assert len(api.db)==1
 assert intake._url('https://user:secret@example.org/file')==''
 print('PASS source/media provenance, deterministic dossier UUID, persisted failed delivery, retry, regeneration and lost-ack idempotence')
