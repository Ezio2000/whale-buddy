import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

export class DiagnosticLog {
  constructor(
    readonly filePath: string,
    private readonly maxBytes = 2 * 1024 * 1024,
    // Kept for source compatibility with older callers. Diagnostic archives are
    // intentionally permanent until an employee removes them manually.
    _retainedFiles = 3,
  ) {
    mkdirSync(path.dirname(filePath), { recursive: true });
  }

  write(source: 'runtime' | 'stderr' | 'protocol', message: string): void {
    this.rotateIfNeeded(Buffer.byteLength(message, 'utf8'));
    const timestamp = new Date().toISOString();
    const normalized = message.replace(/\r?\n$/, '');
    appendFileSync(this.filePath, `[${timestamp}] [${source}] ${normalized}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  private rotateIfNeeded(incomingBytes: number): void {
    if (!existsSync(this.filePath)) return;
    if (statSync(this.filePath).size + incomingBytes < this.maxBytes) return;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    let archive = `${this.filePath}.${stamp}`;
    let suffix = 1;
    while (existsSync(archive)) {
      archive = `${this.filePath}.${stamp}.${suffix}`;
      suffix += 1;
    }
    renameSync(this.filePath, archive);
  }
}
