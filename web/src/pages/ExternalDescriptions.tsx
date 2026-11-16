import { useEffect, useState } from 'react';
import { intake } from '../intake';

export function ExternalDescriptions({entityId,revision}:{entityId:number;revision?:number}){
 const [page,setPage]=useState(0),[data,setData]=useState<Awaited<ReturnType<typeof intake.externalDescriptions>>|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  let live=true;setError('');
  intake.externalDescriptions(entityId,page).then(v=>{if(live)setData(v);}).catch(e=>{if(live)setError(e.message);});
  return()=>{live=false;};
 },[entityId,page,revision]);
 return <section aria-label="Внешние описания сущности"><h3>Внешние описания сущности{data?' ('+data.total+')':''}</h3>
  <p>Сохранённые URL и поисковые выдержки. Это материалы исследования, а не подтверждённые выводы или полные тексты страниц.</p>
  {error&&<p role="alert">{error}</p>}
  {data?.items.length?<div style={{overflowX:'auto'}}><table><thead><tr><th>Источник / URL</th><th>Выдержка</th><th>Поиск</th></tr></thead><tbody>{data.items.map(s=><tr key={s.id}>
   <td style={{overflowWrap:'anywhere',minWidth:180}}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title||s.url}</a><small style={{display:'block'}}>{s.url}</small></td>
   <td style={{minWidth:220}}>{s.excerpt}</td><td>{s.provider}<br/>{s.evidence==='snippet'?'Поисковая выдержка':'Материал досье'}<br/>Сохранённых наблюдений: {s.observations_count}</td>
  </tr>)}</tbody></table></div>:data&&<p>Сохранённых внешних описаний пока нет. Они появятся после поиска.</p>}
  {data&&data.total>50&&<div className="row"><button type="button" disabled={!page} onClick={()=>setPage(page-1)}>Предыдущие источники</button><span>{page+1}</span><button type="button" disabled={(page+1)*50>=data.total} onClick={()=>setPage(page+1)}>Следующие источники</button></div>}
 </section>;
}
