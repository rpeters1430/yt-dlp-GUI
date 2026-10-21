import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Exercise selection against release payloads: a missing architecture or digest
// must stop publication instead of silently choosing older or unverified tools.
const nightly = {tag_name: '2026.10.10.233141', assets: [asset('yt-dlp/yt-dlp-nightly-builds', '2026.10.10.233141', 'yt-dlp.tar.gz')]};
function asset(repo, tag, name) {
  return {name, digest: `sha256:${'a'.repeat(64)}`, browser_download_url: `https://github.com/${repo}/releases/download/${tag}/${name}`};
}
function ffmpeg(tag = 'autobuild-2026-10-20-18-29', version = 'N-127798-g1c767fe664') {
  return {tag_name: tag, draft: false, prerelease: false, assets: ['linux64', 'linuxarm64'].map(arch => asset('yt-dlp/FFmpeg-Builds', tag, `ffmpeg-${version}-${arch}-gpl.tar.xz`))};
}
async function resolve(...args) {
  const {resolveTools} = await import('./resolve-tools.mjs');
  return resolveTools(...args);
}

test('selects the newest dated FFmpeg autobuild and pins the exact nightly source', async () => {
  const result = await resolve(nightly, [ffmpeg('autobuild-2026-10-19-19-51'), {tag_name: 'latest'}, ffmpeg()]);
  assert.equal(result.ytdlp.release, nightly.tag_name);
  assert.equal(result.ytdlp.sha256, 'a'.repeat(64));
  assert.equal(result.ffmpeg.release, 'autobuild-2026-10-20-18-29');
  assert.match(result.ffmpeg.amd64.url, /linux64-gpl.tar.xz$/);
  assert.match(result.ffmpeg.arm64.url, /linuxarm64-gpl.tar.xz$/);
  assert.match(result.requirements, /yt-dlp\[default,curl-cffi\] @ https:\/\/github.com\/yt-dlp\/yt-dlp-nightly-builds\/releases\/download\/2026.10.10.233141\/yt-dlp.tar.gz#sha256=a{64}/);
});
test('fails if the newest autobuild lacks arm64 rather than falling back', async () => {
  const latest = ffmpeg(); latest.assets.pop();
  await assert.rejects(resolve(nightly, [latest, ffmpeg('autobuild-2026-10-19-19-51')]), /arm64/);
});
test('rejects absent or malformed checksums for both tools', async () => {
  for (const digest of [undefined, '', 'sha256:bad']) {
    const bad = structuredClone(nightly); bad.assets[0].digest = digest;
    await assert.rejects(resolve(bad, [ffmpeg()]), /digest/);
    const ff = ffmpeg(); ff.assets[0].digest = digest;
    await assert.rejects(resolve(nightly, [ff]), /digest/);
  }
});
test('rejects asset URLs outside the selected official release', async () => {
  const bad = structuredClone(nightly); bad.assets[0].browser_download_url = 'https://example.com/tool.tar.gz';
  await assert.rejects(resolve(bad, [ffmpeg()]), /URL/);
});
test('rejects mismatched FFmpeg versions across architectures', async () => {
  const ff = ffmpeg(); ff.assets[1] = asset('yt-dlp/FFmpeg-Builds', ff.tag_name, 'ffmpeg-N-other-linuxarm64-gpl.tar.xz');
  await assert.rejects(resolve(nightly, [ff]), /version/);
});
test('ignores drafts and prereleases and fails without a dated autobuild', async () => {
  await assert.rejects(resolve(nightly, [{...ffmpeg(), draft: true}, {...ffmpeg(), prerelease: true}, {tag_name: 'latest'}]), /autobuild/);
});
test('passes one resolved selection through the CI build argument into generated Docker files', async () => {
  const manifest = await resolve(nightly, [ffmpeg()]);
  const directory = mkdtempSync(join(tmpdir(), 'ytdlp-tools-'));
  try {
    const output = join(directory, 'github-output');
    const summary = join(directory, 'summary');
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./resolve-tools.mjs', import.meta.url)),
      '--manifest-base64', Buffer.from(JSON.stringify(manifest)).toString('base64'), '--output', directory], {
      encoding: 'utf8', env: {...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary},
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'tool-versions.json'))), manifest);
    assert.equal(readFileSync(join(directory, 'requirements-docker.txt'), 'utf8'), manifest.requirements);
    const encoded = readFileSync(output, 'utf8').trim().slice('manifest='.length);
    assert.deepEqual(JSON.parse(Buffer.from(encoded, 'base64').toString()), manifest);
    assert.match(readFileSync(summary, 'utf8'), /2026.10.10.233141/);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});
