from pathlib import Path
from bs4 import BeautifulSoup
import requests,json
b=Path('research_notes/Материалы для программы Тайбэйского центра/files/architecture')
urls={'oma-book':'https://www.oma.com/publications/the-metropolitan-stage-taipei-performing-arts-center','tw-structure':'https://www.twarchitect.org.tw/special/臺北表演藝術中心的結構實踐/','tw-hvac':'https://www.twarchitect.org.tw/special/北藝中心的空調挑戰/','arup-journal':'https://www.arup.com/projects/the-arup-journal/the-arup-journal-2022-issue-2/','ducks':'https://ducks.fr/en/projet/performing-art-center-2/'}
for key,u in urls.items():
 try:
  r=requests.get(u,timeout=40);r.raise_for_status();(b/(key+'.html')).write_bytes(r.content);s=BeautifulSoup(r.content,'html.parser');print(key,[(x.get('href'),x.get_text(strip=True)[:45]) for x in s.find_all('a') if '.pdf' in x.get('href','')]);print(key,'imgs',[(x.get('src','')[:150],x.get('data-srcset','')[:150]) for x in s.find_all('img') if '202207' in x.get('src','') or key=='oma-book']);(b/(key+'-images.json')).write_text(json.dumps([dict(x.attrs) for x in s.find_all('img')],ensure_ascii=False,indent=2),encoding='utf-8')
 except Exception as e: print(key,str(e))
