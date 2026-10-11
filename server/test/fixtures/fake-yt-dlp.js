#!/usr/bin/env node
// Stand-in for the yt-dlp binary in tests. Replays the scenario in $FAKE_YTDLP (JSON):
//   steps:     [{ out }, { err }, { raw }, { sleep: ms }] written/applied in order
//   exit:      exit code once the steps are done (default 0)
//   hang:      keep running after the steps, printing nothing (for the idle watchdog)
//   heartbeat: keep printing a progress line every 50ms after the steps
//   onSigint:  { out, exit } what to print and the exit code when sent SIGINT
const scenario = JSON.parse(process.env.FAKE_YTDLP || '{}');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (scenario.onSigint) {
  process.on('SIGINT', () => {
    if (scenario.onSigint.out) process.stdout.write(`${scenario.onSigint.out}\n`);
    process.exit(scenario.onSigint.exit ?? 1);
  });
}

(async () => {
  for (const step of scenario.steps || []) {
    if (step.out !== undefined) process.stdout.write(`${step.out}\n`);
    if (step.err !== undefined) process.stderr.write(`${step.err}\n`);
    if (step.raw !== undefined) process.stdout.write(step.raw);
    if (step.sleep) await sleep(step.sleep);
  }
  if (scenario.heartbeat) {
    setInterval(() => process.stdout.write('YTDLP_PROGRESS  50.0%|1.00MiB/s|00:10\n'), 50);
    return;
  }
  if (scenario.hang) {
    setInterval(() => {}, 1000);
    return;
  }
  process.exit(scenario.exit ?? 0);
})();
