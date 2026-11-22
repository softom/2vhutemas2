import { useEffect, useState } from "react";
import { request } from "../api";

type Token = {id:string; system_name:string; expires_at:string};
const endpoint="/admin/intake-tokens";

export function IntakeTokens(){
  const [items,setItems]=useState<Token[]>([]);
  const [issued,setIssued]=useState<(Token & {token:string}) | null>(null);
  const [name,setName]=useState("");
  const [days,setDays]=useState(7);
  const [busy,setBusy]=useState(false);
  const [copyStatus,setCopyStatus]=useState("");
  const [error,setError]=useState("");
  useEffect(()=>{
    let live=true;
    request<Token[]>(endpoint).then(rows=>{if(live)setItems(current=>[...current,...rows.filter(row=>!current.some(item=>item.id===row.id))]);})
      .catch(e=>{if(live)setError(e.message);});
    return ()=>{live=false;};
  },[]);
  useEffect(()=>{
    if(!items.length)return;
    const next=Math.min(...items.map(item=>Date.parse(item.expires_at)));
    const timer=setTimeout(()=>{
      setItems(rows=>rows.filter(row=>Date.parse(row.expires_at)>Date.now()));
      setIssued(row=>row && Date.parse(row.expires_at)>Date.now()?row:null);
    },Math.min(2147483647,Math.max(0,next-Date.now()+1)));
    return ()=>clearTimeout(timer);
  },[items]);
  return <section><h2>Токены приёма материалов</h2>
    <p>Система отправляет досье методом POST на <code>/api/v1/incoming-materials</code> с заголовком <code>Authorization: Bearer &lt;токен&gt;</code>.</p>
    <form onSubmit={async e=>{
      e.preventDefault();setBusy(true);setError("");setCopyStatus("");setIssued(null);
      try {
        const row=await request<Token & {token:string}>(endpoint,{method:"POST",body:JSON.stringify({name,days})});
        setItems(rows=>[...rows,{id:row.id,system_name:row.system_name,expires_at:row.expires_at}]);setIssued(row);setName("");
      } catch(e){setError((e as Error).message);} finally{setBusy(false);}
    }}>
      <label>Название системы <input required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label>
      <label> Срок действия <select value={days} onChange={e=>setDays(Number(e.target.value))}>
        {[1,7,30,90].map(n=><option key={n} value={n}>{n} {n===1?"день":"дней"}</option>)}
      </select></label> <button disabled={busy || !name.trim()}>Выдать токен</button>
    </form>
    {issued && <p><label>Скопируйте токен для «{issued.system_name}» <input readOnly value={issued.token} onFocus={e=>e.target.select()}/></label> <button type="button" onClick={async ()=>{
      try {
        await navigator.clipboard.writeText(issued.token);
        setCopyStatus("Скопировано");
      } catch {
        setCopyStatus("Выделите токен и скопируйте вручную");
      }
    }}>Скопировать в буфер обмена</button> <span role="status">{copyStatus}</span> <button onClick={()=>setIssued(null)}>Скрыть</button></p>}
    {error && <p role="alert">{error}</p>}
    <ul>{items.map(item=><li key={item.id}>{item.system_name} · до {new Date(item.expires_at).toLocaleString("ru-RU")}</li>)}</ul>
  </section>;
}
