/**
 * Terminal UI helpers — zero-dependency ANSI colors & formatting.
 * Colors are disabled when stdout is not a TTY, when NO_COLOR is set, or on
 * legacy Windows consoles without VT support (degrades gracefully).
 */

const tty = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const winVt =
  process.platform !== "win32" ||
  Boolean(process.env.WT_SESSION || process.env.VSCODE_INJECTION || process.env.TERM_PROGRAM);

export const useColor = tty && winVt;

function c(code: string, s: string): string {
  if (!useColor) return s;
  return `\x1b[${code}m${s}\x1b[0m`;
}

export const colors = {
  dim: (s: string) => c("90", s),
  green: (s: string) => c("32", s),
  red: (s: string) => c("31", s),
  yellow: (s: string) => c("33", s),
  cyan: (s: string) => c("36", s),
  magenta: (s: string) => c("35", s),
  blue: (s: string) => c("34", s),
  bold: (s: string) => c("1", s),
  greenBg: (s: string) => c("42;30", s),
  grayBg: (s: string) => c("100;30", s),
};

export const USER_PROMPT = `${colors.cyan("❯")} ${colors.bold("你")} `;
export const AGENT_PREFIX = `${colors.green("❮")} ${colors.bold(colors.green("agent-me"))}`;

/** Startup banner. */
export function banner(provider: string, model: string, mode: string): void {
  const line1 = colors.bold(colors.cyan("  ╔═══════════════════════════════════════════╗"));
  const line2 = `  ║  ${colors.bold("agent-me")} ${colors.dim("v3")}  ·  ${colors.bold("通用个人 AI Agent")} ${colors.dim(mode)}  ║`;
  const line3 = `  ║  ${colors.dim(provider)} / ${colors.dim(model)}                    ║`;
  const line4 = colors.bold(colors.cyan("  ╚═══════════════════════════════════════════╝"));
  console.log("");
  console.log(line1);
  console.log(line2);
  console.log(line3);
  console.log(line4);
  console.log(`  ${colors.dim("/help 查看命令 · Ctrl+C 中断生成 · Ctrl+C 再次退出")}`);
  console.log("");
}

/** Thin separator line between turns. */
export function sep(): void {
  process.stdout.write(colors.dim("  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─\n"));
}

/** Tool-call line with colored name. */
export function toolCallLine(tool: string, argsPreview: string): void {
  process.stdout.write(`  ${colors.yellow("⚙")} ${colors.bold(colors.cyan(tool))} ${colors.dim(argsPreview)}\n`);
}

/** Tool failure line. */
export function toolFailLine(tool: string, error: string): void {
  process.stdout.write(`  ${colors.red("✗")} ${colors.bold(tool)} ${colors.red("失败:")} ${colors.dim(error.slice(0, 160))}\n`);
}

/** Usage line with hit-rate colored by threshold. */
export function usageLine(promptTokens: number, cachedTokens: number): void {
  const hit = promptTokens > 0 ? (cachedTokens / promptTokens) * 100 : 0;
  const pct = `${hit.toFixed(0)}%`;
  const colored = hit >= 70 ? colors.green(pct) : hit >= 30 ? colors.yellow(pct) : colors.red(pct);
  process.stdout.write(
    `  ${colors.dim(`[in ${promptTokens} tok · cache 命中 ${colored}]`)}\n`,
  );
}

/** Generic error line. */
export function errorLine(msg: string): void {
  process.stdout.write(`  ${colors.red("✗")} ${colors.red(msg)}\n`);
}

/** Success / info line. */
export function infoLine(msg: string): void {
  console.log(`  ${colors.green("✓")} ${msg}`);
}
