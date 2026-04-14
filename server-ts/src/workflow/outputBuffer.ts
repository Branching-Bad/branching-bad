import fs from 'node:fs';
import path from 'node:path';

const INLINE_LIMIT = 1024 * 1024;

export interface OutputResult {
  inline: string | null;
  filePath: string | null;
}

export class OutputBuffer {
  private inlineChunks: Buffer[] = [];
  private inlineSize = 0;
  private file: fs.WriteStream | null = null;
  private spilled = false;

  constructor(private readonly overflowPath: string) {}

  write(chunk: Buffer): void {
    if (!this.spilled) {
      if (this.inlineSize + chunk.length <= INLINE_LIMIT) {
        this.inlineChunks.push(chunk);
        this.inlineSize += chunk.length;
        return;
      }
      fs.mkdirSync(path.dirname(this.overflowPath), { recursive: true });
      this.file = fs.createWriteStream(this.overflowPath);
      for (const c of this.inlineChunks) this.file.write(c);
      this.trimInlineToLimit();
      this.spilled = true;
    }
    this.file!.write(chunk);
    if (this.inlineSize < INLINE_LIMIT) {
      const take = Math.min(INLINE_LIMIT - this.inlineSize, chunk.length);
      this.inlineChunks.push(chunk.subarray(0, take));
      this.inlineSize += take;
    }
  }

  private trimInlineToLimit(): void {
    let total = 0;
    const out: Buffer[] = [];
    for (const c of this.inlineChunks) {
      if (total + c.length <= INLINE_LIMIT) { out.push(c); total += c.length; }
      else { out.push(c.subarray(0, INLINE_LIMIT - total)); total = INLINE_LIMIT; break; }
    }
    this.inlineChunks = out;
    this.inlineSize = total;
  }

  async finalize(): Promise<OutputResult> {
    const inline = Buffer.concat(this.inlineChunks).toString('utf8');
    if (this.file) {
      await new Promise<void>((res) => this.file!.end(() => res()));
    }
    return {
      inline: inline.length > 0 ? inline : null,
      filePath: this.spilled ? this.overflowPath : null,
    };
  }
}
