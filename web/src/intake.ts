import { request } from "./api";
export const INTAKE_STATUS: Record<string,string> = {proposed:"Предложено",reviewing:"На проверке",needs_info:"Требует уточнения",ready:"Готово к внесению",done:"Внесено",rejected:"Отклонено"};
export interface IntakeMedia {id:string;url:string;media_entity_id:number|null;kind:string;caption:string;author:string;status:string;error:string}
export interface IntakeSource {id:string;url:string;title:string;description:string;publisher:string;author:string;published_at:string|null;media:IntakeMedia[]}
export interface SketchRelation {manual?:boolean;deferred_error?:string;candidate_intake_id?:string|null;kind?:'author'|'place';name:string;matches:{id:number;title_ru:string;is_published?:boolean}[];entity_id?:number|null;role_id?:string|null;reason?:string;source_url?:string;confirmed?:boolean;title?:string;is_published?:boolean}
export interface Research {state:string;job?:string;started_at?:string;error?:string;summary?:string;consensus?:"high"|"medium"|"split"|"unknown";warnings?:string[];phases?:{period:string;description:string;zones:string[]}[];sources?:{id:string;url:string;title:string;excerpt:string;provider:string;evidence:"snippet"|"provided"}[];findings?:{id:string;kind:"style"|"feature";title:string;relation:"positive"|"negative"|"metaphor";level:string;phase:string;zone:string;rationale:string;source_ids:string[];entity_id:number|null;selected:boolean}[]}
export interface Sketch {research?:Research;research_selected_ids?:string[];state:string;title:string;type_id:string;description:string;sources:{url:string;title:string;description:string}[];questions:string[];matches:{id:number;title_ru:string}[];related?:SketchRelation[];catalog_checks?:{name:string;domain:string;status:string;note:string;urls:string[]}[];target_entity_id:number|null;error?:string;started_at?:string}
export interface Dossier {publication_media?:{id:number;asset_id:string;title:string;revision_id:string;status:string}[];sketch?:Sketch|null;id:string;title:string;description:string;status:string;reason:string;target_entity_id:number|null;version:number;sources:IntakeSource[];history?:{at:string;by:string;snapshot:Dossier}[];confirm_done?:boolean}
export interface IntakeRow {id:string;title:string;status:string;version:number;updated_at:string;target_entity_id:number|null;sources_count:number;media_count:number}
export const intake = {
 externalDescriptions:(id:number,page=0)=>request<{items:{id:string;url:string;title:string;excerpt:string;provider:string;evidence:string;observations_count:number}[];total:number}>(`/entity-intake/external-descriptions/${id}?page=${page}`),
 fromEntity:(id:number,revision:string)=>request<Dossier>(`/entity-intake/from-entity/${id}`,{method:'POST',body:JSON.stringify({base_revision_id:revision})}),
 research:(d:Dossier,replace=false)=>request<Dossier>(`/entity-intake/${d.id}/research`,{method:'POST',body:JSON.stringify({version:d.version,replace})}),
 list:(q="",status="",page=0)=>request<{items:IntakeRow[];total:number}>(`/entity-intake?${new URLSearchParams({q,status,page:String(page)})}`),
 candidate:(d:Dossier,index:number,resolve=false)=>request<Dossier>(`/entity-intake/${d.id}/relation-candidate`,{method:'POST',body:JSON.stringify({version:d.version,index,resolve})}),
 relationOptions:(kind='author',q='')=>request<{roles:{id:string;title_ru:string}[];items:SketchRelation['matches']}>(`/entity-intake/options/relations?${new URLSearchParams({kind,q})}`),
 types:()=>request<{items:{id:string;title_ru:string}[]}>("/entity-intake/options/types"),
 prepare:(d:Dossier,replace=false)=>request<Dossier>(`/entity-intake/${d.id}/prepare`,{method:'POST',body:JSON.stringify({version:d.version,replace})}),
 saveSketch:(d:Dossier)=>request<Dossier>(`/entity-intake/${d.id}/sketch`,{method:'PUT',body:JSON.stringify({version:d.version,sketch:d.sketch})}),
 approve:(d:Dossier)=>request<Dossier>(`/entity-intake/${d.id}/approve`,{method:'POST',body:JSON.stringify({version:d.version,confirm:true,media_manifest:(d.publication_media??[]).map(m=>`${m.id}:${m.asset_id}:${m.revision_id}`).sort()})}),
 get:(id:string)=>request<Dossier>(`/entity-intake/${id}`),
 save:(d:Dossier)=>{const {history: _history,...input}=d;return request<Dossier>(`/entity-intake${d.version?"/"+d.id:""}`,{method:d.version?"PUT":"POST",body:JSON.stringify(input)});},
 seed:(key:string)=>request<Dossier>(`/news-robot/intake-seed/${encodeURIComponent(key)}`),
};
export const blankSource=():IntakeSource=>({id:crypto.randomUUID(),url:"",title:"",description:"",publisher:"",author:"",published_at:null,media:[]});
export const blankDossier=():Dossier=>({id:crypto.randomUUID(),title:"",description:"",status:"proposed",reason:"",target_entity_id:null,version:0,sources:[blankSource()]});
