import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

export class DiagnosticLog {
  constructor(
    readonly filePath: string,
    private readonly maxBytes = 2 * 1024 * 1024,
    private readonly retainedFiles = 3,
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

    const oldest = `${this.filePath}.${this.retainedFiles}`;
    if (existsSync(oldest)) unlinkSync(oldest);
    for (let index = this.retainedFiles - 1; index >= 1; index -= 1) {
      const from = `${this.filePath}.${index}`;
      if (existsSync(from)) renameSync(from, `${this.filePath}.${index + 1}`);
    }
    renameSync(this.filePath, `${this.filePath}.1`);
  }
}
