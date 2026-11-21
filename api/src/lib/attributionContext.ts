export function compatibleEvidence(a:{phase:string;zone:string;quote:string},b:{phase:string;zone:string;quote:string}){
 if(a.phase===b.phase&&a.zone===b.zone)return true;
 if((a.phase&&b.phase&&a.phase!==b.phase)||(a.zone&&b.zone&&a.zone!==b.zone))return false;
 return Boolean(a.quote&&b.quote&&(a.quote.includes(b.quote)||b.quote.includes(a.quote)));
}
