const { spawn } = require('child_process');

const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || '/downloads';

// Runs `yt-dlp -J <url>` to fetch metadata (title, id, extractor, thumbnail, formats)
// without downloading anything. Used for the format picker and for watch/history dedup.
function getInfo(url, { flatPlaylist = false } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-J', '--no-warnings'];
    if (flatPlaylist) args.push('--flat-playlist');
    args.push(url);

    const proc = spawn(YTDLP_BIN, args);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr || `yt-dlp exited with code ${code}`));
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error('Failed to parse yt-dlp JSON output: ' + e.message));
      }
    });
    proc.on('error', reject);
  });
}

// Progress-template gives us a stable, parseable line for every progress tick instead of
// scraping the human-readable percentage string, which varies by yt-dlp version/locale.
const PROGRESS_TEMPLATE = 'YTDLP_PROGRESS %(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s';

function buildFormatSelector({ audioOnly, formatSelector }) {
  if (audioOnly) return 'bestaudio/best';
  if (formatSelector) return formatSelector;
  return 'bestvideo*+bestaudio/best';
}

// Downloads a single URL, streaming progress updates via onProgress({percent, speed, eta}).
// Resolves with { filepath } once yt-dlp exits successfully.
function download(url, options, onProgress) {
  const { audioOnly = false, formatSelector = '', subtitles = false } = options;

  return new Promise((resolve, reject) => {
    const args = [
      '--newline',
      '--no-warnings',
      '--progress-template', PROGRESS_TEMPLATE,
      '-o', `${DOWNLOAD_DIR}/%(uploader,extractor)s/%(title)s [%(id)s].%(ext)s`,
      '--print', 'after_move:FILEPATH %(filepath)s',
    ];

    if (audioOnly) {
      args.push('-x', '--audio-format', 'mp3', '-f', buildFormatSelector({ audioOnly }));
    } else {
      args.push('-f', buildFormatSelector({ formatSelector }));
      args.push('--merge-output-format', 'mp4');
    }

    if (subtitles) {
      args.push('--write-subs', '--write-auto-subs', '--sub-langs', 'en.*', '--embed-subs');
    }

    args.push(url);

    const proc = spawn(YTDLP_BIN, args);
    let stderr = '';
    let filepath = null;

    proc.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        if (line.startsWith('YTDLP_PROGRESS')) {
          const rest = line.replace('YTDLP_PROGRESS', '').trim();
          const [percentStr, speed, eta] = rest.split('|');
          const percent = parseFloat(percentStr.replace('%', '').trim());
          if (!Number.isNaN(percent)) {
            onProgress({ percent, speed: speed && speed.trim(), eta: eta && eta.trim() });
          }
        } else if (line.startsWith('FILEPATH ')) {
          filepath = line.replace('FILEPATH ', '').trim();
        }
      }
    });

    proc.stderr.on('data', (d) => (stderr += d));

    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr || `yt-dlp exited with code ${code}`));
      resolve({ filepath });
    });
    proc.on('error', reject);
  });
}

module.exports = { getInfo, download };
