const {execFile}=require('child_process');
const {promisify}=require('util');
const run=promisify(execFile);
let requests=Promise.resolve(), lastRequest=0;
async function runFpcalc(file) {
  try {
    const {stdout}=await run(process.env.FPCALC_BIN || 'fpcalc',['-json','-length','120',file],{timeout:45000,maxBuffer:1024*1024});
    return JSON.parse(stdout);
  } catch(err) {
    throw new Error(err.code==='ENOENT' ? 'Chromaprint fpcalc is not installed; update the Docker image or install libchromaprint-tools' : 'Could not fingerprint this audio file', {cause:err});
  }
}
function createFingerprintService({loadKey,runFpcalc:calculate=runFpcalc,fetchImpl=(...args)=>fetch(...args)}) {
  async function lookup(file) {
    const key=loadKey();
    if (!key) throw new Error('Add a free AcoustID application key to enable identification');
    const fingerprint=await calculate(file);
    if (!Number.isFinite(fingerprint.duration) || fingerprint.duration<=0 || typeof fingerprint.fingerprint!=='string' || !fingerprint.fingerprint || fingerprint.fingerprint.length>100000) {
      throw new Error('Chromaprint returned an invalid fingerprint');
    }
    const operation=requests.then(async()=>{
      await new Promise(resolve=>setTimeout(resolve,Math.max(0,400-(Date.now()-lastRequest))));
      lastRequest=Date.now();
      const body=new URLSearchParams({client:key,duration:String(Math.round(fingerprint.duration)),fingerprint:fingerprint.fingerprint,format:'json',meta:'recordings+releases'});
      const res=await fetchImpl('https://api.acoustid.org/v2/lookup',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'yt-dlp-GUI/1.0 (https://github.com/rpeters1430/yt-dlp-GUI)'},body:body.toString(),signal:AbortSignal.timeout(15000)});
      if (!res.ok) throw new Error(`AcoustID lookup failed (HTTP ${res.status})`);
      const data=await res.json();
      if (data.status!=='ok') throw new Error('AcoustID lookup failed; check the application key or try later');
      const matches=new Map();
      for(const result of data.results || []) for(const recording of result.recordings || []) {
        if (!recording.id) continue;
        const previous=matches.get(recording.id);
        if (previous && previous.score>=result.score) continue;
        matches.set(recording.id,{recordingId:recording.id,title:recording.title || 'Unknown title',artists:(recording.artists || []).map(a=>a.name).filter(Boolean),score:result.score,releases:(recording.releases || []).filter(r=>r.id).map(r=>({id:r.id,title:r.title || 'Release'}))});
      }
      return {duration:fingerprint.duration,matches:[...matches.values()].sort((a,b)=>b.score-a.score).slice(0,15)};
    });
    requests=operation.catch(()=>{});
    return operation;
  }
  return {lookup};
}
module.exports={createFingerprintService,runFpcalc};
