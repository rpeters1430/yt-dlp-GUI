const USER_AGENT='yt-dlp-GUI/1.0 (https://github.com/rpeters1430/yt-dlp-GUI)';
const TRANSIENT=new Set([429,500,502,503,504]);
function createMetadataClient({fetchImpl=(...args)=>fetch(...args),now=()=>Date.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  const cache=new Map();
  let requests=Promise.resolve(),lastRequest=-Infinity,notBefore=0;
  const cooldownError=()=>new Error(`MusicBrainz is busy or throttling requests. Please wait ${Math.max(1,Math.ceil((notBefore-now())/1000))} seconds before trying again. Apple catalog search is still available for downloads.`);
  async function perform(url) {
    for(let attempt=0;attempt<3;attempt++) {
      const wait=Math.max(0,1100-(now()-lastRequest),notBefore-now());
      // A long upstream cooldown must not turn into a hung HTTP request in our UI.
      if(wait>20000)throw cooldownError();
      await sleep(wait);
      lastRequest=now();
      let response;
      try {
        response=await fetchImpl(url,{headers:{'User-Agent':USER_AGENT,Accept:'application/json'},signal:AbortSignal.timeout(15000)});
        if(response.ok)return await response.json();
      }catch(err) {
        if(attempt===2)throw new Error('MusicBrainz could not be reached after 3 attempts. Please try again later.',{cause:err});
        notBefore=Math.max(notBefore,now()+1500*2**attempt);
        continue;
      }
      await response.body?.cancel().catch(()=>{});
      if(!TRANSIENT.has(response.status))throw new Error(`MusicBrainz metadata unavailable (HTTP ${response.status}); check the search or release ID`);
      const header=response.headers?.get('retry-after');
      const seconds=header && /^\d+(?:\.\d+)?$/.test(header.trim()) ? Number(header)*1000 : NaN;
      const date=header ? Date.parse(header) : NaN;
      const serverDelay=Number.isFinite(seconds) ? seconds : Number.isFinite(date) ? Math.max(0,date-now()) : 0;
      notBefore=Math.max(notBefore,now()+Math.max(serverDelay,1500*2**attempt));
      if(attempt===2 || notBefore-now()>20000)throw cooldownError();
    }
  }
  function request(resource,params={}) {
    const url=new URL(resource,'https://musicbrainz.org/ws/2/');
    for(const [key,value] of Object.entries({...params,fmt:'json'}))url.searchParams.set(key,value);
    const key=url.href,entry=cache.get(key);
    if(entry && entry.expires>now())return entry.promise;
    const promise=requests.then(()=>perform(url));
    requests=promise.catch(()=>{});
    if(cache.size>=100)cache.delete(cache.keys().next().value);
    cache.set(key,{promise,expires:now()+15*60*1000});
    promise.catch(()=>{if(cache.get(key)?.promise===promise)cache.delete(key);});
    return promise;
  }
  return {request};
}
module.exports={createMetadataClient,USER_AGENT};
