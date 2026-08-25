import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, open as openFile, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { request as httpRequest } from 'node:http';
import type { TunnelRunState, TunnelStatus } from '@lnwjud/ipc-contracts';
import { probeProcessStart, type ProcessProbeResult } from '@lnwjud/mcp-server';
import { formatTunnelExitMessage, tunnelExitHintFromLog } from './tunnel-exit.js';
import { acquireTunnelLock, readTunnelLock, type TunnelLockAcquisition, type TunnelLockOwner } from './tunnel-lock.js';
import { rewriteTunnelYamlMcpCommand } from './tunnel-profile.js';

const execFileAsync = promisify(execFile);

const PROFILE_NAME = 'lnwjud';
const SECRET_FILE = 'lnwjud.runtime.secret';
const CLIENT_PATH_SETTING = 'tunnel_client_path';
const MCP_CONNECTION_MAX_TTL = '168h0m0s';
const EXTERNAL_PROBE_TTL_MS = 4_000;
const RESTART_DELAY_MS = 3_000;
const MAX_AUTO_RESTARTS = 5;
const RESTART_WINDOW_MS = 30_000;
const MAX_HEALTH_METADATA_BYTES = 64 * 1024;
type ExternalTunnelProbe = 'live' | 'gone' | 'unverifiable';

class StartCancelledError extends Error {}

function throwIfStartCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new StartCancelledError('Tunnel start was cancelled');
}

export interface OwnedProcessIdentity {
  readonly pid: number;
  readonly processStartedAt: string;
}

export interface TunnelControllerOptions {
  readonly getClientPath: () => string | null;
  readonly setClientPath: (value: string) => void;
  readonly getDataPath: () => string;
  readonly getStdioLauncherPath?: () => string | null;
  readonly isExternalTunnelRunning?: () => Promise<boolean>;
  readonly verifiedExternalTunnelPids?: () => Promise<readonly number[]>;
  readonly currentLockOwner?: () => Promise<TunnelLockOwner>;
  readonly inspectLockProcess?: (pid: number) => Promise<ProcessProbeResult>;
  readonly stopTimeoutMs?: number;
  readonly escalationTimeoutMs?: number;
  readonly terminateOwnedProcessTree?: (pid: number) => Promise<void>;
  readonly inspectOwnedProcess?: (pid: number) => Promise<ProcessProbeResult>;
  readonly inspectOwnedProcessTree?: (rootPid: number) => Promise<readonly OwnedProcessIdentity[]>;
  readonly decryptSecret?: (encrypted: string) => Promise<string>;
  readonly probeHealthEndpoint?: (host: string, port: number) => Promise<boolean>;
  readonly healthProbeTimeoutMs?: number;
  readonly inspectFileVersion?: (filePath: string) => Promise<string | null>;
  readonly autoReconnect?: () => boolean;
  readonly maxAutoRestarts?: () => number;
}

export class TunnelController {
  private child: ChildProcess | null = null;
  private ownedChildStartedAt: string | null = null;
  private state: TunnelRunState = 'stopped';
  private message: string | null = null;
  private externalProbeAt = 0;
  private lastExternalProbe: ExternalTunnelProbe = 'unverifiable';
  private foreignOwner: TunnelLockOwner | null = null;
  private intentionalStop = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private restartAttempts = 0;
  private restartWindowStartedAt = 0;
  private lastApiKey: string | null = null;
  private tunnelLock: TunnelLockAcquisition | null = null;
  private lifecycleTail: Promise<void> = Promise.resolve();
  private startInFlight: Promise<TunnelStatus> | null = null;
  private startAbortController: AbortController | null = null;
  private stopInFlight: Promise<TunnelStatus> | null = null;

  public constructor(private readonly options: TunnelControllerOptions) {}

  public profileDirectory(): string {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'tunnel-client');
  }

  public secretPath(): string {
    return path.join(this.profileDirectory(), SECRET_FILE);
  }

  public profilePath(): string {
    return path.join(this.profileDirectory(), `${PROFILE_NAME}.yaml`);
  }

  public logPath(): string {
    return path.join(this.profileDirectory(), 'lnwjud-tunnel.log');
  }

  public defaultClientPath(): string {
    return path.join(os.homedir(), 'Downloads', 'tunnel', 'tunnel-client.exe');
  }

  public resolveClientPath(): string | null {
    const configured = this.options.getClientPath();
    if (configured !== null && configured.trim().length > 0 && existsSync(configured)) return configured;
    const fallback = this.defaultClientPath();
    return existsSync(fallback) ? fallback : configured;
  }

  public async hasApiKey(): Promise<boolean> {
    try {
      const raw = await readFile(this.secretPath(), 'utf8');
      return raw.trim().length > 0;
    } catch {
      return false;
    }
  }

  public async saveApiKey(apiKey: string): Promise<void> {
    const trimmed = apiKey.trim();
    if (trimmed.length === 0) throw new Error('Runtime API key is required');
    await mkdir(this.profileDirectory(), { recursive: true });
    const encrypted = await encryptWithDpapi(trimmed);
    await writeFile(this.secretPath(), encrypted, 'utf8');
  }

  public async configureProfile(tunnelId: string): Promise<string> {
    const normalizedTunnelId = tunnelId.trim();
    if (!/^tunnel_[A-Za-z0-9_-]{8,128}$/.test(normalizedTunnelId)) throw new Error('Tunnel ID is invalid');
    const clientPath = this.resolveClientPath();
    if (clientPath === null || !existsSync(clientPath)) throw new Error('tunnel-client.exe was not found');
    const launcher = this.options.getStdioLauncherPath?.() ?? null;
    if (launcher === null || !existsSync(launcher)) throw new Error('Packaged AWH runtime launcher was not found');
    if (!(await this.hasApiKey())) throw new Error('Save a Runtime API key first');
    const encryptedSecret = await readFile(this.secretPath(), 'utf8');
    const apiKey = (await (this.options.decryptSecret?.(encryptedSecret) ?? decryptWithDpapi(encryptedSecret))).trim();
    if (apiKey.length === 0) throw new Error('Saved Runtime API key is empty; save it again in Settings');
    await mkdir(this.profileDirectory(), { recursive: true });
    try {
      await execFileAsync(clientPath, [
        'init',
        '--sample', 'sample_mcp_stdio_local',
        '--profile', PROFILE_NAME,
        '--tunnel-id', normalizedTunnelId,
        '--mcp-command', launcher,
      ], {
        env: tunnelClientEnv(apiKey, this.profileDirectory(), this.options.getDataPath()),
        windowsHide: true,
        encoding: 'utf8',
        timeout: 60_000,
      });
    } catch (error: unknown) {
      const detail = extractExecDetail(error);
      throw new Error(detail.length > 0 ? detail : 'tunnel-client init failed');
    }
    await this.preferPackagedStdioCommand();
    await runTunnelDoctor(clientPath, apiKey, this.profileDirectory(), this.options.getDataPath());
    return this.profilePath();
  }

  public setClientPath(clientPath: string): string {
    const resolved = path.resolve(clientPath.trim());
    if (!existsSync(resolved)) throw new Error('tunnel-client.exe was not found');
    this.options.setClientPath(resolved);
    return resolved;
  }

  public async status(): Promise<TunnelStatus> {
    const clientPath = this.resolveClientPath();
    let source: TunnelStatus['source'] = 'desktop';
    if (this.child !== null && this.child.exitCode === null) {
      this.state = 'running';
      this.message = null;
    } else if (this.child !== null && this.child.exitCode !== null) {
      this.child = null;
      if (this.state === 'running') this.state = 'stopped';
    } else if (this.tunnelLock === null) {
      // No desktop-owned child: reflect a tunnel started externally (e.g. start-lnwjud-tunnel.ps1).
      const externalProbe = await this.probeExternalRunning();
      if (externalProbe === 'live') {
        this.state = 'running';
        this.message = null;
        source = 'external';
      } else {
        const foreignOwner = await this.verifiedForeignOwner();
        if (foreignOwner !== null) {
          this.state = 'starting';
          this.message = `Tunnel is owned by PID ${foreignOwner.pid}; tunnel process liveness is ${externalProbe === 'unverifiable' ? 'unverifiable' : 'not yet confirmed'}`;
          source = 'external';
        } else if (externalProbe === 'unverifiable') {
          this.state = 'error';
          this.message = 'Tunnel process liveness is unverifiable; refusing to start a possible duplicate';
        } else if (this.state !== 'error' || this.message?.startsWith('Tunnel process liveness is unverifiable') === true) {
          this.state = 'stopped';
          this.message = null;
        }
      }
    }
    return {
      state: this.state,
      source,
      hasApiKey: await this.hasApiKey(),
      clientPath,
      profileExists: existsSync(this.profilePath()),
      message: this.message,
      logPath: this.logPath(),
    };
  }

  private async probeExternalRunning(force = false): Promise<ExternalTunnelProbe> {
    const now = Date.now();
    if (!force && now - this.externalProbeAt < EXTERNAL_PROBE_TTL_MS) return this.lastExternalProbe;
    this.externalProbeAt = now;
    try {
      const result = await (this.options.isExternalTunnelRunning?.() ?? isLnwjudTunnelProcessRunning());
      this.lastExternalProbe = result ? 'live' : 'gone';
    } catch {
      this.lastExternalProbe = 'unverifiable';
    }
    return this.lastExternalProbe;
  }

  public start(): Promise<TunnelStatus> {
    if (this.startInFlight !== null && this.startAbortController?.signal.aborted !== true) return this.startInFlight;
    const controller = new AbortController();
    const operation = this.enqueueLifecycle(() => this.startOnce(controller.signal));
    const tracked = operation.finally(() => {
      if (this.startInFlight === tracked) this.startInFlight = null;
      if (this.startAbortController === controller) this.startAbortController = null;
    });
    this.startAbortController = controller;
    this.startInFlight = tracked;
    return tracked;
  }

  private async startOnce(signal: AbortSignal): Promise<TunnelStatus> {
    this.intentionalStop = false;
    this.clearRestartTimer();
    this.clearStableTimer();
    this.restartAttempts = 0;
    this.restartWindowStartedAt = 0;
    try {
      throwIfStartCancelled(signal);
      if (this.state === 'running' || this.state === 'starting') return this.status();
      if (this.child !== null && this.child.exitCode === null) return this.status();
      const externalProbe = this.tunnelLock === null ? await this.probeExternalRunning(true) : 'gone';
      throwIfStartCancelled(signal);
      if (externalProbe === 'live') {
        this.state = 'running';
        this.message = null;
        return this.status();
      }
      if (externalProbe === 'unverifiable') {
        const foreignOwner = await this.verifiedForeignOwner();
        throwIfStartCancelled(signal);
        this.state = foreignOwner === null ? 'error' : 'starting';
        this.message = foreignOwner === null
          ? 'Tunnel process liveness is unverifiable; refusing to start a possible duplicate'
          : `Tunnel is owned by PID ${foreignOwner.pid}; tunnel process liveness is unverifiable`;
        return this.status();
      }
      const lockAcquired = await this.ensureTunnelLock();
      throwIfStartCancelled(signal);
      if (!lockAcquired) return this.status();

      const clientPath = this.resolveClientPath();
      if (clientPath === null || !existsSync(clientPath)) throw new Error('tunnel-client.exe was not found');
      const hasApiKey = await this.hasApiKey();
      throwIfStartCancelled(signal);
      if (!hasApiKey) throw new Error('Save a Runtime API key first');
      if (!existsSync(this.profilePath())) throw new Error('AWH Runtime Secure Tunnel is not configured');

      const encryptedSecret = await readFile(this.secretPath(), 'utf8');
      throwIfStartCancelled(signal);
      const apiKey = (await (this.options.decryptSecret?.(encryptedSecret) ?? decryptWithDpapi(encryptedSecret))).trim();
      throwIfStartCancelled(signal);
      if (apiKey.length === 0) throw new Error('Saved Runtime API key is empty; save it again in Settings');
      this.lastApiKey = apiKey;
      this.state = 'starting';
      this.message = null;
      await mkdir(this.profileDirectory(), { recursive: true });
      throwIfStartCancelled(signal);
      await this.preferPackagedStdioCommand();
      throwIfStartCancelled(signal);
      await runTunnelDoctor(clientPath, apiKey, this.profileDirectory(), this.options.getDataPath());
      throwIfStartCancelled(signal);
      this.spawnRun(clientPath, apiKey);
      this.state = 'running';
      this.scheduleStableReset();
      return this.status();
    } catch (error: unknown) {
      const cancelled = signal.aborted || error instanceof StartCancelledError;
      this.state = cancelled ? 'stopped' : 'error';
      this.message = cancelled ? null : error instanceof Error ? error.message : 'Tunnel setup failed';
      this.lastApiKey = null;
      if (this.child === null || this.child.exitCode !== null) await this.releaseTunnelLock();
      return this.status();
    }
  }

  public stop(): Promise<TunnelStatus> {
    return this.requestStop();
  }

  public stopOwned(): Promise<TunnelStatus> {
    return this.requestStop();
  }

  private requestStop(): Promise<TunnelStatus> {
    this.intentionalStop = true;
    this.clearRestartTimer();
    this.startAbortController?.abort();
    if (this.stopInFlight !== null) return this.stopInFlight;
    const operation = this.enqueueLifecycle(() => this.stopOnce());
    const tracked = operation.finally(() => {
      if (this.stopInFlight === tracked) this.stopInFlight = null;
    });
    this.stopInFlight = tracked;
    return tracked;
  }

  private async stopOnce(): Promise<TunnelStatus> {
    await this.killOwnedChild();
    await this.releaseTunnelLock();
    this.state = 'stopped';
    this.message = null;
    this.lastApiKey = null;
    this.restartAttempts = 0;
    this.clearStableTimer();
    return this.status();
  }

  private enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.lifecycleTail.then(operation);
    this.lifecycleTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async killOwnedChild(): Promise<void> {
    this.intentionalStop = true;
    this.clearRestartTimer();
    if (this.child !== null) {
      const child = this.child;
      if (child.exitCode !== null) {
        if (this.child === child) {
          this.child = null;
          this.ownedChildStartedAt = null;
        }
        return;
      }
      if (!child.kill()) throw new Error('Tunnel child did not accept stop signal; ownership retained');
      try {
        await waitForTunnelChildExit(child, this.options.stopTimeoutMs ?? 5_000);
      } catch (gracefulError: unknown) {
        const pid = child.pid;
        if (!Number.isInteger(pid) || (pid ?? 0) <= 0) throw gracefulError;
        const inspect = this.options.inspectOwnedProcess ?? probeProcessStart;
        if (this.ownedChildStartedAt === null) {
          const identityProbe = await inspect(pid as number);
          if (identityProbe.state === 'gone') {
            if (this.child === child) this.child = null;
            return;
          }
          if (identityProbe.state === 'unverifiable') throw new Error(`Tunnel child liveness is unverifiable (${identityProbe.reason}); ownership retained`);
          throw new Error('Tunnel child process identity was not recorded before shutdown; targeted escalation refused and ownership retained');
        }
        const beforeEscalation = await inspect(pid as number);
        if (beforeEscalation.state === 'gone') {
          if (this.child === child) this.child = null;
          return;
        }
        if (beforeEscalation.state === 'unverifiable') throw new Error(`Tunnel child liveness is unverifiable (${beforeEscalation.reason}); ownership retained`);
        if (beforeEscalation.processStartedAt !== this.ownedChildStartedAt) throw new Error('Tunnel child process identity changed; targeted escalation refused and ownership retained');

        const descendants = await (this.options.inspectOwnedProcessTree?.(pid as number) ?? inspectWindowsProcessTreeIdentities(pid as number));
        const expectedTree = normalizeOwnedProcessTree([
          { pid: pid as number, processStartedAt: this.ownedChildStartedAt },
          ...descendants,
        ]);
        await (this.options.terminateOwnedProcessTree?.(pid as number) ?? terminateWindowsProcessTree(pid as number));
        await waitForTunnelChildExit(child, this.options.escalationTimeoutMs ?? 2_000).catch(() => undefined);
        await verifyOwnedProcessTreeExited(expectedTree, inspect);
      }
      if (this.child === child) {
        this.child = null;
        this.ownedChildStartedAt = null;
      }
    }
  }

  public async incidentHealth(): Promise<{ readonly state: 'live' | 'unhealthy' | 'unavailable' | 'unknown'; readonly message: string | null }> {
    const address = await this.resolveHealthAddress();
    if (address === null) return { state: 'unavailable', message: 'tunnel health endpoint is unavailable from configured profile/log metadata' };
    try {
      const live = await (this.options.probeHealthEndpoint?.(address.host, address.port) ?? probeLoopbackHealth(address.host, address.port, this.options.healthProbeTimeoutMs ?? 1_500));
      return live ? { state: 'live', message: 'configured tunnel health endpoint is live' } : { state: 'unhealthy', message: 'configured tunnel health endpoint did not return live' };
    } catch {
      return { state: 'unhealthy', message: 'configured tunnel health endpoint probe failed' };
    }
  }

  public async clientVersion(): Promise<{ readonly value: string | null; readonly reason: string | null }> {
    const clientPath = this.resolveClientPath();
    if (clientPath === null || !existsSync(clientPath)) return { value: null, reason: 'configured_tunnel_client_not_found' };
    try {
      const value = await (this.options.inspectFileVersion?.(clientPath) ?? inspectWindowsFileVersion(clientPath));
      return value === null || value.trim().length === 0 ? { value: null, reason: 'file_version_metadata_unavailable' } : { value: value.trim().slice(0, 128), reason: null };
    } catch { return { value: null, reason: 'file_version_metadata_unavailable' }; }
  }

  public async incidentRelevantPids(): Promise<{ readonly pids: readonly number[]; readonly unavailableReason: string | null }> {
    const pids = new Set<number>();
    if (this.child !== null && this.child.exitCode === null && Number.isInteger(this.child.pid) && (this.child.pid ?? 0) > 0) pids.add(this.child.pid as number);
    if (this.tunnelLock !== null) pids.add(this.tunnelLock.owner.pid);
    try {
      const external = await (this.options.verifiedExternalTunnelPids?.() ?? findLnwjudTunnelProcessPids());
      for (const pid of external) if (Number.isInteger(pid) && pid > 0 && pid <= 2_147_483_647) pids.add(pid);
    } catch (error: unknown) {
      if (pids.size === 0) return { pids: [], unavailableReason: error instanceof Error ? `external_tunnel_pid_probe_failed:${error.message}` : 'external_tunnel_pid_probe_failed' };
    }
    return pids.size === 0 ? { pids: [], unavailableReason: 'no_verified_tunnel_pid' } : { pids: [...pids], unavailableReason: null };
  }

  private async resolveHealthAddress(): Promise<{ readonly host: string; readonly port: number } | null> {
    try {
      const profile = await readBoundedPrefix(this.profilePath(), MAX_HEALTH_METADATA_BYTES);
      const tail = await readBoundedTail(this.logPath(), MAX_HEALTH_METADATA_BYTES).catch(() => '');
      const runtimeAddresses = [...tail.matchAll(/health(?: server)?[^\r\n]{0,120}?(?:listening|listen_addr)[^\r\n]{0,120}?((?:127\.0\.0\.1|localhost):(\d{1,5}))/ig)]
        .map((match) => toHealthAddress(match[1], match[2]))
        .filter((entry): entry is { readonly host: string; readonly port: number } => entry !== null);
      const newestRuntime = runtimeAddresses.at(-1);
      if (newestRuntime !== undefined) return newestRuntime;
      const configured = /health:\s*[\s\S]{0,300}?listen_addr:\s*["']?((?:127\.0\.0\.1|localhost):(\d{1,5}))/i.exec(profile);
      return configured === null ? null : toHealthAddress(configured[1], configured[2]);
    } catch { return null; }
  }

  private async ensureTunnelLock(): Promise<boolean> {
    if (this.tunnelLock !== null) return true;
    try {
      const claim = await acquireTunnelLock({
        profileDirectory: this.profileDirectory(),
        ...(this.options.currentLockOwner === undefined ? {} : { owner: await this.options.currentLockOwner() }),
        ...(this.options.inspectLockProcess === undefined ? {} : { inspectProcess: this.options.inspectLockProcess }),
      });
      if (!claim.acquired) {
        this.foreignOwner = claim.owner;
        this.state = 'starting';
        this.message = `Tunnel is owned by PID ${claim.owner.pid}; tunnel process liveness is not yet confirmed`;
        return false;
      }
      this.foreignOwner = null;
      this.tunnelLock = claim;
      return true;
    } catch (error: unknown) {
      this.state = 'error';
      this.message = error instanceof Error ? error.message : 'Could not acquire tunnel ownership lock';
      return false;
    }
  }

  private async verifiedForeignOwner(): Promise<TunnelLockOwner | null> {
    const owner = await readTunnelLock(this.profileDirectory());
    if (owner === null) {
      this.foreignOwner = null;
      return null;
    }
    try {
      const probe = await (this.options.inspectLockProcess?.(owner.pid) ?? probeProcessStart(owner.pid));
      this.foreignOwner = probe.state === 'live' && probe.processStartedAt === owner.processStartedAt ? owner : null;
    } catch {
      this.foreignOwner = null;
    }
    return this.foreignOwner;
  }

  private async releaseTunnelLock(): Promise<void> {
    const claim = this.tunnelLock;
    if (claim === null) return;
    if (!(await claim.release())) throw new Error('Tunnel ownership lock release could not be confirmed; ownership retained');
    if (this.tunnelLock === claim) this.tunnelLock = null;
  }

  private spawnRun(clientPath: string, apiKey: string): void {
    const child = spawn(
      clientPath,
      [
        'run',
        '--profile', PROFILE_NAME,
        '--profile-dir', this.profileDirectory(),
        '--log.file', this.logPath(),
        '--mcp.connection-max-ttl', MCP_CONNECTION_MAX_TTL,
      ],
      {
        env: tunnelClientEnv(apiKey, this.profileDirectory(), this.options.getDataPath()),
        windowsHide: true,
        // detached:true on Windows gives the child its own console window.
        detached: false,
        stdio: ['ignore', 'ignore', 'ignore'],
      },
    );
    this.child = child;
    this.ownedChildStartedAt = null;
    if (Number.isInteger(child.pid) && (child.pid ?? 0) > 0) {
      const childPid = child.pid as number;
      void (this.options.inspectOwnedProcess?.(childPid) ?? probeProcessStart(childPid)).then((probe) => {
        if (this.child === child && probe.state === 'live') this.ownedChildStartedAt = probe.processStartedAt;
      }).catch(() => undefined);
    }
    child.on('error', (error) => {
      if (this.child === child) { this.child = null; this.ownedChildStartedAt = null; }
      this.state = 'error';
      this.message = error.message;
      this.scheduleRestart(clientPath);
    });
    child.on('exit', (code) => {
      if (this.child === child) { this.child = null; this.ownedChildStartedAt = null; }
      if (this.intentionalStop) {
        this.state = 'stopped';
        this.message = null;
        return;
      }
      void this.applyUnexpectedExit(code, clientPath);
    });
  }

  private async applyUnexpectedExit(code: number | null, clientPath: string): Promise<void> {
    const hint = await this.readExitHint();
    this.state = 'error';
    this.message = formatTunnelExitMessage(code, hint);
    const now = Date.now();
    if (this.restartWindowStartedAt === 0 || now - this.restartWindowStartedAt > RESTART_WINDOW_MS) {
      this.restartWindowStartedAt = now;
      this.restartAttempts = 0;
    }
    this.restartAttempts += 1;
    if (!this.autoReconnectEnabled()) return;
    const maxAutoRestarts = this.maxAutoRestarts();
    if (this.restartAttempts > maxAutoRestarts) {
      this.message = `${this.message} — automatic reconnect paused after ${maxAutoRestarts} rapid exits; press Start Tunnel to retry`;
      return;
    }
    this.scheduleRestart(clientPath);
  }

  private async readExitHint(): Promise<string> {
    try {
      const raw = await readFile(this.logPath(), 'utf8');
      const tail = raw.split(/\r?\n/).slice(-120).join('\n');
      return tunnelExitHintFromLog(tail);
    } catch {
      return '';
    }
  }

  private scheduleRestart(clientPath: string): void {
    if (this.intentionalStop || !this.autoReconnectEnabled()) return;
    this.clearRestartTimer();
    const delay = Math.min(RESTART_DELAY_MS * (2 ** Math.max(0, this.restartAttempts - 1)), 30_000);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.intentionalStop || this.lastApiKey === null) return;
      void this.preferPackagedStdioCommand()
        .then(() => {
          if (this.intentionalStop || this.lastApiKey === null) return;
          this.spawnRun(clientPath, this.lastApiKey);
          this.state = 'running';
          this.message = `Tunnel reconnecting (attempt ${this.restartAttempts}/${this.maxAutoRestarts()})…`;
          this.scheduleStableReset();
        })
        .catch(() => undefined);
    }, delay);
  }

  private autoReconnectEnabled(): boolean {
    return this.options.autoReconnect?.() ?? true;
  }

  private maxAutoRestarts(): number {
    const configured = this.options.maxAutoRestarts?.() ?? MAX_AUTO_RESTARTS;
    return Number.isInteger(configured) && configured >= 0 && configured <= 50 ? configured : MAX_AUTO_RESTARTS;
  }

  private clearRestartTimer(): void {
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  private scheduleStableReset(): void {
    this.clearStableTimer();
    this.stableTimer = setTimeout(() => {
      this.stableTimer = null;
      this.restartAttempts = 0;
      this.restartWindowStartedAt = 0;
    }, RESTART_WINDOW_MS);
  }

  private clearStableTimer(): void {
    if (this.stableTimer !== null) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
  }

  private async preferPackagedStdioCommand(): Promise<void> {
    const launcher = this.options.getStdioLauncherPath?.() ?? null;
    if (launcher === null) return;
    try {
      const yaml = await readFile(this.profilePath(), 'utf8');
      const next = rewriteTunnelYamlMcpCommand(yaml, launcher);
      if (next !== yaml) await writeFile(this.profilePath(), next, 'utf8');
    } catch {
      // Profile rewrite is best-effort; tunnel-client still starts with the existing YAML.
    }
  }
}

export { CLIENT_PATH_SETTING };

async function encryptWithDpapi(plain: string): Promise<string> {
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$plain = [Console]::In.ReadToEnd()',
    '$secure = ConvertTo-SecureString -String $plain -AsPlainText -Force',
    'ConvertFrom-SecureString -SecureString $secure',
  ].join('; ');
  return runPowerShellWithStdin(script, plain);
}

async function decryptWithDpapi(encrypted: string): Promise<string> {
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$encrypted = [Console]::In.ReadToEnd().Trim()',
    '$secure = ConvertTo-SecureString -String $encrypted',
    '$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)',
    'try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }',
  ].join('; ');
  return runPowerShellWithStdin(script, encrypted);
}

function runPowerShellWithStdin(command: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `PowerShell exited with code ${code ?? 'unknown'}`));
        return;
      }
      const value = stdout.replace(/\r?\n$/, '');
      if (value.length === 0) {
        reject(new Error('PowerShell returned an empty result'));
        return;
      }
      resolve(value);
    });
    child.stdin.end(input, 'utf8');
  });
}

export function tunnelClientEnv(apiKey: string, profileDirectory: string, dataPath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const userProfile = process.env.USERPROFILE ?? os.homedir();
  const appData = process.env.APPDATA ?? path.join(userProfile, 'AppData', 'Roaming');
  env.CONTROL_PLANE_API_KEY = apiKey.trim();
  env.MCP_CONNECTION_MAX_TTL = MCP_CONNECTION_MAX_TTL;
  env.LNWJUD_DATA_PATH = dataPath;
  env.LNWJUD_UNRESTRICTED = '1';
  env.TUNNEL_CLIENT_PROFILE = PROFILE_NAME;
  env.TUNNEL_CLIENT_PROFILE_DIR = profileDirectory;
  env.USERPROFILE = userProfile;
  env.APPDATA = appData;
  env.HOME = userProfile;
  delete env.XDG_CONFIG_HOME;
  return env;
}

async function runTunnelDoctor(clientPath: string, apiKey: string, profileDirectory: string, dataPath: string): Promise<void> {
  try {
    await execFileAsync(clientPath, ['doctor', '--profile', PROFILE_NAME, '--profile-dir', profileDirectory, '--explain'], {
      env: tunnelClientEnv(apiKey, profileDirectory, dataPath),
      windowsHide: true,
      encoding: 'utf8',
      timeout: 60_000,
    });
  } catch (error: unknown) {
    const detail = extractExecDetail(error);
    throw new Error(detail.length > 0 ? detail : 'tunnel-client doctor failed');
  }
}

function extractExecDetail(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  const record = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
  const stderr = typeof record.stderr === 'string' ? record.stderr.trim() : '';
  if (stderr.length > 0) return stderr.slice(0, 500);
  const stdout = typeof record.stdout === 'string' ? record.stdout.trim() : '';
  if (stdout.length > 0) return stdout.slice(0, 500);
  return typeof record.message === 'string' ? record.message : '';
}

async function isLnwjudTunnelProcessRunning(): Promise<boolean> {
  return (await findLnwjudTunnelProcessPids()).length > 0;
}

async function findLnwjudTunnelProcessPids(): Promise<readonly number[]> {
  const result = await Promise.race([
    execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "@(Get-CimInstance Win32_Process -Filter \"Name = 'tunnel-client.exe'\" -ErrorAction Stop | Where-Object { $_.CommandLine -match '(?i)(--profile\\s+lnwjud|lnwjud\\.yaml)' } | Select-Object -ExpandProperty ProcessId) -join ','",
    ], { windowsHide: true, encoding: 'utf8', timeout: 3_000 }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('tunnel process probe timed out')), 3_500);
    }),
  ]);
  return result.stdout.trim().split(',').map((value) => Number(value.trim())).filter((pid) => Number.isInteger(pid) && pid > 0 && pid <= 2_147_483_647);
}

export function waitForTunnelChildExit(child: Pick<ChildProcess, 'exitCode' | 'once' | 'removeListener'>, timeoutMs = 5_000): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onExit = (): void => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      reject(new Error('Tunnel child exit was not observed; ownership retained'));
    }, timeoutMs);
    child.once('exit', onExit);
  });
}

async function inspectWindowsProcessTreeIdentities(rootPid: number): Promise<readonly OwnedProcessIdentity[]> {
  const script = [
    "$ErrorActionPreference='Stop'",
    "$rows=Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object { if($null -ne $_.CreationDate){ [pscustomobject]@{ ProcessId=$_.ProcessId; ParentProcessId=$_.ParentProcessId; ProcessStartedAt=$_.CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ',[Globalization.CultureInfo]::InvariantCulture) } } }",
    "$rows | ConvertTo-Json -Compress",
  ].join('; ');
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    timeout: 3_000,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  });
  const parsed: unknown = JSON.parse(stdout.trim() || '[]');
  const rawRows = (Array.isArray(parsed) ? parsed : [parsed]).filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null);
  const rows = rawRows.map((row) => ({
    pid: Number(row.ProcessId),
    parentPid: Number(row.ParentProcessId),
    processStartedAt: typeof row.ProcessStartedAt === 'string' ? row.ProcessStartedAt : '',
  })).filter((row) => Number.isInteger(row.pid) && row.pid > 0 && Number.isInteger(row.parentPid) && row.parentPid >= 0 && validOwnedProcessTimestamp(row.processStartedAt));
  const included = new Set<number>([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (included.has(row.pid) || !included.has(row.parentPid)) continue;
      included.add(row.pid);
      changed = true;
    }
  }
  return rows.filter((row) => row.pid !== rootPid && included.has(row.pid)).map((row) => ({ pid: row.pid, processStartedAt: row.processStartedAt }));
}

function normalizeOwnedProcessTree(identities: readonly OwnedProcessIdentity[]): readonly OwnedProcessIdentity[] {
  const normalized = new Map<number, OwnedProcessIdentity>();
  for (const identity of identities) {
    if (!Number.isInteger(identity.pid) || identity.pid <= 0 || identity.pid > 2_147_483_647 || !validOwnedProcessTimestamp(identity.processStartedAt)) {
      throw new Error('Tunnel child process tree identity is invalid; ownership retained');
    }
    const existing = normalized.get(identity.pid);
    if (existing !== undefined && existing.processStartedAt !== identity.processStartedAt) {
      throw new Error('Tunnel child process tree identity is conflicting; ownership retained');
    }
    normalized.set(identity.pid, identity);
  }
  return [...normalized.values()];
}

async function verifyOwnedProcessTreeExited(
  identities: readonly OwnedProcessIdentity[],
  inspect: (pid: number) => Promise<ProcessProbeResult>,
): Promise<void> {
  for (const identity of identities) {
    const probe = await inspect(identity.pid);
    if (probe.state === 'unverifiable') {
      throw new Error(`Tunnel child process tree liveness is unverifiable (${probe.reason}); ownership retained`);
    }
    if (probe.state === 'live' && probe.processStartedAt === identity.processStartedAt) {
      throw new Error(`Tunnel child process tree remained live at PID ${identity.pid} after targeted escalation; ownership retained`);
    }
  }
}

function validOwnedProcessTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

async function terminateWindowsProcessTree(pid: number): Promise<void> {
  await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    windowsHide: true,
    timeout: 5_000,
    encoding: 'utf8',
  });
}

function probeLoopbackHealth(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    const finish = (live: boolean): void => {
      if (settled) return;
      settled = true;
      if (deadline !== null) clearTimeout(deadline);
      resolve(live);
    };
    const healthRequest = httpRequest({ host, port, path: '/healthz', method: 'GET', headers: { accept: 'application/json' } }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        body += chunk;
        if (body.length > 4_096) healthRequest.destroy(new Error('health response exceeded bound'));
      });
      response.once('end', () => finish(response.statusCode === 200 && isLiveHealthBody(body)));
      response.once('error', () => finish(false));
    });
    deadline = setTimeout(() => {
      healthRequest.destroy(new Error('health request total deadline exceeded'));
      finish(false);
    }, Math.max(1, timeoutMs));
    healthRequest.once('error', () => finish(false));
    healthRequest.end();
  });
}

async function readBoundedTail(filePath: string, maxBytes: number): Promise<string> {
  const handle = await openFile(filePath, 'r');
  try {
    const stats = await handle.stat();
    const length = Math.min(maxBytes, stats.size);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, Math.max(0, stats.size - length));
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

async function readBoundedPrefix(filePath: string, maxBytes: number): Promise<string> {
  const handle = await openFile(filePath, 'r');
  try {
    const stats = await handle.stat();
    const length = Math.min(maxBytes, stats.size);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

function toHealthAddress(address: string | undefined, portValue: string | undefined): { readonly host: string; readonly port: number } | null {
  if (address === undefined || portValue === undefined) return null;
  const [host] = address.split(':');
  const port = Number(portValue);
  if ((host !== '127.0.0.1' && host !== 'localhost') || !Number.isInteger(port) || port <= 0 || port > 65_535) return null;
  return { host, port };
}

function isLiveHealthBody(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed.toLowerCase() === 'live') return true;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      && typeof (parsed as Record<string, unknown>).status === 'string'
      && ((parsed as Record<string, unknown>).status as string).toLowerCase() === 'live';
  } catch {
    return false;
  }
}

async function inspectWindowsFileVersion(filePath: string): Promise<string | null> {
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$item = Get-Item -LiteralPath $args[0]; $item.VersionInfo.ProductVersion', filePath], { windowsHide: true, timeout: 3_000, encoding: 'utf8' });
  const value = stdout.trim().split(/\r?\n/)[0] ?? '';
  return value.length === 0 ? null : value;
}
