import { createRequire } from 'node:module';
import { PRODUCT } from './product.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version?: unknown };

if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(pkg.version)) {
  throw new Error(`${PRODUCT.productName} package.json contains an invalid version`);
}

export const RELEASE_VERSION = pkg.version;
/** @deprecated Keep the legacy export for MCP/runtime compatibility. */
export const ART_AGENT_VERSION = RELEASE_VERSION;
