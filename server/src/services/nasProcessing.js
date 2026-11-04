const fs = require('node:fs');
const path = require('node:path');

const PLUGIN_DIR = path.resolve(__dirname, '../../yt-dlp-plugins');
function enabled() {
  return !/^(0|false|no|off)$/i.test(String(process.env.NAS_POSTPROCESSING || '').trim());
}
function pluginArgs(options) {
  if (!enabled()) return [];
  const fuse = Boolean(options.embedMetadata && !options.subtitles && !options.embedChapters
    && !options.sponsorblockRemove?.length && !options.splitLiveChunks && !options.postprocessorArgs);
  return ['--plugin-dirs', 'default', '--plugin-dirs', PLUGIN_DIR, '--use-postprocessor', `NasOptimizer:fuse=${fuse};when=pre_process`];
}
function workingPaths(output, options) {
  const configured = (process.env.YTDLP_WORK_DIR || '').trim();
  if (!configured || options.isLive || options.waitForLive) return { output, args: [], directory: null };
  if (!path.isAbsolute(configured)) throw new Error('YTDLP_WORK_DIR must be an absolute path');
  const id = options.jobId || 'manual';
  if (!/^[\w-]+$/.test(id)) throw new Error('Invalid work directory job ID');
  const directory = path.join(configured, id);
  const absolute = path.resolve(output);
  const root = path.parse(absolute).root;
  return { output: absolute.slice(root.length), args: ['--paths', `home:${root}`, '--paths', `temp:${directory}`], directory };
}
function prepareWorkDirectory(output, options) {
  const { directory } = workingPaths(output, options);
  if (!directory) return;
  fs.mkdirSync(directory, { recursive: true });
  fs.accessSync(directory, fs.constants.W_OK);
  if (typeof fs.statfsSync === 'function') {
    const stat = fs.statfsSync(directory);
    const free = Number(stat.bavail) * Number(stat.bsize);
    // Sources plus the merged output coexist; fail before downloading into an undersized workspace.
    const required = Math.max(512 * 1024 * 1024, (Number(options.estimatedSize) || 0) * 2.2);
    if (free < required) throw new Error(`Not enough free space in YTDLP_WORK_DIR (need at least ${Math.ceil(required / 1024 ** 3)} GiB)`);
  }
}
function cleanupEmptyWorkDirectory(output, options) {
  const { directory } = workingPaths(output, options);
  if (!directory) return;
  function removeEmpty(folder) {
    try {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        if (entry.isDirectory()) removeEmpty(path.join(folder, entry.name));
      }
      fs.rmdirSync(folder); // Fails safely if any partial/other file remains.
    } catch (_) {}
  }
  removeEmpty(directory);
}
function clearFailedWorkDirectory(output, options) {
  const { directory } = workingPaths(output, options);
  if (!directory) return false;
  // Only the validated, dedicated job directory is ours; never delete a home output here.
  try { fs.rmSync(directory, { recursive: true, force: true }); } catch (error) {
    console.warn(`[nas] Could not clear job work directory: ${error.message}`);
  }
  return true;
}
module.exports = { clearFailedWorkDirectory, enabled, pluginArgs, workingPaths, prepareWorkDirectory, cleanupEmptyWorkDirectory };
