import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAwhDataPath, resolveLnwjudDataPath } from './data-path.js';

describe('resolveLnwjudDataPath', () => {
  it('uses the same explicit override for Desktop and MCP', () => {
    expect(resolveLnwjudDataPath({ LNWJUD_DATA_PATH: 'D:\\agent-data', APPDATA: 'C:\\Users\\u\\AppData\\Roaming' })).toBe(path.resolve('D:\\agent-data'));
  });

  it('defaults to the per-user roaming AppData lnwjud directory', () => {
    expect(resolveLnwjudDataPath({ APPDATA: 'C:\\Users\\u\\AppData\\Roaming' })).toBe(path.resolve(path.join('C:\\Users\\u\\AppData\\Roaming', 'lnwjud')));
  });

  it('accepts Electron appData as a fallback without embedding a build-machine profile', () => {
    expect(resolveLnwjudDataPath({}, 'C:\\Users\\end-user\\AppData\\Roaming')).toBe(path.resolve(path.join('C:\\Users\\end-user\\AppData\\Roaming', 'lnwjud')));
  });
});


describe('resolveAwhDataPath', () => {
  it('prefers the AWH-specific explicit override', () => {
    expect(resolveAwhDataPath({ AWH_DATA_PATH: 'D:\\awh-data', LNWJUD_DATA_PATH: 'D:\\lnwjud-data', APPDATA: 'C:\\Users\\u\\AppData\\Roaming' })).toBe(path.resolve('D:\\awh-data'));
  });

  it('keeps the explicit upstream override as an operator compatibility path', () => {
    expect(resolveAwhDataPath({ LNWJUD_DATA_PATH: 'D:\\shared-core', APPDATA: 'C:\\Users\\u\\AppData\\Roaming' })).toBe(path.resolve('D:\\shared-core'));
  });

  it('defaults to the existing AWH product directory without silently importing lnwjud data', () => {
    expect(resolveAwhDataPath({ APPDATA: 'C:\\Users\\u\\AppData\\Roaming' })).toBe(path.resolve(path.join('C:\\Users\\u\\AppData\\Roaming', 'Art’s Workspace Hub')));
  });
});
