// Switching providers invalidates in-flight results/errors from the previous catalog.
export function createCatalogRequests() {
  let version=0;
  return {start:()=>++version,invalidate:()=>{version++;},isCurrent:ticket=>ticket===version};
}
export function catalogTrackId(track,source) {
  return source==='itunes' ? track.catalogTrackId : track.musicbrainzReleaseTrackId;
}
