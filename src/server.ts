import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { ArtAgentConfig } from './config.js';
import { AuditLog } from './audit.js';
import { listWorkspace, readTextFile, searchText, writeTextFile } from './files.js';
import { gitDiff, gitLog, gitStatus } from './git.js';
import { runPackageScript } from './process.js';
import { SecurityError } from './security.js';

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

export function createServer(config: ArtAgentConfig, workspace: string): McpServer {
  const audit = new AuditLog(config.dataDir);
  const server = new McpServer({ name: 'art-agent', version: '0.1.0' });

  server.registerTool(
    'health',
    { description: 'Check Art Agent runtime health and safe-mode settings', inputSchema: z.object({}) },
    async () => text({ ok: true, name: 'Art Agent', version: '0.1.0', workspace, safeMode: true, allowWrite: config.allowWrite, allowExec: config.allowExec }),
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
      description: 'Run a named package.json script (test, lint, typecheck, build). Disabled unless ART_AGENT_ALLOW_EXEC=1.',
      inputSchema: z.object({ command: z.enum(['test', 'lint', 'typecheck', 'build']) }),
    },
    async ({ command }) => {
      if (!config.allowExec) {
        await audit.write({ tool: 'project_command', outcome: 'denied', detail: `${command}: execution disabled` });
        return text({ error: 'EXEC_DISABLED', message: 'Set ART_AGENT_ALLOW_EXEC=1 to enable approved project commands.' }, true);
      }
      try {
        const packageText = await readTextFile(workspace, 'package.json', 512 * 1024);
        const packageJson = JSON.parse(packageText) as { packageManager?: string; scripts?: Record<string, string> };
        if (!packageJson.scripts?.[command]) return text({ error: 'SCRIPT_NOT_FOUND', command }, true);
        const result = await runPackageScript(workspace, packageJson.packageManager, command);
        await audit.write({ tool: 'project_command', outcome: result.code === 0 ? 'allowed' : 'error', detail: `${command} => ${result.code}` });
        return text(result, result.code !== 0);
      } catch (error) {
        await audit.write({ tool: 'project_command', outcome: 'error', detail: `${command}: ${error instanceof Error ? error.message : String(error)}` });
        return errorText(error);
      }
    },
  );

  server.registerTool(
    'audit_tail',
    {
      description: 'Read recent Art Agent audit decisions. Raw secrets are never intentionally written to this log.',
      inputSchema: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
    },
    async ({ limit }) => text(await audit.tail(limit)),
  );

  return server;
}
