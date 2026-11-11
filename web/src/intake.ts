import { request } from "./api";
export const INTAKE_STATUS: Record<string,string> = {proposed:"Предложено",reviewing:"На проверке",needs_info:"Требует уточнения",ready:"Готово к внесению",done:"Внесено",rejected:"Отклонено"};
export interface IntakeMedia {id:string;url:string;media_entity_id:number|null;kind:string;caption:string;author:string;status:string;error:string}
export interface IntakeSource {id:string;url:string;title:string;description:string;publisher:string;author:string;published_at:string|null;media:IntakeMedia[]}
export interface Dossier {id:string;title:string;description:string;status:string;reason:string;target_entity_id:number|null;version:number;sources:IntakeSource[];history?:{at:string;by:string;snapshot:Dossier}[];confirm_done?:boolean}
export interface IntakeRow {id:string;title:string;status:string;version:number;updated_at:string;target_entity_id:number|null;sources_count:number;media_count:number}
export const intake = {
 list:(q="",status="",page=0)=>request<{items:IntakeRow[];total:number}>(`/entity-intake?${new URLSearchParams({q,status,page:String(page)})}`),
 get:(id:string)=>request<Dossier>(`/entity-intake/${id}`),
 save:(d:Dossier)=>{const {history: _history,...input}=d;return request<Dossier>(`/entity-intake${d.version?"/"+d.id:""}`,{method:d.version?"PUT":"POST",body:JSON.stringify(input)});},
 seed:(key:string)=>request<Dossier>(`/news-robot/intake-seed/${encodeURIComponent(key)}`),
};
export const blankSource=():IntakeSource=>({id:crypto.randomUUID(),url:"",title:"",description:"",publisher:"",author:"",published_at:null,media:[]});
export const blankDossier=():Dossier=>({id:crypto.randomUUID(),title:"",description:"",status:"proposed",reason:"",target_entity_id:null,version:0,sources:[blankSource()]});
