import {
  readTrustedJsonlAppend,
  TrustedJsonlCursorInvalidError,
  type TrustedJsonlFile,
} from "./trusted-jsonl.js";

export interface ClaudeTuiTranscriptFollowerRecord {
  value: unknown;
  lineOffset: number;
}

export interface ClaudeTuiTranscriptFollowerOptions {
  file: TrustedJsonlFile;
  startOffset: number;
  intervalMs: number;
  maxBytes?: number;
  maxEvents?: number;
  onRecord: (record: ClaudeTuiTranscriptFollowerRecord) => void;
  onFailure?: (error: unknown) => void;
}

/**
 * Follows one already-validated Claude transcript without becoming part of
 * the run's result path. The caller owns the trusted file resolution and the
 * record boundary; this class only advances a byte cursor over complete JSONL
 * records and can be stopped at any lifecycle boundary.
 */
export class ClaudeTuiTranscriptFollower {
  private cursor: number;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private running = false;

  constructor(private readonly options: ClaudeTuiTranscriptFollowerOptions) {
    if (!Number.isSafeInteger(options.startOffset) || options.startOffset < 0) {
      throw new Error("Claude transcript follower startOffset must be a non-negative safe integer");
    }
    if (!Number.isSafeInteger(options.intervalMs) || options.intervalMs <= 0) {
      throw new Error("Claude transcript follower intervalMs must be a positive integer");
    }
    this.cursor = options.startOffset;
  }

  get currentOffset(): number {
    return this.cursor;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.poll();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.inFlight;
  }

  private async poll(): Promise<void> {
    if (!this.running || this.inFlight !== null) return;
    const read = this.readOnce();
    this.inFlight = read;
    try {
      await read;
    } finally {
      if (this.inFlight === read) this.inFlight = null;
    }
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll();
    }, this.options.intervalMs);
    this.timer.unref();
  }

  private async readOnce(): Promise<void> {
    try {
      const slice = await readTrustedJsonlAppend({
        file: this.options.file,
        startOffset: this.cursor,
        expectedIdentity: this.options.file.identity,
        minimumSize: this.cursor,
        ...(this.options.maxBytes === undefined ? {} : { maxBytes: this.options.maxBytes }),
        ...(this.options.maxEvents === undefined ? {} : { maxEvents: this.options.maxEvents }),
        projectLine: (value, context) => [{
          value,
          lineOffset: context.lineOffset,
        }],
        malformedLine: () => {
          throw new TrustedJsonlCursorInvalidError("Claude transcript contains a malformed complete line");
        },
      });

      if (!this.running) return;
      this.cursor = slice.nextOffset;
      for (const record of slice.events) {
        if (!this.running) return;
        this.options.onRecord(record);
      }
    } catch (error) {
      if (!this.running) return;
      this.running = false;
      if (this.timer !== null) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      try {
        this.options.onFailure?.(error);
      } catch {
        // Follower diagnostics are non-authoritative and cannot affect the run.
      }
    }
  }
}
