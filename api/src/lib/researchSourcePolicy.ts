/** Our publications cannot be independent evidence for our own research. */
export const SELF_SOURCE_STATUS = 'Исключён из анализа: собственный сайт';
export function isOwnResearchSource(raw:unknown):boolean {
  if(typeof raw!=='string')return false;
  try {
    const url=new URL(raw),host=url.hostname.toLowerCase().replace(/\.+$/,'');
    const hosts=['2vhutemas.ru','155.212.170.40'];
    try { hosts.push(new URL(Deno.env.get('SITE_URL')||'https://2vhutemas.ru').hostname.toLowerCase().replace(/\.+$/,'')); } catch { /* default host still applies */ }
    if(hosts.some(own=>host===own||host.endsWith('.'+own)))return true;
    // Known text/archive wrappers do not turn our publication into outside evidence.
    if(host==='r.jina.ai')return isOwnResearchSource(url.pathname.slice(1));
    if(host==='web.archive.org'){
      const target=url.pathname.match(/^\/web\/[^/]+\/(https?:\/\/.*)$/)?.[1];
      return !!target&&isOwnResearchSource(target);
    }
    return false;
  } catch { return false; }
}
export function isExcludedResearchRow(row:Record<string,any>):boolean {
  return isOwnResearchSource(row.source_url)||row.source_status===SELF_SOURCE_STATUS;
}
