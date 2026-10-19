const YOUTUBE_HOST = /(^|\.)youtube\.com$/i;
const VIDEO_ID = /^[\w-]{11}$/;

// A YouTube video opened from inside a playlist ("watch?v=X&list=Y", or "youtu.be/X?list=Y").
// yt-dlp treats such a link as the whole playlist, but someone sharing it from the player
// almost always means the one video. Returns the plain video link to download, and the
// playlist link to offer instead (null for auto-generated mixes, which never end), or null
// when the link isn't one of these.
export function splitPlaylistVideoUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url || '').trim());
  } catch (_) {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const list = parsed.searchParams.get('list');
  if (!list) return null;
  let videoId = null;
  if (host === 'youtu.be') videoId = parsed.pathname.slice(1).split('/')[0];
  else if (YOUTUBE_HOST.test(host) && parsed.pathname === '/watch') videoId = parsed.searchParams.get('v');
  if (!videoId || !VIDEO_ID.test(videoId)) return null;

  const videoUrl = new URL(`https://www.youtube.com/watch?v=${videoId}`);
  const start = parsed.searchParams.get('t');
  if (start) videoUrl.searchParams.set('t', start);
  const isMix = /^RD/.test(list);
  return {
    videoUrl: videoUrl.toString(),
    playlistUrl: isMix ? null : `https://www.youtube.com/playlist?list=${encodeURIComponent(list)}`,
  };
}
