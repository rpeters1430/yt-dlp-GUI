// Public, read-only metadata API. Never infer a release ID from a fuzzy name match.
const {createMetadataClient,USER_AGENT}=require('./musicbrainzClient');
const {request}=createMetadataClient();

function credit(items = []) {
  return {
    name: items.map(c => `${c.name || c.artist?.name || ''}${c.joinphrase || ''}`).join(''),
    artists: items.filter(c => c.artist).map(c => c.artist.name),
    ids: items.filter(c => c.artist?.id).map(c => c.artist.id),
    sort: items.map(c => `${c.artist?.['sort-name'] || c.name || ''}${c.joinphrase || ''}`).join(''),
  };
}

function summarize(r) {
  return {id:`mb-${r.id}`, musicbrainzReleaseId:r.id, name:r.title,
    artist:credit(r['artist-credit']).name, releaseDate:r.date || null,
    releaseYear:r.date?.slice(0,4) || null, country:r.country || null,
    edition:r.disambiguation || null, status:r.status || null,
    trackCount:r['track-count'] || (r.media || []).reduce((n,m)=>n+(m['track-count'] || 0),0),
    artwork:null, source:'musicbrainz'};
}

function normalizeRelease(r) {
  const albumCredit = credit(r['artist-credit']);
  const group = r['release-group'] || {};
  const media = r.media || [];
  if (!media.length || media.some(m => !m.tracks?.length || (m['track-count'] && m['track-count'] !== m.tracks.length))) {
    throw new Error('MusicBrainz album track list incomplete');
  }
  const genre = (r.genres || group.genres || []).slice().sort((a,b)=>(b.count||0)-(a.count||0))[0]?.name;
  const album = {...summarize(r), totalDiscs:media.length, originalDate:group['first-release-date'], genre,
    trackCount:media.reduce((n,m)=>n+m.tracks.length,0)};
  const tracks = media.flatMap((m, index) => m.tracks.map((t, i) => {
    const recording = t.recording || {};
    const tc = credit(t['artist-credit'] || recording['artist-credit'] || r['artist-credit']);
    return {title:t.title || recording.title, artist:tc.name, artists:tc.artists, artistSort:tc.sort,
      albumArtist:albumCredit.name, albumArtists:albumCredit.artists, albumArtistSort:albumCredit.sort,
      album:r.title, trackNumber:t.position || i+1, discNumber:m.position || index+1,
      totalTracks:m.tracks.length, totalDiscs:media.length, duration:(t.length || recording.length) ? Math.round((t.length || recording.length)/1000) : null,
      year:r.date?.slice(0,4), date:r.date, originalDate:group['first-release-date'], genre,
      edition:r.disambiguation, label:r['label-info']?.find(x=>x.label?.name)?.label.name,
      releaseCountry:r.country, releaseStatus:r.status?.toLowerCase(), releaseType:group['primary-type']?.toLowerCase(),
      musicbrainzReleaseId:r.id, musicbrainzReleaseGroupId:group.id,
      musicbrainzRecordingId:recording.id, musicbrainzReleaseTrackId:t.id,
      musicbrainzArtistIds:tc.ids, musicbrainzAlbumArtistIds:albumCredit.ids,
      isrc:recording.isrcs?.[0], metadataSource:'musicbrainz', artwork:null};
  }));
  return {album, tracks};
}

async function searchReleases(query) {
  const q = String(query || '').trim().slice(0,300);
  if (!q) return [];
  const data = await request('release', {query:q, limit:25});
  return (data.releases || []).map(summarize);
}
async function getRelease(id) {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(id))) throw new Error('Invalid MusicBrainz release ID');
  const normalized = normalizeRelease(await request(`release/${id}`, {inc:'recordings+artist-credits+release-groups+labels+isrcs+genres'}));
  // Artwork is optional: a missing cover or archive outage must not hide the release.
  try {
    const response = await fetch(`https://coverartarchive.org/release/${id}`, {headers:{'User-Agent':USER_AGENT, Accept:'application/json'}, signal:AbortSignal.timeout(8000)});
    if (response.ok) {
      const data = await response.json();
      const cover = (data.images || []).find(image => image.front);
      const artwork = cover?.thumbnails?.['500'] || cover?.thumbnails?.large || cover?.image || null;
      normalized.album.artwork = artwork;
      for (const track of normalized.tracks) track.artwork = artwork;
    }
  } catch (_) {}
  return normalized;
}
module.exports = {searchReleases, getRelease, normalizeRelease};
