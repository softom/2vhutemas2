const translations:Record<string,string[]>={
 'фасад':['facade','façade','elevation','exterior wall','стены фасада','наружная стена','фасады'],
 'кровля':['roof','rooftop','крыша','покрытие'],
 'навес':['canopy','concrete veil','veil','козырёк','козырек','тент','навес над площадью'],
 'интерьер':['interior','inside','внутреннее пространство'],
 'входная группа':['entrance','entry','portal','вход','портал'],
 'портик':['portico','porticoes','peristyle','colonnade','перистиль','колоннада','портики'],
 'стилобат':['podium','plinth','base','stylobate','цоколь','основание'],
 'башня':['tower','towers','высотная часть'],
 'надстройка':['crown','plug','attic','addition','завершение','мансарда'],
 'площадь':['plaza','square','courtyard','двор','прилегающая площадь','площадь и навес','plaza and canopy'],
 'несущая система':['structure','structural system','frame','каркас','конструкция'],
 'выставочный корпус':['exhibition building','exhibition hall','gallery','выставочный зал'],
 'читальный зал':['reading room','main reading room','стены главного читального зала'],
};
export const canonicalZones=Object.keys(translations);
const dictionary=new Map(Object.entries(translations).flatMap(([zone,aliases])=>aliases.map(alias=>[alias,zone] as const)));
export function normalizeZone(raw:unknown){
 const key=String(raw??'').normalize('NFC').trim().toLowerCase().replace(/\s+/g,' ');
 return dictionary.get(key)??key;
}
