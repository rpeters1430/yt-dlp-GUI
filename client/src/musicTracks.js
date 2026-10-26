// Track numbers repeat on every disc. Keep selection and source assignments independent.
export function musicTrackKey(track) {
  return `${track.discNumber || 1}:${track.trackNumber || 1}`;
}
