const { spawn } = require('child_process');

const exe = process.argv[2];
const workspace = process.argv[3];
if (!exe || !workspace) throw new Error('usage: node awh-fresh-probe.cjs <runtime.exe> <workspace>');

const p = spawn(exe, ['--mcp-stdio', '--workspace', workspace], {
  env: { ...process.env, AWH_DEVICE_RUNTIME_HEADLESS: '1' },
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});

let buffer = '';
let stderr = '';
let sequence = 0;
const waits = new Map();

p.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-16384); });
p.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.startsWith('{')) continue;
    try {
      const message = JSON.parse(line);
      const handler = waits.get(String(message.id));
      if (handler) {
        waits.delete(String(message.id));
        handler(message);
      }
    } catch {}
  }
});

const meta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'AWH Timeout Probe', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': { extensions: { 'io.modelcontextprotocol/tasks': {} } },
};

function request(method, params = {}) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const id = 'd' + (++sequence);
    const timer = setTimeout(() => {
      waits.delete(id);
      reject(new Error(method + ' TIMEOUT after ' + (Date.now() - started) + 'ms stderr=' + stderr));
    }, 120000);
    waits.set(id, (message) => {
      clearTimeout(timer);
      console.log(method + '_MS=' + (Date.now() - started));
      resolve(message);
    });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: { ...params, _meta: meta } }) + '\n');
  });
}

(async () => {
  const discovered = await request('server/discover');
  console.log('DISCOVER=' + (discovered.result ? 'PASS' : 'FAIL'));
  const listed = await request('tools/list');
  console.log('TOOLS=' + (listed.result?.tools || []).length);
  const health = await request('tools/call', { name: 'health', arguments: { operation: 'check_all' } });
  console.log('HEALTH=' + (health.result?.isError === true ? 'FAIL' : 'PASS'));
  p.kill();
})().catch((error) => {
  console.error('DIRECT_PROBE_ERROR=' + (error.stack || error.message));
  try { p.kill(); } catch {}
  process.exit(2);
});
