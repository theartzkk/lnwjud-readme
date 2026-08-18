import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface AuditEntry {
  ts: string;
  tool: string;
  outcome: 'allowed' | 'denied' | 'error';
  detail: string;
}

export class AuditLog {
  readonly file: string;

  constructor(private readonly dataDir: string) {
    this.file = join(dataDir, 'audit.jsonl');
  }

  async write(entry: Omit<AuditEntry, 'ts'>): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const record: AuditEntry = { ts: new Date().toISOString(), ...entry };
    await appendFile(this.file, `${JSON.stringify(record)}\n`, 'utf8');
  }

  async tail(limit = 50): Promise<AuditEntry[]> {
    try {
      const text = await readFile(this.file, 'utf8');
      return text
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-Math.max(1, Math.min(limit, 200)))
        .map((line) => JSON.parse(line) as AuditEntry);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
}
