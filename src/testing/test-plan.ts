/**
 * `pnpm test` 的三种形态与各自的命令序列。
 *
 * 拆出来是为了让「跑什么、要不要加锁」这段判断可以被单测覆盖——入口脚本里只剩 spawn 胶水。
 *
 * - `full`：无参数。跑完整闸门，**要拿锁**（同机只允许一套）。
 * - `scope`：`--scope [base]`。只跑受改动影响的测试，用于开发过程中的快速收口，
 *   **不拿锁**（它轻、且不该排在全量后面等）。它不是全量闸门的替代品，所以跑完必须
 *   打一句提示，避免绿灯被误读成「全量通过」。
 * - `direct`：带文件参数。原有的直通行为，保持不变。
 */

/** 完整闸门里被单独拆出来跑的慢测。它太慢，和其他文件混跑会拖长整体反馈。 */
const SLOW_SUITE = "tests/local-console.test.ts";

/** 根套件与 desktop 的串行参数。并行会让等真实 I/O 的断言互相干扰。 */
const SERIAL_ARGS = ["--maxWorkers=1", "--no-file-parallelism"];

export interface TestCommand {
  args: string[];
  label: string;
  /**
   * scope 模式专用：先跑它列出受影响的测试文件。
   *
   * 必要性在于 `vitest --changed` 找不到文件时会打印 "No test files found" 然后
   * **退出 0**。三个 workspace 全都没命中时，`pnpm test --scope` 就会在一个测试都没跑的
   * 情况下返回成功——这种绿比红更危险。先探测再决定跑不跑，才能把「没有受影响的测试」
   * 和「受影响的测试都通过了」区分开。
   */
  probeArgs?: string[];
}

export type TestMode = "full" | "scope" | "direct";

export interface TestPlan {
  mode: TestMode;
  /** 只有完整闸门需要跨 worktree 互斥。 */
  requiresLock: boolean;
  commands: TestCommand[];
  /** 全部命令跑完后打印的提示。 */
  footer?: string;
  /** scope 模式的基线人话描述，进探测结果的提示语。 */
  baseLabel?: string;
}

function fullPlan(): TestPlan {
  return {
    mode: "full",
    requiresLock: true,
    commands: [
      {
        label: "root (除慢测)",
        args: ["exec", "vitest", "run", "--exclude", SLOW_SUITE, ...SERIAL_ARGS],
      },
      { label: "root (慢测)", args: ["exec", "vitest", "run", SLOW_SUITE, ...SERIAL_ARGS] },
      { label: "desktop", args: ["--filter", "@moebius/desktop", "test"] },
      { label: "console-ui", args: ["--filter", "@moebius/console-ui", "test"] },
    ],
  };
}

function scopePlan(base: string | null): TestPlan {
  // 不带基线时 vitest 按「未提交的改动」算，正好对应开发过程中的收口场景。
  const changed = base === null ? ["--changed"] : ["--changed", base];
  const baseLabel = base ?? "未提交改动";
  const probe = ["exec", "vitest", "list", ...changed, "--filesOnly"];
  return {
    mode: "scope",
    requiresLock: false,
    commands: [
      {
        label: "root (scope)",
        args: ["exec", "vitest", "run", ...changed, ...SERIAL_ARGS],
        probeArgs: probe,
      },
      {
        label: "desktop (scope)",
        args: ["--filter", "@moebius/desktop", "exec", "vitest", "run", ...changed, ...SERIAL_ARGS],
        probeArgs: ["--filter", "@moebius/desktop", ...probe],
      },
      {
        label: "console-ui (scope)",
        args: ["--filter", "@moebius/console-ui", "exec", "vitest", "run", ...changed],
        probeArgs: ["--filter", "@moebius/console-ui", ...probe],
      },
    ],
    footer:
      `[scope] 本轮只跑了受「${baseLabel}」影响的测试，不等于全量通过。` +
      `合并前仍需 pnpm test 取得完整闸门的退出码。`,
    baseLabel,
  };
}

/** 探测输出里有几个测试文件。vitest 的 `list --filesOnly` 一行一个路径。 */
export function countProbedFiles(stdout: string): number {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
}

export interface ScopeOutcome {
  totalFiles: number;
  /** 一个文件都没命中时判失败——静默的绿会被误读成「改动已验证」。 */
  failed: boolean;
  message: string;
}

export function scopeOutcome(counts: readonly number[], baseLabel: string): ScopeOutcome {
  const totalFiles = counts.reduce((sum, count) => sum + count, 0);
  if (totalFiles === 0) {
    return {
      totalFiles,
      failed: true,
      message:
        `[scope] 没有测试受「${baseLabel}」影响，本轮一个测试都没跑。` +
        `这不代表改动是安全的——请确认基线是否正确，或直接跑 pnpm test。`,
    };
  }
  return {
    totalFiles,
    failed: false,
    message: `[scope] 受影响的测试文件：${String(totalFiles)} 个。`,
  };
}

function directPlan(args: string[]): TestPlan {
  return {
    mode: "direct",
    requiresLock: false,
    commands: [{ label: "direct", args: ["exec", "vitest", "run", ...args] }],
  };
}

export function parseTestPlan(argv: string[]): TestPlan {
  if (argv.length === 0) return fullPlan();

  if (argv[0] === "--scope") {
    const rest = argv.slice(1);
    // `--scope` 后面跟的若是选项（以 - 开头）就不是基线，交回 vitest 之外的判断由调用方负责。
    const base = rest.length > 0 && !rest[0].startsWith("-") ? rest[0] : null;
    return scopePlan(base);
  }

  return directPlan(argv);
}
