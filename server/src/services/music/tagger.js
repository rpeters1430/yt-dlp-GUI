const path = require('path');
const { spawn } = require('child_process');

function runTagger(payload) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.env.PYTHON_BIN || 'python3', [path.join(__dirname, 'tag_audio.py')], {stdio:['pipe','pipe','pipe']});
    let output = '', error = '';
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('Music tagging timed out; original audio retained')); }, 120000);
    proc.stdout.on('data', data => { output += data; });
    proc.stderr.on('data', data => { error = (error + data).slice(-8000); });
    proc.stdin.on('error', () => {}); // spawn/exit handlers report a failed helper.
    proc.on('error', err => { clearTimeout(timer); reject(err); });
    proc.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`Music tagging failed: ${error.trim() || `exit ${code}`}`));
      try { resolve(JSON.parse(output)); } catch { reject(new Error('Music tagger returned invalid verification data')); }
    });
    proc.stdin.end(JSON.stringify(payload));
  });
}
function writeVerifiedTags(filepath, metadata, artwork = null, options = {}) {
  return runTagger({filepath, metadata, artwork:artwork ? {data:artwork.data.toString('base64')} : null,
    scrub:options.scrub !== false, expectedSha256:options.expectedSha256, clearFields:options.clearFields || []});
}
function inspectAudio(filepath, metadata = {}) {
  return runTagger({operation:'inspect', filepath, metadata});
}
module.exports = {writeVerifiedTags, inspectAudio};
