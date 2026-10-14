from pathlib import Path
import requests,json
from bs4 import BeautifulSoup
base=Path('research_notes/Материалы для программы Тайбэйского центра/files/architecture');base.mkdir(parents=True,exist_ok=True)
urls={'twarchitect':'https://www.twarchitect.org.tw/works/臺北表演藝術中心/','archdaily':'https://www.archdaily.com/981894/taipei-performing-arts-center-oma','record':'https://www.architecturalrecord.com/articles/15951-at-omas-taipei-performing-arts-center-building-as-public-performance','anc':'https://anc.masilwide.com/2167','oma':'https://www.oma.com/projects/taipei-performing-arts-center','arup':'https://www.arup.com/projects/taipei-performing-arts-centre/'}
for key,url in urls.items():
 try:
  r=requests.get(url,timeout=45);r.raise_for_status();(base/(key+'.html')).write_bytes(r.content)
  soup=BeautifulSoup(r.content,'html.parser'); imgs=[dict(x.attrs) for x in soup.find_all('img')];(base/(key+'-images.json')).write_text(json.dumps(imgs,ensure_ascii=False,indent=2),encoding='utf-8');print(key,len(r.content),json.dumps(imgs[-15:],ensure_ascii=False)[:12000])
 except Exception as e:print(key,str(e))
