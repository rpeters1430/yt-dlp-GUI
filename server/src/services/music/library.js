const fs = require('fs');
const path = require('path');
const {createHash, randomUUID} = require('crypto');

function segment(value) {
  // eslint-disable-next-line no-control-regex -- filesystem names cannot contain control bytes.
  const s = String(value || 'Unknown').replace(/[/\\:*?"<>|\x00-\x1f]/g,'_').replace(/\s+/g,' ').trim().slice(0,120);
  return !s || /^\.+$/.test(s) ? 'Unknown' : s;
}
function libraryTemplate(base, track, naming = 'classic') {
  const artist = segment(track.albumArtist || track.artist || 'Unknown Artist');
  let album = track.album ? segment(track.album) : null;
  if (album && naming === 'release') {
    if (track.year || track.releaseYear) album += ` (${segment(track.year || track.releaseYear)})`;
    if (track.edition) album += ` [${segment(track.edition)}]`;
    // Include a release ID, not only a group ID: two editions can have identical names/dates.
    if (track.musicbrainzReleaseId) album += ` [${segment(track.musicbrainzReleaseId)}]`;
  }
  const multi = Number(track.totalDiscs) > 1 || Number(track.discNumber) > 1;
  const disc = String(track.discNumber || 1).padStart(2,'0');
  const number = String(track.trackNumber || 1).padStart(2,'0');
  const parts = [base,artist,...(album ? [album] : [])];
  if (multi && naming === 'release') parts.push(`Disc ${disc}`);
  const prefix = multi && naming !== 'release' ? `${track.discNumber || 1}-` : '';
  parts.push(`${prefix}${number} - ${segment(track.title || 'Track')}`);
  // These are literal names, not additional yt-dlp interpolation directives.
  return path.join(...parts).replace(/%/g,'%%') + '.%(ext)s';
}
function renderedPath(template, ext) {
  return template.replace(/%\(ext\)s$/,ext).replace(/%%/g,'%');
}
async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function importTrack(staged, destination, provenance) {
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  const digest = await hashFile(staged);
  const temp = path.join(path.dirname(destination), `.music-import-${randomUUID()}`);
  try {
    await fs.promises.copyFile(staged,temp,fs.constants.COPYFILE_EXCL);
    try {
      // Atomic publish without replacing an existing file, even across simultaneous imports.
      await fs.promises.link(temp,destination);
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (await hashFile(destination) !== digest) throw new Error(`Music library file already exists; choose a different edition or filename: ${destination}`, {cause:err});
    }
    const sidecar = `${temp}.json`;
    try {
      await fs.promises.writeFile(sidecar, JSON.stringify({...provenance, sha256:digest},null,2)+'\n',{flag:'wx'});
      try { await fs.promises.link(sidecar,`${destination}.source.json`); }
      catch (err) { if (err.code !== 'EEXIST') throw err; }
    } finally { await fs.promises.rm(sidecar,{force:true}); }
    return {filepath:destination, sha256:digest};
  } finally { await fs.promises.rm(temp,{force:true}); }
}
module.exports = {libraryTemplate, renderedPath, importTrack, segment};
