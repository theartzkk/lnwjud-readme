import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile, resolveExecutable } from './process.js';

const MAX_FRAMES = 240;
const FRAME_WIDTH = 32;
const FRAME_HEIGHT = 32;
const FRAME_RATE = 5;
const FRAME_COLORS = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255],
  [0, 0, 0],
] as const;

export type VideoPipelineErrorCode =
  | 'TOOL_UNAVAILABLE'
  | 'TOOL_VERSION_FAILED'
  | 'FRAME_SEQUENCE_INVALID'
  | 'FRAME_SEQUENCE_CORRUPT'
  | 'VIDEO_ENCODE_FAILED'
  | 'VIDEO_PROBE_FAILED'
  | 'VIDEO_OUTPUT_INVALID'
  | 'VIDEO_FRAME_ORDER_INVALID';

export class VideoPipelineError extends Error {
  constructor(public readonly code: VideoPipelineErrorCode, message: string) {
    super(message);
    this.name = 'VideoPipelineError';
  }
}

export interface VideoExecutables {
  ffmpeg: string;
  ffprobe: string;
}

export interface FrameSequenceOptions {
  workspace: string;
  framesDir: string;
  outputPath: string;
  fps: number;
  expectedFrameCount: number;
  timeoutMs?: number;
}

export interface VideoPipelineResult {
  frameCount: number;
  durationSec: number;
  fps: number;
  timeBase: string;
  codec: string;
  pixelFormat: string;
  ffmpegVersion: string;
  ffprobeVersion: string;
}

export interface DisposableVideoProbeResult extends VideoPipelineResult {
  frameOrder: string[];
}

function safeChildEnvironment(): NodeJS.ProcessEnv {
  const allowed = ['PATH', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'TMP', 'TEMP', 'TMPDIR', 'HOME', 'USER', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'LC_ALL'];
  const env: NodeJS.ProcessEnv = { AWH_ALLOW_WRITE: '0', AWH_ALLOW_EXEC: '0', AWH_ALLOW_CODEX: '0' };
  for (const key of allowed) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}

function requireAbsolutePath(value: string, field: string): void {
  if (!isAbsolute(value) || /[\u0000-\u001f\u007f]/.test(value)) throw new VideoPipelineError('FRAME_SEQUENCE_INVALID', `${field} must be an absolute safe path`);
}

function boundedRate(fps: number): void {
  if (!Number.isInteger(fps) || fps < 1 || fps > 60) throw new VideoPipelineError('FRAME_SEQUENCE_INVALID', 'Video FPS must be an integer from 1 to 60');
}

function boundedFrameCount(frameCount: number): void {
  if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > MAX_FRAMES) throw new VideoPipelineError('FRAME_SEQUENCE_INVALID', `Frame count must be from 1 to ${MAX_FRAMES}`);
}

function firstLine(output: string): string {
  return output.split(/\r?\n/, 1)[0]?.trim().slice(0, 240) || 'version unavailable';
}

async function runVersion(executable: string, label: string, workspace: string, timeoutMs: number): Promise<string> {
  const result = await execFile(executable, ['-version'], workspace, timeoutMs, safeChildEnvironment());
  if (result.code !== 0) throw new VideoPipelineError('TOOL_VERSION_FAILED', `${label} version probe failed`);
  return firstLine(result.stdout || result.stderr);
}

export async function resolveVideoExecutables(): Promise<VideoExecutables> {
  try {
    return { ffmpeg: await resolveExecutable('ffmpeg'), ffprobe: await resolveExecutable('ffprobe') };
  } catch {
    throw new VideoPipelineError('TOOL_UNAVAILABLE', 'FFmpeg and FFprobe are not both available');
  }
}

function ppmForColor(rgb: readonly [number, number, number]): Buffer {
  const header = Buffer.from(`P6\n${FRAME_WIDTH} ${FRAME_HEIGHT}\n255\n`, 'ascii');
  const pixels = Buffer.alloc(FRAME_WIDTH * FRAME_HEIGHT * 3);
  for (let index = 0; index < pixels.length; index += 3) {
    pixels[index] = rgb[0];
    pixels[index + 1] = rgb[1];
    pixels[index + 2] = rgb[2];
  }
  return Buffer.concat([header, pixels]);
}

export async function writeDeterministicFrameSequence(framesDir: string, frameCount: number): Promise<string[]> {
  requireAbsolutePath(framesDir, 'framesDir');
  boundedFrameCount(frameCount);
  await mkdir(framesDir, { recursive: true, mode: 0o700 });
  const order: string[] = [];
  for (let index = 0; index < frameCount; index += 1) {
    const token = `frame-${index}`;
    await writeFile(join(framesDir, `frame-${String(index).padStart(4, '0')}.ppm`), ppmForColor(FRAME_COLORS[index % FRAME_COLORS.length]!), { mode: 0o600 });
    order.push(token);
  }
  return order;
}

async function validateInputFrames(framesDir: string, expectedFrameCount: number): Promise<void> {
  const entries = await readdir(framesDir, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).filter((name) => /^frame-\d{4}\.ppm$/.test(name)).sort();
  if (names.length !== expectedFrameCount) throw new VideoPipelineError('FRAME_SEQUENCE_INVALID', `Expected ${expectedFrameCount} frames but found ${names.length}`);
  for (let index = 0; index < expectedFrameCount; index += 1) {
    const expected = `frame-${String(index).padStart(4, '0')}.ppm`;
    if (names[index] !== expected) throw new VideoPipelineError('FRAME_SEQUENCE_INVALID', `Frame sequence is missing or out of order at index ${index}`);
    const info = await lstat(join(framesDir, expected));
    if (!info.isFile() || info.isSymbolicLink() || info.size < 20 || info.size > 2 * 1024 * 1024) throw new VideoPipelineError('FRAME_SEQUENCE_CORRUPT', `Frame ${index} is not a valid bounded regular file`);
    const data = await readFile(join(framesDir, expected));
    const header = /^P6\s+32\s+32\s+255\s/.exec(data.subarray(0, 128).toString('ascii'));
    const expectedBytes = header ? header[0].length + FRAME_WIDTH * FRAME_HEIGHT * 3 : -1;
    if (!header || data.length !== expectedBytes) throw new VideoPipelineError('FRAME_SEQUENCE_CORRUPT', `Frame ${index} has an invalid PPM header or payload`);
  }
}

function ratio(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parts = value.split('/').map(Number);
  const numerator = parts[0];
  const denominator = parts[1];
  if (numerator === undefined || denominator === undefined) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

async function verifyOutput(ffprobe: string, options: FrameSequenceOptions, ffmpegVersion: string, ffprobeVersion: string): Promise<VideoPipelineResult> {
  const result = await execFile(ffprobe, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-count_frames',
    '-show_entries', 'stream=codec_name,pix_fmt,r_frame_rate,avg_frame_rate,time_base,duration,nb_read_frames,nb_frames',
    '-of', 'json',
    options.outputPath,
  ], options.workspace, options.timeoutMs ?? 30_000, safeChildEnvironment());
  if (result.code !== 0) throw new VideoPipelineError('VIDEO_PROBE_FAILED', 'FFprobe could not read the encoded video');
  let parsed: { streams?: Array<Record<string, unknown>> };
  try { parsed = JSON.parse(result.stdout) as { streams?: Array<Record<string, unknown>> }; } catch { throw new VideoPipelineError('VIDEO_PROBE_FAILED', 'FFprobe returned malformed metadata'); }
  const stream = parsed.streams?.[0];
  if (!stream) throw new VideoPipelineError('VIDEO_OUTPUT_INVALID', 'Encoded video has no video stream');
  const frameCount = Number(stream.nb_read_frames ?? stream.nb_frames);
  const durationSec = Number(stream.duration);
  const fps = ratio(stream.avg_frame_rate ?? stream.r_frame_rate);
  const timeBase = typeof stream.time_base === 'string' ? stream.time_base : '';
  const codec = typeof stream.codec_name === 'string' ? stream.codec_name : '';
  const pixelFormat = typeof stream.pix_fmt === 'string' ? stream.pix_fmt : '';
  const expectedDuration = options.expectedFrameCount / options.fps;
  if (frameCount !== options.expectedFrameCount) throw new VideoPipelineError('VIDEO_OUTPUT_INVALID', `Encoded video frame count ${frameCount} does not match ${options.expectedFrameCount}`);
  if (!Number.isFinite(durationSec) || Math.abs(durationSec - expectedDuration) > 0.02) throw new VideoPipelineError('VIDEO_OUTPUT_INVALID', 'Encoded video duration does not match the requested frame rate');
  if (fps === null || Math.abs(fps - options.fps) > 0.001) throw new VideoPipelineError('VIDEO_OUTPUT_INVALID', 'Encoded video FPS does not match the requested FPS');
  if (!ratio(timeBase)) throw new VideoPipelineError('VIDEO_OUTPUT_INVALID', 'Encoded video timebase is invalid');
  if (codec !== 'h264' || pixelFormat !== 'yuv420p') throw new VideoPipelineError('VIDEO_OUTPUT_INVALID', `Encoded video format is not broadly compatible: ${codec}/${pixelFormat}`);
  return { frameCount, durationSec, fps, timeBase, codec, pixelFormat, ffmpegVersion, ffprobeVersion };
}

export async function runFrameSequenceToMp4(options: FrameSequenceOptions): Promise<VideoPipelineResult> {
  requireAbsolutePath(options.workspace, 'workspace');
  requireAbsolutePath(options.framesDir, 'framesDir');
  requireAbsolutePath(options.outputPath, 'outputPath');
  boundedRate(options.fps);
  boundedFrameCount(options.expectedFrameCount);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const tools = await resolveVideoExecutables();
  const ffmpegVersion = await runVersion(tools.ffmpeg, 'FFmpeg', options.workspace, timeoutMs);
  const ffprobeVersion = await runVersion(tools.ffprobe, 'FFprobe', options.workspace, timeoutMs);
  try { await access(options.framesDir, constants.R_OK); } catch { throw new VideoPipelineError('FRAME_SEQUENCE_INVALID', 'Frame directory is unavailable'); }
  await validateInputFrames(options.framesDir, options.expectedFrameCount);
  const outputResult = await execFile(tools.ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-framerate', String(options.fps),
    '-start_number', '0',
    '-i', join(options.framesDir, 'frame-%04d.ppm'),
    '-frames:v', String(options.expectedFrameCount),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-r', String(options.fps),
    '-movflags', '+faststart',
    options.outputPath,
  ], options.workspace, timeoutMs, safeChildEnvironment());
  if (outputResult.code !== 0) throw new VideoPipelineError('VIDEO_ENCODE_FAILED', 'FFmpeg frame-sequence encoding failed');
  return verifyOutput(tools.ffprobe, options, ffmpegVersion, ffprobeVersion);
}

function ppmCenterRgb(data: Buffer): readonly [number, number, number] {
  let cursor = 0;
  const tokens: string[] = [];
  while (tokens.length < 4) {
    while (cursor < data.length && /\s/.test(String.fromCharCode(data[cursor]!))) cursor += 1;
    if (data[cursor] === 35) { while (cursor < data.length && data[cursor] !== 10) cursor += 1; continue; }
    const start = cursor;
    while (cursor < data.length && !/\s/.test(String.fromCharCode(data[cursor]!))) cursor += 1;
    tokens.push(data.subarray(start, cursor).toString('ascii'));
  }
  if (tokens[0] !== 'P6' || tokens[1] !== String(FRAME_WIDTH) || tokens[2] !== String(FRAME_HEIGHT) || tokens[3] !== '255') throw new VideoPipelineError('VIDEO_FRAME_ORDER_INVALID', 'Decoded frame has an unexpected PPM header');
  while (cursor < data.length && /\s/.test(String.fromCharCode(data[cursor]!))) cursor += 1;
  const center = ((FRAME_HEIGHT / 2) * FRAME_WIDTH + FRAME_WIDTH / 2) * 3;
  return [data[cursor + center] ?? -1, data[cursor + center + 1] ?? -1, data[cursor + center + 2] ?? -1];
}

function nearestColor(rgb: readonly [number, number, number]): string {
  const names = ['red', 'green', 'blue', 'yellow', 'magenta', 'cyan', 'white', 'black'];
  let best = Number.POSITIVE_INFINITY;
  let token = '';
  for (let index = 0; index < FRAME_COLORS.length; index += 1) {
    const color = FRAME_COLORS[index]!;
    const distance = (rgb[0] - color[0]) ** 2 + (rgb[1] - color[1]) ** 2 + (rgb[2] - color[2]) ** 2;
    if (distance < best) { best = distance; token = names[index]!; }
  }
  if (best > 40_000) throw new VideoPipelineError('VIDEO_FRAME_ORDER_INVALID', 'Decoded frame color is not deterministic');
  return token;
}

export async function runDisposableVideoPipelineProbe(workspace: string): Promise<DisposableVideoProbeResult> {
  requireAbsolutePath(workspace, 'workspace');
  const root = await mkdtemp(join(tmpdir(), 'AWH video E2E space ไทย-'));
  const framesDir = join(root, 'frames with spaces ไทย');
  const outputPath = join(root, 'encoded output space ไทย.mp4');
  const decodeDir = join(root, 'decoded frames space ไทย');
  const frameCount = 8;
  try {
    await writeDeterministicFrameSequence(framesDir, frameCount);
    const result = await runFrameSequenceToMp4({ workspace, framesDir, outputPath, fps: FRAME_RATE, expectedFrameCount: frameCount });
    await mkdir(decodeDir, { recursive: true, mode: 0o700 });
    const tools = await resolveVideoExecutables();
    const decoded = await execFile(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', outputPath, '-fps_mode', 'passthrough', '-start_number', '0', '-y', join(decodeDir, 'decoded-%04d.ppm')], workspace, 30_000, safeChildEnvironment());
    if (decoded.code !== 0) throw new VideoPipelineError('VIDEO_FRAME_ORDER_INVALID', 'FFmpeg could not decode the encoded video');
    const names = (await readdir(decodeDir)).filter((name) => /^decoded-\d{4}\.ppm$/.test(name)).sort();
    if (names.length !== frameCount) throw new VideoPipelineError('VIDEO_FRAME_ORDER_INVALID', `Decoded frame count ${names.length} does not match ${frameCount}`);
    const frameOrder = [];
    const expectedOrder = ['red', 'green', 'blue', 'yellow', 'magenta', 'cyan', 'white', 'black'];
    for (const name of names) frameOrder.push(nearestColor(ppmCenterRgb(await readFile(join(decodeDir, name)))));
    if (frameOrder.some((token, index) => token !== expectedOrder[index])) throw new VideoPipelineError('VIDEO_FRAME_ORDER_INVALID', 'Decoded frame ordering does not match the deterministic source sequence');
    return { ...result, frameOrder };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
