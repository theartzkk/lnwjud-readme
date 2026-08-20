import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { resolveVideoExecutables, runDisposableVideoPipelineProbe, runFrameSequenceToMp4, VideoPipelineError, writeDeterministicFrameSequence } from '../src/video.js';

let mediaAvailable = true;
try { await resolveVideoExecutables(); } catch { mediaAvailable = false; }

test('video tools resolve through packaged-GUI-style fallback locations', { skip: !mediaAvailable }, async () => {
  const originalPath = process.env.PATH;
  process.env.PATH = '/usr/bin:/bin';
  try {
    const tools = await resolveVideoExecutables();
    assert.equal(isAbsolute(tools.ffmpeg), true);
    assert.equal(isAbsolute(tools.ffprobe), true);
    await access(tools.ffmpeg, constants.X_OK);
    await access(tools.ffprobe, constants.X_OK);
  } finally {
    if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
  }
});

test('real frame sequence to MP4 E2E verifies ordering, count, duration, FPS, codec and pixel format', { skip: !mediaAvailable }, async () => {
  const result = await runDisposableVideoPipelineProbe(process.cwd());
  assert.equal(result.frameCount, 8);
  assert.equal(result.fps, 5);
  assert.ok(Math.abs(result.durationSec - 1.6) <= 0.02);
  assert.match(result.timeBase, /^\d+\/\d+$/);
  assert.equal(result.codec, 'h264');
  assert.equal(result.pixelFormat, 'yuv420p');
  assert.deepEqual(result.frameOrder, ['red', 'green', 'blue', 'yellow', 'magenta', 'cyan', 'white', 'black']);
  assert.match(result.ffmpegVersion, /ffmpeg version/i);
  assert.match(result.ffprobeVersion, /ffprobe version/i);
});

test('missing frames fail closed with bounded reporting', { skip: !mediaAvailable }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'AWH video missing space ไทย-'));
  try {
    const framesDir = join(root, 'frames with spaces ไทย');
    await writeDeterministicFrameSequence(framesDir, 3);
    await unlink(join(framesDir, 'frame-0001.ppm'));
    await assert.rejects(
      () => runFrameSequenceToMp4({ workspace: process.cwd(), framesDir, outputPath: join(root, 'missing.mp4'), fps: 5, expectedFrameCount: 3 }),
      (error: unknown) => error instanceof VideoPipelineError && error.code === 'FRAME_SEQUENCE_INVALID' && /found 2/.test(error.message),
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('corrupt frames fail through the FFmpeg runner without shell interpolation', { skip: !mediaAvailable }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'AWH video corrupt space ไทย-'));
  try {
    const framesDir = join(root, 'frames with spaces ไทย');
    await writeDeterministicFrameSequence(framesDir, 3);
    await writeFile(join(framesDir, 'frame-0001.ppm'), Buffer.alloc(64, 0x78));
    await assert.rejects(
      () => runFrameSequenceToMp4({ workspace: process.cwd(), framesDir, outputPath: join(root, 'corrupt output ไทย.mp4'), fps: 5, expectedFrameCount: 3 }),
      (error: unknown) => error instanceof VideoPipelineError && error.code === 'FRAME_SEQUENCE_CORRUPT' && !error.message.includes(root),
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('video pipeline uses fixed argv execution and explicit media contract', async () => {
  const source = await readFile(new URL('../src/video.ts', import.meta.url), 'utf8');
  assert.match(source, /execFile/);
  assert.doesNotMatch(source, /spawn\(|shell\s*:\s*true/);
  assert.match(source, /'-i', join/);
  assert.match(source, /'-pix_fmt', 'yuv420p'/);
  assert.match(source, /'-movflags', '\+faststart'/);
  assert.match(source, /ffprobe/);
});
