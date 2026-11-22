import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { request } from "../api";

export function AdminNav() {
  return <nav className="filters" aria-label="Разделы администрирования">
    {[
      ["/access-users","Доступ"],
      ["/access-users/users","Пользователи"],
      ["/materials","Файловая система Папки"],
    ].map(([to,label]) => <NavLink key={to} end to={to} style={({isActive})=>({
      fontWeight:isActive ? 700 : 500, textDecoration:isActive ? "underline" : undefined,
      textUnderlineOffset:"0.3em", padding:"0.35rem 0.6rem"
    })}>{label}</NavLink>)}
  </nav>;
}

type User = { id:string; display_name:string; status:string };
export function AdminUsers() {
  const [users,setUsers]=useState<User[] | null>(null);
  const [error,setError]=useState("");
  useEffect(()=>{
    let live=true;
    request<User[]>("/admin/users").then(rows=>{if(live)setUsers(rows);})
      .catch(e=>{if(live)setError(e.message);});
    return ()=>{live=false;};
  },[]);
  return <><h1>Пользователи</h1>{error ? <p role="alert">{error}</p> : users===null ? <p>Загрузка…</p> :
    <ul>{users.map(u=><li key={u.id}>{u.display_name} · {u.status==="active"?"Активен":"Отключён"}</li>)}</ul>}</>;
}
