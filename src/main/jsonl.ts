export class JsonlFramer {
  private buffer = '';

  push(chunk: string | Buffer): string[] {
    this.buffer += chunk.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    return lines.map((line) => line.replace(/\r$/, ''));
  }

  finish(): string[] {
    const remainder = this.buffer;
    this.buffer = '';
    return remainder ? [remainder.replace(/\r$/, '')] : [];
  }

  reset(): void {
    this.buffer = '';
  }
}
