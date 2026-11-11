import sys,tempfile,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'news-robot'))
from robot import similar
log=lambda *a,**k:None
class LLM:
 live=True
 def __init__(self,same):self.same=same;self.requests=[]
 def chat_json(self,*a,**k):self.requests.append(json.loads(a[2]));return {'pairs':[{'n':0,'same':self.same}]}
for verdict in [False,True,'false']:
 with tempfile.TemporaryDirectory() as d:
  root=Path(d);(root/'.state').mkdir();similar.embed=lambda texts,cfg,s:[[1.,0.] for t in texts]
  old={'key':'old','title':'Project','text':'Project','context':'Project nearing completion'}
  similar.match([old],root,{},None,log)
  llm=LLM(verdict);new={'key':'new','title':'Project','text':'Project','context':'Project opened'}
  aliases=similar.match([new],root,{},llm,log)
  assert ('new' in aliases)==(verdict is True)
  assert 'opened' in llm.requests[0][0]['a'] and 'nearing completion' in llm.requests[0][0]['b']
  similar._note(root,aliases={'new':{'to':'old','by':'review'}})
  assert similar.match([new],root,{},None,log)['new']['to']=='old'
print('PASS high similarity requires event verdict; context used; string false rejected; aliases survive cached vectors')
