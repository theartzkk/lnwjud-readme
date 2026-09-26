import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, rm, rmdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
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
  approvedFiles: Array<{ localPath: string; gitBlobSha: string }>;
}

const SAFE_RELATIVE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;
const PROFILE_BY_CAPABILITY: Record<string, keyof ApprovedSkillManifest['profiles']> = {
  'design.antislop': 'design',
  'copy.antislop': 'copy',
  'code.antislop': 'code',
};
const MATERIALIZED_FILES_BY_SKILL: Record<string, string[]> = {
  antislop: ['SKILL.md', 'antislop.md', 'VERSION'],
  'antislop-ui': ['SKILL.md'],
  'antislop-human': ['SKILL.md'],
  'antislop-layoutmobile': ['SKILL.md'],
  'antislop-copywriting': ['SKILL.md'],
  'antislop-code': ['SKILL.md'],
};

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch { return false; }
}
function gitBlobSha(content: Buffer): string {
  return createHash('sha1').update(Buffer.from(`blob ${content.byteLength}\0`)).update(content).digest('hex');
}
function safeChild(root: string, relativePath: string): string {
  if (!SAFE_RELATIVE.test(relativePath) || relativePath.startsWith('/')) throw new Error('APPROVED_SKILL_PATH_INVALID');
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, relativePath);
  const rel = relative(resolvedRoot, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('APPROVED_SKILL_PATH_INVALID');
  return target;
}

async function listedFiles(root: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('APPROVED_SKILL_FILE_INVALID');
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = join(root, entry.name);
    if (entry.isDirectory()) out.push(...await listedFiles(full, rel));
    else if (entry.isFile()) out.push(rel);
    else throw new Error('APPROVED_SKILL_FILE_INVALID');
  }
  return out;
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
    raw.upstreamFiles.length > 32 ||
    !Array.isArray(raw.approvedFiles) ||
    raw.approvedFiles.length < 1 ||
    raw.approvedFiles.length > 16
  ) throw new Error('APPROVED_SKILL_MANIFEST_INVALID');

  for (const file of raw.upstreamFiles) {
    if (!file || !SAFE_RELATIVE.test(file.localPath) || !SAFE_RELATIVE.test(file.sourcePath) || !/^[0-9a-f]{40}$/.test(file.gitBlobSha)) throw new Error('APPROVED_SKILL_MANIFEST_INVALID');
    const path = safeChild(root, file.localPath);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('APPROVED_SKILL_FILE_INVALID');
    if (gitBlobSha(await readFile(path)) !== file.gitBlobSha) throw new Error('APPROVED_SKILL_INTEGRITY_FAILED');
  }
  for (const file of raw.approvedFiles) {
    if (!file || !SAFE_RELATIVE.test(file.localPath) || !/^[0-9a-f]{40}$/.test(file.gitBlobSha)) throw new Error('APPROVED_SKILL_MANIFEST_INVALID');
    const path = safeChild(root, file.localPath);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('APPROVED_SKILL_FILE_INVALID');
    if (gitBlobSha(await readFile(path)) !== file.gitBlobSha) throw new Error('APPROVED_SKILL_INTEGRITY_FAILED');
  }
  const allowed = new Set([...raw.upstreamFiles.map((file) => file.localPath), ...raw.approvedFiles.map((file) => file.localPath)]);
  for (const profile of Object.values(raw.profiles).flat()) {
    const dir = safeChild(root, profile);
    for (const child of await listedFiles(dir, profile)) if (!allowed.has(child)) throw new Error('APPROVED_SKILL_UNPINNED_FILE');
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
      await mkdir(destination, { recursive: false, mode: 0o700 });
      created.push(destination);
      const approvedFiles = MATERIALIZED_FILES_BY_SKILL[name];
      if (!approvedFiles?.length) throw new Error('APPROVED_SKILL_PROFILE_INVALID');
      for (const relativeFile of approvedFiles) {
        const sourceFile = safeChild(source, relativeFile);
        const sourceFileInfo = await lstat(sourceFile);
        if (!sourceFileInfo.isFile() || sourceFileInfo.isSymbolicLink()) throw new Error('APPROVED_SKILL_FILE_INVALID');
        const destinationFile = join(destination, relativeFile);
        await mkdir(dirname(destinationFile), { recursive: true, mode: 0o700 });
        await cp(sourceFile, destinationFile, { force: false, errorOnExist: true });
      }
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
