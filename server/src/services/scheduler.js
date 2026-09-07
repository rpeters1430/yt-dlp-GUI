const cron = require('node-cron');
const db = require('../db');
const ytdlp = require('./ytdlp');
const queue = require('./queue');

async function checkWatch(watch) {
  try {
    console.log(`[watch] Checking watch #${watch.id} "${watch.name || 'unnamed'}" (${watch.url})`);
    const info = await ytdlp.getInfo(watch.url, { flatPlaylist: true });
    const entries = info.entries || [info];

    const seen = new Set(
      db.prepare('SELECT video_id FROM watch_seen_ids WHERE watch_id = ?').all(watch.id).map((r) => r.video_id)
    );

    const insertSeen = db.prepare('INSERT OR IGNORE INTO watch_seen_ids (watch_id, video_id) VALUES (?, ?)');
    let newCount = 0;

    for (const entry of entries) {
      const id = entry.id;
      if (!id) continue;
      if (seen.has(id)) continue;

      insertSeen.run(watch.id, id);
      seen.add(id);
      newCount++;

      // Skip auto-download on the very first check (initial catalog), only download
      // videos that appear in subsequent checks so adding a watch doesn't bulk-download
      // an entire back catalog by surprise.
      if (watch.last_checked_at) {
        const entryUrl = entry.url || entry.webpage_url || `https://www.youtube.com/watch?v=${id}`;
        console.log(`[watch] #${watch.id} Found new video ${id}: auto-enqueuing`);
        queue.enqueue(entryUrl, {
          formatSelector: watch.format_selector,
          audioOnly: !!watch.audio_only,
          watchId: watch.id,
        });
      }
    }

    db.prepare("UPDATE watches SET last_checked_at = datetime('now') WHERE id = ?").run(watch.id);
    console.log(`[watch] #${watch.id} Finished check (${entries.length} items evaluated, ${newCount} new recorded)`);
    return newCount;
  } catch (err) {
    console.error(`[watch:error] Check failed for #${watch.id} (${watch.url}):`, err.message);
    return 0;
  }
}

async function checkAllWatches() {
  const watches = db.prepare('SELECT * FROM watches').all();
  for (const watch of watches) {
    await checkWatch(watch);
  }
}

function start() {
  // Every 30 minutes.
  cron.schedule('*/30 * * * *', () => {
    checkAllWatches().catch((e) => console.error('Scheduler run failed:', e.message));
  });
}

module.exports = { start, checkAllWatches, checkWatch };
