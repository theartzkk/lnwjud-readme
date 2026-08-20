#!/usr/bin/env node

import { runDisposableVideoPipelineProbe } from '../../src/video.ts';

try {
  const result = await runDisposableVideoPipelineProbe(process.cwd());
  if (result.frameCount !== 8 || result.fps !== 5 || result.codec !== 'h264' || result.pixelFormat !== 'yuv420p') {
    console.error('AWH_VIDEO_E2E: output contract mismatch');
    process.exitCode = 1;
  } else {
    console.log(`AWH_VIDEO_E2E: PASS (${result.frameCount} frames; ${result.fps} FPS; ${result.codec}/${result.pixelFormat}; order verified)`);
  }
} catch (error) {
  console.error(`AWH_VIDEO_E2E: FAIL (${error instanceof Error ? error.message : 'pipeline failure'})`);
  process.exitCode = 1;
}
