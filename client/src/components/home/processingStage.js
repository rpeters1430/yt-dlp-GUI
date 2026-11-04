import { formatDuration, parseUtc } from '../../format.js';

export function isProcessingStage(stage) {
  return /^processing\b|post-process|processing slot|merging|embedding|applying sponsorblock|saving final file|splitting|extracting audio|finalizing|finishing.*saving/i.test(stage || '');
}
export function processingElapsed(job, now) {
  const since = parseUtc(job?.stage_started_at);
  if (job?.status !== 'downloading' || !isProcessingStage(job.stage) || !since) return null;
  return formatDuration(Math.max(0, (now - since.getTime()) / 1000));
}
