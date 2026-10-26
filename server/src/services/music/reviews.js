const fs = require('fs');
const path = require('path');
const {randomUUID,createHash} = require('crypto');
const tagger = require('./tagger');
const EXTENSIONS = new Set(['.mp3','.m4a','.flac','.opus','.ogg','.wav']);
const locks = new Set();
const ID_FIELDS = ['musicbrainzReleaseId','musicbrainzReleaseGroupId','musicbrainzRecordingId','musicbrainzReleaseTrackId','musicbrainzArtistIds','musicbrainzAlbumArtistIds','isrc'];
async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function conflict(message) {
  const err = new Error(message);
  err.status = 409;
  return err;
}
function createReviews({db,root,getRelease}) {
  async function resolve(relative, directory = false) {
    if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(p=>p==='..' || p.startsWith('.'))) {
      throw new Error('Invalid or reserved music library path');
    }
    const base = await fs.promises.realpath(root());
    let current = base;
    for (const part of relative.split('/').filter(Boolean)) {
      current = path.join(current,part);
      if ((await fs.promises.lstat(current)).isSymbolicLink()) throw new Error('Symlink music paths are not supported');
    }
    const stat = await fs.promises.stat(current);
    if (directory ? !stat.isDirectory() : !stat.isFile() || !EXTENSIONS.has(path.extname(current).toLowerCase())) throw new Error('Unsupported music file or directory');
    const canonical = await fs.promises.realpath(current);
    if (canonical !== base && !canonical.startsWith(base+path.sep)) throw new Error('Music path escapes the library directory');
    return {file:canonical,base,stat};
  }
  async function list(folder = '') {
    const start = await resolve(folder,true);
    const pending = [{file:start.file,relative:folder}], files = [];
    let visited=0, truncated=false;
    while (pending.length && !truncated) {
      const dir=pending.shift();
      const entries=(await fs.promises.readdir(dir.file,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (++visited>3000 || files.length>=200) {truncated=true;break;}
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const relative=path.posix.join(dir.relative,entry.name);
        if (entry.isDirectory()) pending.push({file:path.join(dir.file,entry.name),relative});
        else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push({path:relative,name:entry.name});
      }
    }
    return {files,truncated,folder};
  }
  async function inspect(relative, metadata = {}) {
    const location=await resolve(relative);
    const revision=await hashFile(location.file);
    const result=await tagger.inspectAudio(location.file,metadata);
    if (await hashFile(location.file)!==revision) throw conflict('Music file changed while reading; inspect it again');
    return {...result,path:relative,revision};
  }
  async function preview({path:relative,releaseId,releaseTrackId,source='musicbrainz'}) {
    if (!['itunes','musicbrainz'].includes(source)) throw new Error('Unsupported music metadata catalog');
    const release=await getRelease(releaseId,source);
    const track=release.tracks.find(t=>(source==='itunes' ? t.catalogTrackId : t.musicbrainzReleaseTrackId)===releaseTrackId);
    if (!track) throw new Error('Choose a track from the selected catalog release');
    const current=await inspect(relative,track);
    const location=await resolve(relative);
    const proposed=current.proposed;
    const changes=[...new Set([...Object.keys(current.tags),...Object.keys(proposed)])].map(field=>{
      const before=current.tags[field]??null, after=proposed[field]??null;
      return {field,before,after,replaceable:after!==null,clearable:true,
        action:after===null || (before!==null && (ID_FIELDS.includes(field) || field==='genre')) || JSON.stringify(before)===JSON.stringify(after) ? 'keep' : 'replace'};
    });
    const id=randomUUID();
    const payload={path:relative,root:location.base,revision:current.revision,metadata:proposed,changes};
    db.prepare('INSERT INTO music_tag_reviews (id,payload_json,created_at) VALUES (?,?,?)').run(id,JSON.stringify(payload),Date.now());
    return {id,path:relative,changes,artworkPreserved:current.artwork,expiresAt:Date.now()+24*60*60*1000};
  }
  function getReview(id) {
    const row=db.prepare('SELECT * FROM music_tag_reviews WHERE id=?').get(String(id));
    if (!row) throw new Error('Music tag review was not found');
    return {...row,payload:JSON.parse(row.payload_json)};
  }
  async function withFile(id,operation) {
    const row=getReview(id), location=await resolve(row.payload.path);
    if (location.base!==row.payload.root) throw conflict('Music library directory changed; create a new preview');
    if (locks.has(location.file)) throw conflict('This music file is already being updated');
    locks.add(location.file);
    try {return await operation(row,location);} finally {locks.delete(location.file);}
  }
  async function backupPath(row,location,create=false) {
    const rootDir=path.join(location.base,'.tag-backups');
    if (create) {
      try {await fs.promises.mkdir(rootDir);} catch(err) {if(err.code!=='EEXIST')throw err;}
    }
    const rootStat=await fs.promises.lstat(rootDir);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || await fs.promises.realpath(rootDir)!==rootDir) throw conflict('Backup directory must not be a symlink');
    const folder=path.join(rootDir,row.id);
    if (create) await fs.promises.mkdir(folder);
    const folderStat=await fs.promises.lstat(folder);
    if (folderStat.isSymbolicLink() || !folderStat.isDirectory() || await fs.promises.realpath(folder)!==folder) throw conflict('Backup directory changed');
    const file=path.join(folder,'original'+path.extname(location.file));
    if (!create && (await fs.promises.lstat(file)).isSymbolicLink()) throw conflict('Backup file must not be a symlink');
    return file;
  }
  async function apply(id, choices = {}) {
    if (!choices || typeof choices!=='object' || Array.isArray(choices)) throw new Error('Invalid tag choices');
    const preview=getReview(id).payload;
    // Reviews made before field selection was supported must be generated again.
    if (!preview.changes.every(change=>change.action)) throw conflict('Create a fresh preview to choose fields');
    const fields=new Map(preview.changes.map(change=>[change.field,change]));
    for (const [field,action] of Object.entries(choices)) {
      const change=fields.get(field);
      if (!change || !['keep','replace','clear'].includes(action) || (action==='replace' && !change.replaceable) || (action==='clear' && !change.clearable)) throw new Error('Invalid tag choice for '+field);
    }
    const metadata={}, clearFields=[];
    for (const change of preview.changes) {
      const action=choices[change.field] || change.action;
      if (action==='replace') metadata[change.field]=change.after;
      if (action==='clear') clearFields.push(change.field);
    }
    // Rebuild a shared number/total field without changing a kept sibling.
    for (const [number,total] of [['trackNumber','totalTracks'],['discNumber','totalDiscs']]) {
      if ([number,total].some(field=>field in metadata || clearFields.includes(field))) {
        for (const field of [number,total]) {
          if (!(field in metadata) && !clearFields.includes(field) && fields.get(field)?.before!=null) metadata[field]=fields.get(field).before;
        }
        if (!(number in metadata) && total in metadata) throw new Error('Clear the associated total when clearing its number');
      }
    }

    return withFile(id,async(row,location)=>{
      if (row.status!=='ready') throw conflict('Review is not ready or has already been applied');
      if (Date.now()-row.created_at>24*60*60*1000) throw conflict('Preview expired; inspect the file again');
      if (await hashFile(location.file)!==row.payload.revision) throw conflict('Music file changed since preview; inspect it again');
      const claim=db.prepare("UPDATE music_tag_reviews SET status='applying' WHERE id=? AND status='ready'").run(id);
      if (!claim.changes) throw conflict('Review is already being applied');
      try {
        const backup=await backupPath(row,location,true);
        await fs.promises.copyFile(location.file,backup,fs.constants.COPYFILE_EXCL);
        await fs.promises.chmod(backup,location.stat.mode & 0o777);
        if (await hashFile(backup)!==row.payload.revision) throw conflict('Music file changed during backup; no tags written');
        const result=await tagger.writeVerifiedTags(location.file,metadata,null,{scrub:false,expectedSha256:row.payload.revision,clearFields,selectedFields:Object.keys(metadata)});
        const revision=result.revision;
        if (!revision || await hashFile(location.file)!==revision) throw conflict('Music file changed after tagging; original backup retained');
        db.prepare("UPDATE music_tag_reviews SET status='applied', after_sha256=?, error=NULL WHERE id=?").run(revision,id);
        return {id,path:row.payload.path,status:'applied',tags:result.tags,revision};
      } catch(err) {
        db.prepare("UPDATE music_tag_reviews SET status='failed', error=? WHERE id=?").run(err.message,id);
        throw err;
      }
    });
  }
  async function restore(id) {
    return withFile(id,async(row,location)=>{
      if (!['applied','failed','applying'].includes(row.status)) throw conflict('Review has no applied backup to restore');
      // An interrupted apply has no trusted post-write revision. Leave both copies available.
      if (!row.after_sha256) throw conflict('Interrupted review: inspect the file and recover the retained backup manually');
      if (await hashFile(location.file)!==row.after_sha256) throw conflict('Music file changed after tagging; restore would replace newer edits');
      const backup=await backupPath(row,location);
      if (await hashFile(backup)!==row.payload.revision) throw conflict('Original backup changed; restore cancelled');
      const temporary=path.join(path.dirname(location.file),`.tag-restore-${randomUUID()}`);
      try {
        await fs.promises.copyFile(backup,temporary,fs.constants.COPYFILE_EXCL);
        await fs.promises.chmod(temporary,location.stat.mode & 0o777);
        if (await hashFile(temporary)!==row.payload.revision) throw conflict('Original backup changed during restore');
        if (await hashFile(location.file)!==row.after_sha256) throw conflict('Music file changed during restore');
        await fs.promises.rename(temporary,location.file);
        db.prepare("UPDATE music_tag_reviews SET status='restored' WHERE id=?").run(id);
        return {id,path:row.payload.path,status:'restored'};
      } finally {await fs.promises.rm(temporary,{force:true});}
    });
  }
  function history() {
    return db.prepare('SELECT id,status,payload_json,created_at,error FROM music_tag_reviews ORDER BY created_at DESC LIMIT 50').all().map(row=>({id:row.id,status:row.status,path:JSON.parse(row.payload_json).path,createdAt:row.created_at,error:row.error}));
  }
  return {list,inspect,preview,apply,restore,history,resolve};
}
module.exports={createReviews};
