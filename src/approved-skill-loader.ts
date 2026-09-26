import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, rm, rmdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorkerCapabilityPlan } from './control-plane-worker-client.js';

export const APPROVED_ANTI_SLOP_ROOT = fileURLToPath(new URL('../skills/approved/anti-slop/', import.meta.url));

interface ApprovedSourceFile { localPath: string; sourcePath: string; gitBlobSha: string; }
interface ApprovedSkillManifest {
  schemaVersion: 1;
  packId: 'awh.approved.anti-slop';
  approvalState: 'APPROVED';
  source: { repository: string; revision: string; version: string; license: 'MIT' };
  runtimePolicy: {
    networkAllowed: false; telemetryAllowed: false; autoUpdateAllowed: false; persistentInstallAllowed: false;
    scriptAutoExecutionAllowed: false; externalDataTransferAllowed: false;
    materialization: 'EPHEMERAL_CODEX_WORKSPACE_ONLY'; cleanupBeforeCandidateArchive: true;
  };
  profiles: { design: string[]; copy: string[]; code: string[] };
  upstreamFiles: ApprovedSourceFile[];
}

const SAFE_RELATIVE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;
const PROFILE_BY_CAPABILITY: Record<string, keyof ApprovedSkillManifest['profiles']> = {
  'design.antislop': 'design',
  'copy.antislop': 'copy',
  'code.antislop': 'code',
};

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch { return false; }
}
function gitBlobSha(content: Buffer): string {
  return createHash('sha1').update(Buffer.from(`blob ${content.byteLength}\0`)).update(content).digest('hex');
}
function safeChild(root: string, relativePath: string): string {
  if (!SAFE_RELATIVE.test(relativePath) || relativePath.startsWith('/')) throw new Error('APPROVED_SKILL_PATH_INVALID');
  const target = resolve(root, relativePath);
  const normalizedRoot = resolve(root) + '/';
  if (!target.startsWith(normalizedRoot)) throw new Error('APPROVED_SKILL_PATH_INVALID');
  return target;
}

export async function verifyApprovedAntiSlopPack(root = APPROVED_ANTI_SLOP_ROOT): Promise<ApprovedSkillManifest> {
  const raw = JSON.parse(await readFile(join(root, 'SOURCE.json'), 'utf8')) as ApprovedSkillManifest;
  if (
    raw.schemaVersion !== 1 ||
    raw.packId !== 'awh.approved.anti-slop' ||
    raw.approvalState !== 'APPROVED' ||
    raw.source?.repository !== 'miqdadbadjuber/anti-slop' ||
    !/^[0-9a-f]{40}$/.test(raw.source?.revision ?? '') ||
    raw.runtimePolicy?.networkAllowed !== false ||
    raw.runtimePolicy?.telemetryAllowed !== false ||
    raw.runtimePolicy?.autoUpdateAllowed !== false ||
    raw.runtimePolicy?.persistentInstallAllowed !== false ||
    raw.runtimePolicy?.scriptAutoExecutionAllowed !== false ||
    raw.runtimePolicy?.externalDataTransferAllowed !== false ||
    raw.runtimePolicy?.materialization !== 'EPHEMERAL_CODEX_WORKSPACE_ONLY' ||
    raw.runtimePolicy?.cleanupBeforeCandidateArchive !== true ||
    !Array.isArray(raw.upstreamFiles) ||
    raw.upstreamFiles.length < 1 ||
    raw.upstreamFiles.length > 32
  ) throw new Error('APPROVED_SKILL_MANIFEST_INVALID');

  for (const file of raw.upstreamFiles) {
    if (!file || !SAFE_RELATIVE.test(file.localPath) || !SAFE_RELATIVE.test(file.sourcePath) || !/^[0-9a-f]{40}$/.test(file.gitBlobSha)) throw new Error('APPROVED_SKILL_MANIFEST_INVALID');
    const path = safeChild(root, file.localPath);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('APPROVED_SKILL_FILE_INVALID');
    const content = await readFile(path);
    if (gitBlobSha(content) !== file.gitBlobSha) throw new Error('APPROVED_SKILL_INTEGRITY_FAILED');
  }
  return raw;
}

export interface MaterializedApprovedSkills { skillNames: string[]; cleanup(): Promise<void>; }

export async function materializeApprovedSkillPlan(plan: WorkerCapabilityPlan | null, workspace: string): Promise<MaterializedApprovedSkills> {
  const selectedProfiles = new Set<keyof ApprovedSkillManifest['profiles']>();
  for (const item of plan?.selected ?? []) {
    const profile = PROFILE_BY_CAPABILITY[item.id];
    if (profile) selectedProfiles.add(profile);
  }
  if (selectedProfiles.size === 0) return { skillNames: [], cleanup: async () => undefined };

  const manifest = await verifyApprovedAntiSlopPack();
  const names = [...new Set([...selectedProfiles].flatMap((profile) => manifest.profiles[profile] ?? []))];
  if (names.length < 1 || names.length > 8 || names.some((name) => !/^[a-z][a-z0-9-]{1,63}$/.test(name))) throw new Error('APPROVED_SKILL_PROFILE_INVALID');

  const codexRoot = join(workspace, '.codex');
  const skillsRoot = join(codexRoot, 'skills');
  const codexExisted = await exists(codexRoot);
  const skillsExisted = await exists(skillsRoot);
  const created: string[] = [];
  const cleanup = async (): Promise<void> => {
    for (const path of [...created].reverse()) await rm(path, { recursive: true, force: true }).catch(() => undefined);
    if (!skillsExisted) await rmdir(skillsRoot).catch(() => undefined);
    if (!codexExisted) await rmdir(codexRoot).catch(() => undefined);
  };

  try {
    await mkdir(skillsRoot, { recursive: true, mode: 0o700 });
    for (const name of names) {
      const source = safeChild(APPROVED_ANTI_SLOP_ROOT, name);
      const sourceInfo = await lstat(source);
      if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) throw new Error('APPROVED_SKILL_PROFILE_INVALID');
      const destination = join(skillsRoot, name);
      if (await exists(destination)) throw new Error('APPROVED_SKILL_DESTINATION_CONFLICT');
      await cp(source, destination, { recursive: true, force: false, errorOnExist: true });
      created.push(destination);
    }
    return { skillNames: names, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function approvedSkillPackInventory(root = APPROVED_ANTI_SLOP_ROOT): Promise<string[]> {
  const manifest = await verifyApprovedAntiSlopPack(root);
  const entries = await readdir(root);
  return [...new Set(Object.values(manifest.profiles).flat())].filter((name) => entries.includes(name)).sort();
}
