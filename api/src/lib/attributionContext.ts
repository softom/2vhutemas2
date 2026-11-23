import {normalizeZone} from './attributionZones.ts';
export function compatibleEvidence(a:{phase:string;zone:string;quote:string},b:{phase:string;zone:string;quote:string}){
 const az=normalizeZone(a.zone),bz=normalizeZone(b.zone);
 if(a.phase===b.phase&&az===bz)return true;
 if((a.phase&&b.phase&&a.phase!==b.phase)||(az&&bz&&az!==bz))return false;
 return Boolean(a.quote&&b.quote&&(a.quote.includes(b.quote)||b.quote.includes(a.quote)));
}
