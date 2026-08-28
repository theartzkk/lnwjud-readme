import { executeSafeBridge, parseSafeBridgeArgs, SafeBridgeError } from './safe-bridge.js';

async function main(): Promise<void> {
  try {
    const command = parseSafeBridgeArgs(process.argv.slice(2));
    const result = await executeSafeBridge(command);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code = error instanceof SafeBridgeError ? error.code : safeErrorCode(error);
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      bridge: 'awh-safe-bridge',
      readOnly: true,
      ok: false,
      code,
    })}\n`);
    process.exitCode = code === 'COMMAND_NOT_ALLOWED' ? 2 : 1;
  }
}

function safeErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    const code = (error as { code: string }).code;
    if (/^[A-Z][A-Z0-9_]{2,79}$/.test(code)) return code;
  }
  return 'SAFE_BRIDGE_FAILED';
}

await main();
