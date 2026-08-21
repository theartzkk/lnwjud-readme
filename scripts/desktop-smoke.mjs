#!/usr/bin/env node

import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function safeEnvironment(dataDir) {
  const allowed = ['PATH', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'TMP', 'TEMP', 'TMPDIR', 'HOME', 'USER', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'LC_ALL', 'TERM', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR'];
  const env = { AWH_DATA_DIR: dataDir, AWH_WORKSPACE: ROOT, AWH_ALLOW_WRITE: '0', AWH_ALLOW_EXEC: '0', AWH_ALLOW_CODEX: '0' };
  for (const key of allowed) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}

async function exists(path) {
  try { await access(path, constants.F_OK); return true; } catch { return false; }
}

function run(executable, args, env, timeoutMs = 45_000) {
  return new Promise((resolveResult) => {
    const child = spawn(executable, args, { cwd: ROOT, env, shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { if (stderr.length < 4_096) stderr += chunk.slice(0, 4_096 - stderr.length); });
    child.once('error', (error) => { clearTimeout(timer); resolveResult({ code: -1, timedOut, error: error.message, stderr }); });
    child.once('close', (code) => { clearTimeout(timer); resolveResult({ code: code ?? -1, timedOut, error: null, stderr }); });
  });
}

const configuredDataDir = typeof process.env.ART_AGENT_DATA_DIR === 'string' && process.env.ART_AGENT_DATA_DIR.trim() !== ''
  ? process.env.ART_AGENT_DATA_DIR
  : null;
const dataRoot = configuredDataDir ? null : await mkdtemp(join(tmpdir(), 'awh-desktop-smoke-'));
const dataDir = configuredDataDir ?? join(dataRoot, 'data');
try {
  const electronCli = join(ROOT, 'node_modules', 'electron', 'cli.js');
  if (!(await exists(electronCli))) throw new Error('Electron CLI is unavailable');
  const electronApp = join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app');
  const launcher = process.platform === 'darwin' && await exists(electronApp)
    ? { executable: '/usr/bin/open', args: ['-W', '-n', electronApp, '--args', ROOT, '--smoke-test', '--smoke-data-dir', dataDir, '--smoke-workspace', ROOT] }
    : { executable: process.execPath, args: [electronCli, ROOT, '--smoke-test', '--smoke-data-dir', dataDir, '--smoke-workspace', ROOT] };
  const result = await run(launcher.executable, launcher.args, safeEnvironment(dataDir));
  const markerPath = join(dataDir, 'desktop-smoke.json');
  let marker = null;
  try { marker = JSON.parse(await readFile(markerPath, 'utf8')); } catch { /* The runtime may abort before application code starts. */ }

  if (result.code === 0 && marker?.ok === true && marker?.stage === 'passed') {
    console.log('AWH_DESKTOP_SMOKE: PASS');
    process.exitCode = 0;
  } else if (process.platform === 'darwin' && marker === null && (
    /-10822|kLSServerCommunicationErr/i.test(result.stderr) ||
    (result.code === 134 && /SIGABRT|AppKit|_RegisterApplication|GetCurrentProcess/i.test(result.stderr))
  )) {
    console.error('AWH_DESKTOP_SMOKE: GUI_SANDBOX_BLOCKED');
    console.error('Codex/macOS GUI sandbox prevented LaunchServices/AppKit application registration; no AWH runtime result is claimed. Run this smoke from a logged-in macOS GUI session outside Codex.');
    process.exitCode = 2;
  } else if (marker === null && (result.code === 134 || /SIGABRT|AppKit/i.test(result.stderr))) {
    console.error('AWH_DESKTOP_SMOKE: FAIL_RUNTIME');
    console.error('Electron aborted in native AppKit before AWH application startup; no AWH main-process or renderer marker was produced.');
    process.exitCode = 1;
  } else {
    const detail = result.stderr.trim().replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 600);
    console.error(`AWH_DESKTOP_SMOKE: FAIL (exit=${result.code}; marker=${marker?.stage ?? 'unavailable'}${result.timedOut ? '; timeout' : ''}${detail ? `; detail=${detail}` : ''})`);
    process.exitCode = 1;
  }
} finally {
  if (dataRoot) await rm(dataRoot, { recursive: true, force: true });
}
