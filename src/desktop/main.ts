const MCP_STDIO_MODE = process.argv.includes('--mcp-stdio');

if (MCP_STDIO_MODE) {
  const { startStdioRuntime } = await import('../stdio.js');
  await startStdioRuntime();
} else {
  await import('./ui.js');
}
