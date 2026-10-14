from pathlib import Path
import requests,json
from bs4 import BeautifulSoup
p=Path('research_notes/Материалы для программы Тайбэйского центра/files/architecture');u='https://www.gooood.cn/taipei-performing-arts-center-oma.htm';r=requests.get(u,timeout=40);r.raise_for_status();(p/'gooood.html').write_bytes(r.content);s=BeautifulSoup(r.content,'html.parser');rows=[]
for x in s.find_all('img'):
 st=str(x)
 if any(z in st.lower() for z in ['plan','section','elevation','drawing']): rows.append(dict(x.attrs))
(p/'gooood-images-selected.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(rows,ensure_ascii=False)[:13000])
