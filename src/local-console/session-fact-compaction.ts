import { canonicalJson } from "./canonical-json.js";

export interface SessionFactCompactionStats {
  events: number;
  upsertsBefore: number;
  upsertsAfter: number;
  bytesBefore: number;
  bytesAfter: number;
  /** 尾部半行的字节数；压缩时丢弃。 */
  droppedTailBytes: number;
}

export interface SessionFactCompactionResult {
  content: string;
  stats: SessionFactCompactionStats;
}

/**
 * 压缩会话事实日志：每条事件只保留「相对上一状态真正变了的消息」。
 *
 * 事件本身（类型、载荷、顺序、eventId）一条不动，回放结果逐字节等价——
 * 被丢掉的只是键序缺陷时期重复写进去的同一条消息的旧副本。
 */
export function compactSessionFactLog(content: string): SessionFactCompactionResult {
  const bytesBefore = Buffer.byteLength(content, "utf8");
  const completeLength = completeTextLength(content);
  const complete = content.slice(0, completeLength);
  const droppedTailBytes = bytesBefore - Buffer.byteLength(complete, "utf8");
  if (complete === "") {
    return {
      content: "",
      stats: { events: 0, upsertsBefore: 0, upsertsAfter: 0, bytesBefore, bytesAfter: 0, droppedTailBytes },
    };
  }

  const projection = new Map<unknown, string>();
  const lines: string[] = [];
  let upsertsBefore = 0;
  let upsertsAfter = 0;
  for (const [index, line] of complete.slice(0, -1).split("\n").entries()) {
    const event: unknown = parseLine(line, index + 1);
    if (!isRecord(event) || !Array.isArray(event.messageUpserts)) {
      lines.push(line);
      continue;
    }
    const kept: unknown[] = [];
    for (const message of event.messageUpserts) {
      upsertsBefore += 1;
      const id = isRecord(message) ? message.id : undefined;
      const serialized = canonicalJson(message);
      if (projection.get(id) === serialized) {
        continue;
      }
      projection.set(id, serialized);
      kept.push(message);
    }
    upsertsAfter += kept.length;
    lines.push(JSON.stringify({ ...event, messageUpserts: kept }));
  }

  const compacted = `${lines.join("\n")}\n`;
  const replayedBefore = replayMessages(complete);
  const replayedAfter = replayMessages(compacted);
  if (canonicalJson(replayedBefore) !== canonicalJson(replayedAfter)) {
    throw new Error("compaction changed the replayed message state");
  }
  return {
    content: compacted,
    stats: {
      events: lines.length,
      upsertsBefore,
      upsertsAfter,
      bytesBefore,
      bytesAfter: Buffer.byteLength(compacted, "utf8"),
      droppedTailBytes,
    },
  };
}

/** 回放出「消息 id → 最终态」，用于校验压缩前后等价。 */
export function replayMessages(content: string): Array<[unknown, unknown]> {
  const completeLength = completeTextLength(content);
  const complete = content.slice(0, completeLength);
  if (complete === "") {
    return [];
  }
  const messages = new Map<unknown, unknown>();
  for (const [index, line] of complete.slice(0, -1).split("\n").entries()) {
    const event: unknown = parseLine(line, index + 1);
    if (!isRecord(event) || !Array.isArray(event.messageUpserts)) {
      continue;
    }
    for (const message of event.messageUpserts) {
      messages.set(isRecord(message) ? message.id : undefined, message);
    }
  }
  return [...messages.entries()];
}

function completeTextLength(content: string): number {
  if (content.endsWith("\n")) {
    return content.length;
  }
  return content.lastIndexOf("\n") + 1;
}

function parseLine(line: string, lineNumber: number): unknown {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`invalid session fact log line ${String(lineNumber)}: ${String(error)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
