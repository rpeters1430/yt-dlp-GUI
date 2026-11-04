// Real yt-dlp + bundled plugin + shared gate + optional work path, without external sites.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

async function main() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-download-integration-'));
  process.env.CONFIG_DIR = path.join(folder, 'config');
  process.env.YTDLP_BIN = process.env.YTDLP_TEST_BIN;
  assert.ok(process.env.YTDLP_BIN, 'YTDLP_TEST_BIN must name the installed yt-dlp');
  process.env.YTDLP_WORK_DIR = path.join(folder, 'work');
  process.env.ALLOW_LOCAL_URLS = '1';
  const { download } = require('../../server/src/services/ytdlp');
  const { processingGate } = require('../../server/src/services/processingGate');
  const source = path.join(folder, 'source.mp4');
  assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=s=64x64:d=1', '-c:v', 'mpeg4', source]).status, 0);
  const server = http.createServer((_req, response) => {
    response.setHeader('Content-Type', 'video/mp4');
    response.setHeader('Content-Length', fs.statSync(source).size);
    fs.createReadStream(source).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const release = await processingGate.acquire();
  let waitingAt;
  let startedAt;
  let releaseTimer;
  try {
    const result = await download(`http://127.0.0.1:${server.address().port}/source.mp4`, {
      jobId: 'integration', outputTemplate: path.join(folder, 'library', '%(title)s.%(ext)s'), embedMetadata: true,
    }, progress => {
      if (progress.stage === 'Waiting for processing slot — embedding metadata…') {
        waitingAt = Date.now();
        releaseTimer = setTimeout(release, 150);
      }
      if (progress.stage === 'Embedding metadata…') startedAt = Date.now();
    });
    assert.ok(fs.existsSync(result.filepath));
    assert.equal(path.dirname(result.filepath), path.join(folder, 'library'));
    assert.ok(startedAt - waitingAt >= 120, 'the real Python operation must wait for the Node-held permit');
    assert.equal(fs.existsSync(path.join(folder, 'work', 'integration')), false, 'empty work directories are cleaned');
    console.log('NAS download integration passed');
  } finally {
    clearTimeout(releaseTimer);
    release();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(folder, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
