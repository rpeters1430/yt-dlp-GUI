const express=require('express');
const rateLimit=require('express-rate-limit');
const fs=require('fs');
const path=require('path');
const db=require('../db');
const music=require('../services/music');
const musicbrainz=require('../services/musicbrainz');
const {findOnPath}=require('../services/ytdlpPaths');
const {createReviews}=require('../services/music/reviews');
const {createFingerprintService}=require('../services/music/fingerprint');
const {requireAuth}=require('../auth');
const router=express.Router();
router.use(requireAuth);
const reviews=createReviews({db,root:()=>music.getMusicSettings().musicDir,getRelease:id=>musicbrainz.getRelease(id)});
const loadKey=()=>db.prepare("SELECT value FROM settings WHERE key='music_acoustid_key'").get()?.value || process.env.ACOUSTID_CLIENT_KEY || '';
const fingerprint=createFingerprintService({loadKey});
function executable(file) {try {fs.accessSync(file,fs.constants.X_OK);return fs.statSync(file).isFile();} catch {return false;}}
function status() {
  return {configured:!!loadKey(),available:process.env.FPCALC_BIN && path.isAbsolute(process.env.FPCALC_BIN) ? executable(process.env.FPCALC_BIN) : !!findOnPath(process.env.FPCALC_BIN || 'fpcalc'),environmentKey:!!process.env.ACOUSTID_CLIENT_KEY};
}
const action=fn=>async(req,res)=>{
  try {res.json(await fn(req));}
  catch(err) {res.status(err.status || 400).json({error:err.message});}
};
router.get('/files',action(req=>reviews.list(req.query.folder || '')));
router.post('/inspect',action(req=>reviews.inspect(req.body.path)));
router.post('/preview',action(req=>reviews.preview(req.body || {})));
router.get('/reviews',action(()=>reviews.history()));
function refreshLibraries() {
  try {
    const jellyfin=require('../services/jellyfinSync'), plex=require('../services/plexSync');
    const config=jellyfin.getSyncConfig();
    if(config.url && config.apiKey)jellyfin.scheduleLibraryScan();
    if(plex.isConfigured(plex.getPlexConfig()))plex.scheduleLibraryScan();
  } catch(err) {console.error(`[music] Tags saved but could not schedule a library refresh: ${err.message}`);}
}
router.post('/reviews/:id/apply',action(async req=>{const result=await reviews.apply(req.params.id);refreshLibraries();return result;}));
router.post('/reviews/:id/restore',action(async req=>{const result=await reviews.restore(req.params.id);refreshLibraries();return result;}));
router.get('/fingerprint/settings',(req,res)=>res.json(status()));
router.put('/fingerprint/settings',(req,res)=>{
  const key=req.body?.clientKey;
  if (key!==undefined) {
    if(typeof key!=='string' || key.length>128 || (key && !/^[a-z0-9_-]+$/i.test(key.trim()))) return res.status(400).json({error:'Invalid AcoustID application key'});
    db.prepare("INSERT INTO settings (key,value) VALUES ('music_acoustid_key',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key.trim());
  }
  res.json(status());
});
router.post('/identify',rateLimit({windowMs:60*1000,limit:12,standardHeaders:'draft-7',legacyHeaders:false}),action(async req=>{
  const {file}=await reviews.resolve(req.body.path);
  return fingerprint.lookup(file);
}));
module.exports=router;
