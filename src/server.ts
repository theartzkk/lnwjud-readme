import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { ArtAgentConfig } from './config.js';
import { AuditLog } from './audit.js';
import { applyTextPatch, createCheckpoint, listCheckpoints, restoreCheckpoint } from './changes.js';
import { buildCodexArgs, codexEnvironment, codexStatus, resolveCodexExecutable } from './codex.js';
import { listWorkspace, readTextFile, searchText, writeTextFile } from './files.js';
import { gitDiff, gitLog, gitStatus } from './git.js';
import { resolvePackageInvocation, runPackageScript, type PackageCommand } from './process.js';
import { SecurityError } from './security.js';
import { ManagedTaskRegistry } from './tasks.js';
import { ART_AGENT_VERSION } from './version.js';

function text(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function errorText(error: unknown) {
  if (error instanceof SecurityError) return text({ error: error.code, message: error.message }, true);
  return text({ error: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) }, true);
}

async function packageMetadata(workspace: string): Promise<{ packageManager?: string; scripts?: Record<string, string> }> {
  const packageText = await readTextFile(workspace, 'package.json', 512 * 1024);
  return JSON.parse(packageText) as { packageManager?: string; scripts?: Record<string, string> };
}

export function createServer(config: ArtAgentConfig, workspace: string): McpServer {
  const audit = new AuditLog(config.dataDir);
  const tasks = new ManagedTaskRegistry(config.maxTaskLogBytes);
  const server = new McpServer({ name: 'art-agent', version: ART_AGENT_VERSION });

  server.registerTool(
    'health',
    { description: 'Check Art Agent runtime health and safe-mode settings', inputSchema: z.object({}) },
    async () => text({
      ok: true,
      name: 'Art Agent',
      version: ART_AGENT_VERSION,
      workspace,
      safeMode: true,
      allowWrite: config.allowWrite,
      allowExec: config.allowExec,
      allowCodex: config.allowCodex,
    }),
  );

  server.registerTool(
    'workspace_info',
    { description: 'Show the registered workspace and Git status', inputSchema: z.object({}) },
    async () => {
      try {
        const status = await gitStatus(workspace);
        return text({ workspace, git: status.code === 0 ? status.stdout : status.stderr });
      } catch (error) {
        return errorText(error);
      }
    },
  );

  server.registerTool(
    'workspace_tree',
    {
      description: 'List a bounded workspace tree; vendor/build directories are skipped automatically',
      inputSchema: z.object({ depth: z.number().int().min(0).max(6).default(2) }),
    },
    async ({ depth }) => {
      try {
        return text(await listWorkspace(workspace, depth));
      } catch (error) {
        return errorText(error);
      }
    },
  );

  server.registerTool(
    'read_file',
    {
      description: 'Read a UTF-8 text file inside the workspace. Secret files and path escapes are blocked.',
      inputSchema: z.object({ path: z.string().min(1) }),
    },
    async ({ path }) => {
      try {
        const value = await readTextFile(workspace, path, config.maxReadBytes);
        await audit.write({ tool: 'read_file', outcome: 'allowed', detail: path });
        return text(value);
      } catch (error) {
        await audit.write({ tool: 'read_file', outcome: 'denied', detail: `${path}: ${error instanceof Error ? error.message : String(error)}` });
        return errorText(error);
      }
    },
  );

  server.registerTool(
    'search_text',
    {
      description: 'Search text recursively inside normal project files with bounded results',
      inputSchema: z.object({ query: z.string().min(1).max(200) }),
    },
    async ({ query }) => {
      try {
        return text(await searchText(workspace, query, config.maxSearchResults));
      } catch (error) {
        return errorText(error);
      }
    },
  );

  server.registerTool(
    'write_file',
    {
      description: 'Write one UTF-8 file inside the workspace. Disabled unless ART_AGENT_ALLOW_WRITE=1. Secret paths and escapes are always blocked.',
      inputSchema: z.object({ path: z.string().min(1), content: z.string().max(2_000_000) }),
    },
    async ({ path, content }) => {
      if (!config.allowWrite) {
        await audit.write({ tool: 'write_file', outcome: 'denied', detail: `${path}: write disabled` });
        return text({ error: 'WRITE_DISABLED', message: 'Set ART_AGENT_ALLOW_WRITE=1 to enable workspace writes.' }, true);
      }
      try {
        await writeTextFile(workspace, path, content);
        await audit.write({ tool: 'write_file', outcome: 'allowed', detail: `${path} (${Buffer.byteLength(content)} bytes)` });
        return text({ ok: true, path });
      } catch (error) {
        await audit.write({ tool: 'write_file', outcome: 'denied', detail: `${path}: ${error instanceof Error ? error.message : String(error)}` });
        return errorText(error);
      }
    },
  );

  server.registerTool(
    'checkpoint_create',
    {
      description: 'Create a recovery checkpoint for existing non-secret text files without changing the workspace',
      inputSchema: z.object({ paths: z.array(z.string().min(1)).min(1).max(50) }),
    },
    async ({ paths }) => {
      try {
        const checkpoint = await createCheckpoint(config.dataDir, workspace, paths, config.maxReadBytes);
        await audit.write({ tool: 'checkpoint_create', outcome: 'allowed', detail: `${checkpoint.id}: ${checkpoint.files.map((file) => file.path).join(', ')}` });
        return text(checkpoint);
      } catch (error) {
        await audit.write({ tool: 'checkpoint_create', outcome: 'error', detail: error instanceof Error ? error.message : String(error) });
        return errorText(error);
      }
    },
  );

  server.registerTool(
    'checkpoint_list',
    {
      description: 'List recent Art Agent recovery checkpoints without returning checkpoint file contents',
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(20) }),
    },
    async ({ limit }) => {
      try {
        return text(await listCheckpoints(config.dataDir, limit));
      } catch (error) {
        return errorText(error);
      }
    },
  );

  server.registerTool(
    'checkpoint_restore',
    {
      description: 'Restore an Art Agent checkpoint. Requires writes enabled and explicit userConfirmed=true.',
      inputSchema: z.object({ checkpointId: z.string().min(1).max(120), userConfirmed: z.boolean() }),
    },
    async ({ checkpointId, userConfirmed }) => {
      if (!config.allowWrite) return text({ error: 'WRITE_DISABLED', message: 'Workspace writes are disabled.' }, true);
      if (!userConfirmed) return text({ error: 'CONFIRMATION_REQUIRED', message: 'Set userConfirmed=true only after explicit user confirmation.' }, true);
      try {
        const checkpoint = await restoreCheckpoint(config.dataDir, workspace, checkpointId);
        await audit.write({ tool: 'checkpoint_restore', outcome: 'allowed', detail: checkpoint.id });
        return text({ ok: true, checkpoint });
      } catch (error) {
        await audit.write({ tool: 'checkpoint_restore', outcome: 'error', detail: `${checkpointId}: ${error instanceof Error ? error.message : String(error)}` });
        return errorText(error);
      }
    },
  );

  server.registerTool(
    'apply_patch',
    {
      description: 'Apply bounded exact-text replacements to existing files. All guards are validated and a checkpoint is created before any write.',
      inputSchema: z.object({
        operations: z.array(z.object({
          path: z.string().min(1),
          expected: z.string().min(1).max(500_000),
          replacement: z.string().max(500_000),
        })).min(1).max(20),
      }),
    },
    async ({ operations }) => {
      if (!config.allowWrite) {
        await audit.write({ tool: 'apply_patch', outcome: 'denied', detail: 'write disabled' });
        return text({ error: 'WRITE_DISABLED', message: 'Set ART_AGENT_ALLOW_WRITE=1 to enable patches.' }, true);
      }
      try {
        const result = await applyTextPatch(config.dataDir, workspace, operations, config.maxReadBytes);
        await audit.write({ tool: 'apply_patch', outcome: 'allowed', detail: `${result.checkpoint.id}: ${result.paths.join(', ')}` });
        return text({ ok: true, ...result });
      } catch (error) {
        await audit.write({ tool: 'apply_patch', outcome: 'error', detail: error instanceof Error ? error.message : String(error) });
        return errorText(error);
      }
    },
  );

  server.registerTool(
    'git_status',
    { description: 'Read-only git status for the workspace', inputSchema: z.object({}) },
    async () => {
      try {
        const result = await gitStatus(workspace);
        return text(result.code === 0 ? result.stdout : result, result.code !== 0);
      } catch (error) {
        return errorText(error);
      }
    },
  );

  server.registerTool(
    'git_diff',
    { description: 'Read-only working tree git diff', inputSchema: z.object({}) },
    async () => {
      try {
        const result = await gitDiff(workspace);
        return text(result.code === 0 ? result.stdout : result, result.code !== 0);
      } catch (error) {
        return errorText(error);
      }
    },
  );

  server.registerTool(
    'git_log',
    {
      description: 'Read recent git commit history',
      inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(10) }),
    },
    async ({ limit }) => {
      try {
        const result = await gitLog(workspace, limit);
        return text(result.code === 0 ? result.stdout : result, result.code !== 0);
      } catch (error) {
        return errorText(error);
      }
    },
  );

  server.registerTool(
    'project_command',
    {
      description: 'Run a named package.json script synchronously (test, lint, typecheck, build). Disabled unless ART_AGENT_ALLOW_EXEC=1.',
      inputSchema: z.object({ command: z.enum(['test', 'lint', 'typecheck', 'build']) }),
    },
    async ({ command }) => {
      if (!config.allowExec) {
        await audit.write({ tool: 'project_command', outcome: 'denied', detail: `${command}: execution disabled` });
        return text({ error: 'EXEC_DISABLED', message: 'Set ART_AGENT_ALLOW_EXEC=1 to enable approved project commands.' }, true);
      }
      try {
        const packageJson = await packageMetadata(workspace);
        if (!packageJson.scripts?.[command]) return text({ error: 'SCRIPT_NOT_FOUND', command }, true);
        const result = await runPackageScript(workspace, packageJson.packageManager, command as PackageCommand);
        await audit.write({ tool: 'project_command', outcome: result.code === 0 ? 'allowed' : 'error', detail: `${command} => ${result.code}` });
        return text(result, result.code !== 0);
      } catch (error) {
        await audit.write({ tool: 'project_command', outcome: 'error', detail: `${command}: ${error instanceof Error ? error.message : String(error)}` });
        return errorText(error);
      }
    },
  );

  server.registerTool(
    'project_task_start',
    {
      description: 'Start an approved project script in the background and return an Art Agent task id.',
      inputSchema: z.object({ command: z.enum(['test', 'lint', 'typecheck', 'build']) }),
    },
    async ({ command }) => {
      if (!config.allowExec) return text({ error: 'EXEC_DISABLED', message: 'Approved execution is disabled.' }, true);
      try {
        const packageJson = await packageMetadata(workspace);
        if (!packageJson.scripts?.[command]) return text({ error: 'SCRIPT_NOT_FOUND', command }, true);
        const invocation = await resolvePackageInvocation(packageJson.packageManager, command as PackageCommand);
        const task = tasks.start({ ...invocation, cwd: workspace, label: `project:${command}`, timeoutMs: 15 * 60_000 });
        await audit.write({ tool: 'project_task_start', outcome: 'allowed', detail: `${command}: ${task.id}` });
        return text(task);
      } catch (error) {
        await audit.write({ tool: 'project_task_start', outcome: 'error', detail: `${command}: ${error instanceof Error ? error.message : String(error)}` });
        return errorText(error);
      }
    },
  );

  server.registerTool(
    'task_status',
    {
      description: 'Read status for a process launched by this Art Agent runtime',
      inputSchema: z.object({ taskId: z.string().min(1).max(120) }),
    },
    async ({ taskId }) => {
      try {
        const task = tasks.status(taskId);
        return text({ ...task, stdout: undefined, stderr: undefined });
      } catch (error) {
        return errorText(error);
      }
    },
  );

  server.registerTool(
    'task_logs',
    {
      description: 'Read bounded stdout/stderr for a process launched by this Art Agent runtime',
      inputSchema: z.object({ taskId: z.string().min(1).max(120) }),
    },
    async ({ taskId }) => {
      try {
        return text(tasks.logs(taskId));
      } catch (error) {
        return errorText(error);
      }
    },
  );

  server.registerTool(
    'task_stop',
    {
      description: 'Stop only a process launched by this Art Agent runtime. Requires explicit userConfirmed=true.',
      inputSchema: z.object({ taskId: z.string().min(1).max(120), userConfirmed: z.boolean() }),
    },
    async ({ taskId, userConfirmed }) => {
      if (!config.allowExec) return text({ error: 'EXEC_DISABLED', message: 'Approved execution is disabled.' }, true);
      if (!userConfirmed) return text({ error: 'CONFIRMATION_REQUIRED', message: 'Set userConfirmed=true only after explicit user confirmation.' }, true);
      try {
        const task = await tasks.stop(taskId);
        await audit.write({ tool: 'task_stop', outcome: 'allowed', detail: taskId });
        return text(task);
      } catch (error) {
        await audit.write({ tool: 'task_stop', outcome: 'error', detail: `${taskId}: ${error instanceof Error ? error.message : String(error)}` });
        return errorText(error);
      }
    },
  );

  server.registerTool(
    'codex_status',
    { description: 'Check for a local Codex CLI and report its version without inspecting credentials', inputSchema: z.object({}) },
    async () => text(await codexStatus(workspace)),
  );

  server.registerTool(
    'codex_run',
    {
      description: 'Start local Codex non-interactively with JSONL output. Disabled by default. Network/web search are forced off; prompt is sent over stdin and is not written to the Art Agent audit log.',
      inputSchema: z.object({
        instruction: z.string().min(1).max(20_000),
        sandbox: z.enum(['read-only', 'workspace-write']).default('read-only'),
      }),
    },
    async ({ instruction, sandbox }) => {
      if (!config.allowExec || !config.allowCodex) {
        await audit.write({ tool: 'codex_run', outcome: 'denied', detail: 'Codex execution disabled' });
        return text({ error: 'CODEX_DISABLED', message: 'Set ART_AGENT_ALLOW_EXEC=1 and ART_AGENT_ALLOW_CODEX=1 to enable local Codex delegation.' }, true);
      }
      if (sandbox === 'workspace-write' && !config.allowWrite) {
        return text({ error: 'WRITE_DISABLED', message: 'Codex workspace-write also requires ART_AGENT_ALLOW_WRITE=1.' }, true);
      }
      try {
        const executable = await resolveCodexExecutable();
        const task = tasks.start({
          executable,
          args: buildCodexArgs(workspace, sandbox),
          cwd: workspace,
          label: `codex:${sandbox}`,
          timeoutMs: 60 * 60_000,
          stdin: instruction,
          env: codexEnvironment(),
        });
        await audit.write({ tool: 'codex_run', outcome: 'allowed', detail: `${sandbox}: ${task.id}; prompt omitted` });
        return text(task);
      } catch (error) {
        await audit.write({ tool: 'codex_run', outcome: 'error', detail: `prompt omitted: ${error instanceof Error ? error.message : String(error)}` });
        return errorText(error);
      }
    },
  );

  server.registerTool(
    'audit_tail',
    {
      description: 'Read recent Art Agent audit decisions. Raw secrets and Codex prompts are never intentionally written to this log.',
      inputSchema: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
    },
    async ({ limit }) => text(await audit.tail(limit)),
  );

  return server;
}
