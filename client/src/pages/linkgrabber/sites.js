// Groups hosts by site name, so a file host's mirror domains (bunkr.si, bunkr.fi, cdn3.bunkr.ru)
// and subdomains count as one site in the link grabber's host filter.

// Second-level labels used under a two-letter country ending, as in mega.co.nz or site.com.au.
const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac']);
// Hosts whose other domains are spelled differently, not just ended differently.
const ALIASES = { bunkrr: 'bunkr', teraboxapp: 'terabox', pixeldra: 'pixeldrain' };

export function siteName(host) {
  const labels = String(host || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  // An IP address or a bare name has no ending to drop.
  if (labels.length < 2 || /^\d+$/.test(labels.at(-1))) return labels.join('.');
  let i = labels.length - 2;
  if (labels.length >= 3 && labels.at(-1).length === 2 && SECOND_LEVEL.has(labels[i])) i -= 1;
  return ALIASES[labels[i]] || labels[i];
}
