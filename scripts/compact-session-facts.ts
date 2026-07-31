#!/usr/bin/env tsx
/**
 * 压缩会话事实日志（sessions/*.jsonl）。
 *
 *   pnpm exec tsx scripts/compact-session-facts.ts            # 体检默认数据目录，不落盘
 *   pnpm exec tsx scripts/compact-session-facts.ts --write    # 真正重写
 *   pnpm exec tsx scripts/compact-session-facts.ts <路径...>  # 指定目录或单个 .jsonl
 *
 * 键序缺陷时期（见 openspec/specs/local-console/spec.md「事实事件只携带真正变更的消息」）写下的日志里，
 * 每条事件都重复携带了整个会话的全部消息。这里按「只保留真变更」重写，
 * 回放结果不变，文件通常缩小两个数量级。重写前会校验回放等价，不等价直接报错跳过。
 *
 * 只在应用未运行时执行：重写期间有进程追加会丢事件。
 */

import fs from "node:fs/promises";
import path from "node:path";

import { LOCAL_CONSOLE_SESSION_LOG_ROOT } from "../src/config.js";
import { compactSessionFactLog } from "../src/local-console/session-fact-compaction.js";

interface FileOutcome {
  filePath: string;
  bytesBefore: number;
  bytesAfter: number;
  upsertsBefore: number;
  upsertsAfter: number;
  error?: string;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const write = argv.includes("--write");
  const targets = argv.filter((argument) => !argument.startsWith("--"));
  const files = await collectFiles(targets.length > 0 ? targets : [LOCAL_CONSOLE_SESSION_LOG_ROOT]);
  if (files.length === 0) {
    console.log("没有找到 .jsonl 事实日志");
    return 0;
  }

  const outcomes: FileOutcome[] = [];
  for (const filePath of files) {
    outcomes.push(await compactFile(filePath, write));
  }

  const failed = outcomes.filter((outcome) => outcome.error !== undefined);
  const totalBefore = sum(outcomes.map((outcome) => outcome.bytesBefore));
  const totalAfter = sum(outcomes.map((outcome) => outcome.error === undefined ? outcome.bytesAfter : outcome.bytesBefore));
  for (const outcome of outcomes.slice().sort((left, right) => right.bytesBefore - left.bytesBefore)) {
    if (outcome.error !== undefined) {
      console.log(`✗ ${path.basename(outcome.filePath)}  ${outcome.error}`);
      continue;
    }
    if (outcome.bytesAfter === outcome.bytesBefore) {
      continue;
    }
    console.log([
      `${path.basename(outcome.filePath)}`,
      `${formatBytes(outcome.bytesBefore)} → ${formatBytes(outcome.bytesAfter)}`,
      `upserts ${String(outcome.upsertsBefore)} → ${String(outcome.upsertsAfter)}`,
    ].join("  "));
  }
  console.log([
    write ? "已重写" : "体检（未落盘，加 --write 生效）",
    `${String(files.length)} 个文件`,
    `${formatBytes(totalBefore)} → ${formatBytes(totalAfter)}`,
  ].join("  "));
  return failed.length > 0 ? 1 : 0;
}

async function compactFile(filePath: string, write: boolean): Promise<FileOutcome> {
  const content = await fs.readFile(filePath, "utf8");
  try {
    const { content: compacted, stats } = compactSessionFactLog(content);
    if (write && stats.bytesAfter !== stats.bytesBefore) {
      const temporaryPath = `${filePath}.compacting`;
      await fs.writeFile(temporaryPath, compacted, "utf8");
      await fs.rename(temporaryPath, filePath);
    }
    return {
      filePath,
      bytesBefore: stats.bytesBefore,
      bytesAfter: stats.bytesAfter,
      upsertsBefore: stats.upsertsBefore,
      upsertsAfter: stats.upsertsAfter,
    };
  } catch (error) {
    return {
      filePath,
      bytesBefore: Buffer.byteLength(content, "utf8"),
      bytesAfter: Buffer.byteLength(content, "utf8"),
      upsertsBefore: 0,
      upsertsAfter: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function collectFiles(targets: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const target of targets) {
    const stats = await fs.stat(target).catch(() => null);
    if (stats === null) {
      console.log(`跳过不存在的路径：${target}`);
      continue;
    }
    if (stats.isDirectory()) {
      const entries = await fs.readdir(target);
      files.push(...entries.filter((entry) => entry.endsWith(".jsonl")).map((entry) => path.join(target, entry)));
      continue;
    }
    files.push(target);
  }
  return files;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${String(bytes)}B`;
}

process.exitCode = await main();
