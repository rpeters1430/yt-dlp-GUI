const {randomUUID} = require('crypto');
const path = require('path');
const fs = require('fs');
const db = () => require('../../db');
function begin(expectedCount) {
  const id = randomUUID();
  db().prepare('INSERT INTO music_batches (id,expected_count) VALUES (?,?)').run(id,expectedCount);
  return id;
}
function seal(id, errors) {
  db().prepare('UPDATE music_batches SET enqueuing=0, enqueue_errors=? WHERE id=?').run(errors,id);
}
function ready(id) {
  const batch = db().prepare('SELECT * FROM music_batches WHERE id=?').get(id);
  if (!batch || batch.enqueuing || batch.enqueue_errors || batch.notified || batch.expected_count === 0) return null;
  const jobs = db().prepare("SELECT * FROM downloads WHERE json_valid(options_json) AND json_extract(options_json,'$.musicBatchId')=?").all(id);
  return jobs.length === batch.expected_count && jobs.every(job => job.status === 'completed') ? jobs : null;
}
function notifyIfReady(id) {
  const jobs = ready(id);
  if (!jobs) return false;
  const jellyfin = require('../jellyfinSync');
  const plex = require('../plexSync');
  const lidarr = require('../lidarr');
  try {
    const cfg = jellyfin.getSyncConfig();
    if (cfg.url && cfg.apiKey) jellyfin.scheduleLibraryScan();
    const plexCfg = plex.getPlexConfig();
    if (plex.isConfigured(plexCfg)) plex.scheduleLibraryScan();
    const folders = new Set();
    for (const job of jobs) {
      const opts = JSON.parse(job.options_json);
      if (!job.filepath || !fs.existsSync(job.filepath) || opts.musicImport || opts.lidarrHash) continue;
      const folder = path.dirname(job.filepath);
      if (folders.has(folder)) continue;
      folders.add(folder);
      lidarr.notifyDownloadComplete(job,{filepath:job.filepath},opts);
    }
    db().prepare('UPDATE music_batches SET notified=1 WHERE id=?').run(id);
    return true;
  } catch (err) {
    console.error(`[music] Could not schedule completed album scans: ${err.message}`);
    return false;
  }
}
// Scan schedules are deliberately replayable. A timer is not a durable delivery ack:
// restart can occur after scheduling but before the media server is actually contacted.
function recover() {
  let scheduled = 0;
  for (const batch of db().prepare('SELECT * FROM music_batches').all()) {
    if (batch.enqueuing) {
      const count = db().prepare("SELECT count(*) AS n FROM downloads WHERE json_valid(options_json) AND json_extract(options_json,'$.musicBatchId')=?").get(batch.id).n;
      if (count !== batch.expected_count) continue; // Interrupted incomplete request stays closed to import.
      seal(batch.id,0);
    }
    db().prepare('UPDATE music_batches SET notified=0 WHERE id=?').run(batch.id);
    if (notifyIfReady(batch.id)) scheduled++;
  }
  return scheduled;
}
module.exports = {begin,seal,ready,notifyIfReady,recover};
