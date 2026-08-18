import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version?: unknown };

if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(pkg.version)) {
  throw new Error('Art Agent package.json contains an invalid version');
}

export const ART_AGENT_VERSION = pkg.version;
