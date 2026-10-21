import {appendFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const NIGHTLY_REPO = 'yt-dlp/yt-dlp-nightly-builds';
const FFMPEG_REPO = 'yt-dlp/FFmpeg-Builds';

function verifiedAsset(release, repo, name) {
  const matches = release.assets?.filter(asset => asset.name === name) ?? [];
  if (matches.length !== 1) throw new Error(`Missing or duplicate asset: ${name}`);
  const asset = matches[0];
  const url = `https://github.com/${repo}/releases/download/${release.tag_name}/${name}`;
  if (asset.browser_download_url !== url) throw new Error(`Unexpected asset URL: ${name}`);
  if (!/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '')) throw new Error(`Missing SHA256 digest: ${name}`);
  return {url, sha256: asset.digest.slice(7)};
}

export function resolveTools(nightly, releases) {
  if (!/^\d{4}\.\d{2}\.\d{2}\.\d{6}$/.test(nightly.tag_name ?? '') || nightly.draft) {
    throw new Error('Invalid yt-dlp nightly release');
  }
  const ytdlp = {release: nightly.tag_name, ...verifiedAsset(nightly, NIGHTLY_REPO, 'yt-dlp.tar.gz')};
  // Dated tags avoid the rolling `latest` assets changing between resolution
  // and download. Never fall back to an older build missing required assets.
  const release = releases.filter(item => /^autobuild-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(item.tag_name ?? '') && !item.draft && !item.prerelease)
    .sort((a, b) => b.tag_name.localeCompare(a.tag_name))[0];
  if (!release) throw new Error('No dated FFmpeg autobuild available');
  const amd64 = release.assets?.filter(asset => /^ffmpeg-(.+)-linux64-gpl\.tar\.xz$/.test(asset.name)) ?? [];
  if (amd64.length !== 1) throw new Error('Missing or duplicate FFmpeg amd64 asset');
  const version = amd64[0].name.match(/^ffmpeg-(.+)-linux64-gpl\.tar\.xz$/)[1];
  const arm64 = release.assets?.filter(asset => /^ffmpeg-(.+)-linuxarm64-gpl\.tar\.xz$/.test(asset.name)) ?? [];
  if (arm64.length !== 1) throw new Error('Missing or duplicate FFmpeg arm64 asset');
  if (arm64[0].name !== `ffmpeg-${version}-linuxarm64-gpl.tar.xz`) throw new Error('FFmpeg architecture version mismatch');
  return {
    ytdlp,
    ffmpeg: {
      release: release.tag_name, version,
      amd64: verifiedAsset(release, FFMPEG_REPO, amd64[0].name),
      arm64: verifiedAsset(release, FFMPEG_REPO, arm64[0].name),
    },
    requirements: `yt-dlp[default,curl-cffi] @ ${ytdlp.url}#sha256=${ytdlp.sha256}\n`,
  };
}

async function github(path) {
  const headers = {Accept: 'application/vnd.github+json', 'User-Agent': 'yt-dlp-GUI-build'};
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`https://api.github.com/repos/${path}`, {headers, signal: AbortSignal.timeout(30000)});
      if (!response.ok) throw new Error(`GitHub ${path}: HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(done => setTimeout(done, 1000 * (attempt + 1)));
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const value = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  const encoded = value('--manifest-base64');
  const manifest = encoded ? JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
    : resolveTools(...await Promise.all([
      github(`${NIGHTLY_REPO}/releases/latest`),
      github(`${FFMPEG_REPO}/releases?per_page=20`),
    ]));
  const output = value('--output') ?? 'build-tools';
  mkdirSync(output, {recursive: true});
  writeFileSync(`${output}/tool-versions.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(`${output}/requirements-docker.txt`, manifest.requirements);
  console.log(`yt-dlp nightly: ${manifest.ytdlp.release}; FFmpeg: ${manifest.ffmpeg.release} (${manifest.ffmpeg.version})`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `manifest=${Buffer.from(JSON.stringify(manifest)).toString('base64')}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### Resolved image tools\n- yt-dlp nightly: ${manifest.ytdlp.release}\n- FFmpeg autobuild: ${manifest.ffmpeg.release} (${manifest.ffmpeg.version})\n- Both architecture archives require SHA256 verification.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {console.error(error.message); process.exitCode = 1;});
}
