import React from 'react';
import { useNow } from '../../hooks/useNow.js';
import { isProcessingStage, processingElapsed } from './processingStage.js';

export default function ProcessingStage({ job }) {
  const now = useNow(job?.status === 'downloading' && isProcessingStage(job.stage));
  const elapsed = processingElapsed(job, now);
  return <span className="telemetry-stage">{job?.stage}{elapsed && ` · ${elapsed} elapsed`}</span>;
}
