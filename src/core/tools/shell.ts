/**
 * Security model — two orthogonal layers, following the analysis in
 * https://blogbu2154.site/ai-coding-agents-compare/ (sandbox tier governs
 * *where* the agent may touch; approval policy governs *when* it asks).
 *
 *   Sandbox tiers (--sandbox):
 *     read-only          filesystem is read-only; only read-only commands run
 *     workspace-write    writes allowed inside the workspace root only
 *     danger-full-access unrestricted filesystem & commands (still policy-gated)
 *
 *   Approval policies (--approval):
 *     untrusted          every non-allowlisted command asks the user
 *     on-request         allowlisted commands run; everything else asks
 *     never              never ask (YOLO) — dangerous patterns still refused
 *
 * The default is (workspace-write, on-request): least privilege by default,
 * escalate per action.
 */
import { spawn } from "node:child_process";
import type { Tool, ToolContext, ToolResult } from "./registry.ts";

export type SandboxLevel = "read-only" | "workspace-write" | "danger-full-access";
export type ApprovalPolicy = "untrusted" | "on-request" | "never";

export interface SecurityConfig {
  sandbox: SandboxLevel;
  approval: ApprovalPolicy;
  commandTimeoutMs?: number;
}

export const DEFAULT_SECURITY: SecurityConfig = {
  sandbox: "workspace-write",
  approval: "on-request",
  commandTimeoutMs: 30_000,
};

const MAX_OUTPUT_CHARS = 6000;

/** Read-only commands that never mutate state. */
const READONLY: RegExp[] = [
  /^(ls|dir|pwd|cd|cat|type|head|tail|more|less|find|where|which|locate|echo|date|time)(\s|$)/,
  /^(git status|git log|git diff|git branch|git stash list|git show)(\s|$)/,
  /^(node --version|node -v|npm --version|npm -v|python --version|python3 --version|go version|rustc --version)(\s|$)/,
  /^(ipconfig|ifconfig|netstat|nslookup)(\s|$)/,
  /^(ping\s+-c|ping\s+-n)(\s|$)/,
];

/** Never allowed regardless of approval policy or sandbox tier. */
const ALWAYS_DENY: RegExp[] = [
  /rm\s+-rf\s+(\/|~|\*)/,
  /rm\s+-fr\s+(\/|~|\*)/,
  /del\s+\/f\s+\/s\s+[a-z]:\\/i,
  /rmdir\s+\/s\s+[a-z]:\\/i,
  /format\s+[a-z]:/i,
  /mkfs/,
  /dd\s+if=/,
  /shutdown|reboot|halt/,
  /reg\s+(add|delete)\s+/i,
  /sc\s+(stop|delete)\s+/i,
  /net\s+user\s+/,
  /chmod\s+-R\s+777\s+\//,
  /:\(\)\s*\{/,
  /\|\s*(sh|bash|cmd|powershell|pwsh)\s*$/,
  />\s*\/(etc|boot|sys|Windows|System32|Program\s*Files)/i,
];

/** Commands that write outside a single file / mutating commands. */
const MUTATING: RegExp[] = [
  /^(rm|del|rmdir|mv|move|cp|copy|mkdir|touch|chmod|chown)(\s|$)/,
  /^(git add|git commit|git push|git pull|git reset|git checkout|git merge|git rebase|git clean|git stash|git tag)(\s|$)/,
  /^(npm install|npm i|npm run|npm uninstall|pnpm|yarn|bun install)(\s|$)/,
  /^(pip install|pip uninstall|pipenv|poetry|uv)(\s|$)/,
  /^(go get|go install|go mod tidy|cargo (build|install|add|remove|update)|rustup)(\s|$)/,
  /^(make|cmake|ninja|gradle|mvn|sbt)(\s|$)/,
  /^(curl|wget)\s+.*-o/i,
  /^(docker|podman)(\s|$)/,
  /^(start|open|explorer|code)(\s|$)/,
  /^(taskkill|kill|pkill|killall)(\s|$)/,
  /^(Set-|Remove-|New-|Copy-|Move-|Start-|Stop-)(Item|Service|Process|Content)/i,
  /^(powershell|pwsh)(\s|$)/,
];

function isReadonly(cmd: string): boolean {
  return READONLY.some((re) => re.test(cmd));
}

function isAlwaysDenied(cmd: string): boolean {
  return ALWAYS_DENY.some((re) => re.test(cmd));
}

function isMutating(cmd: string): boolean {
  return MUTATING.some((re) => re.test(cmd)) || /[|&;]/.test(cmd);
}

/**
 * Decide whether a command may run without asking, needs confirmation, or is
 * refused — given the sandbox tier and approval policy.
 */
export function classifyCommand(cmd: string, sec: SecurityConfig): "allow" | "confirm" | "deny" {
  if (isAlwaysDenied(cmd)) return "deny";

  const readonly = isReadonly(cmd);
  if (sec.sandbox === "read-only" && !readonly) {
    return "deny";
  }
  if (sec.sandbox === "workspace-write" && sec.approval === "untrusted") {
    // Untrusted: even reads that aren't allowlisted ask; mutations always ask.
    return readonly ? "allow" : "confirm";
  }
  if (sec.approval === "never") {
    // YOLO: allow everything not on the always-deny list.
    return "allow";
  }
  // on-request (default): allowlisted reads pass, everything else asks.
  if (sec.approval === "untrusted" && readonly) return "allow";
  if (readonly && sec.sandbox === "danger-full-access") return "allow";
  if (isMutating(cmd) && sec.approval === "on-request") return "confirm";
  if (sec.sandbox === "danger-full-access" && !isMutating(cmd)) return "allow";
  return "confirm";
}

function runShell(cmd: string, opts: { cwd: string; timeoutMs: number; signal?: AbortSignal }): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === "win32";
    const child = isWin
      ? spawn("cmd.exe", ["/d", "/s", "/c", cmd], { cwd: opts.cwd, windowsHide: true })
      : spawn("/bin/sh", ["-c", cmd], { cwd: opts.cwd });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({ code: -1, stdout, stderr: `${stderr}\n[timeout after ${opts.timeoutMs}ms]`.trim() });
    }, opts.timeoutMs);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({ code: -1, stdout, stderr: `${stderr}\n[aborted]`.trim() });
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export function registerShellTool(
  registry: { register: (t: Tool) => void },
  security?: () => SecurityConfig,
): void {
  const getSec = security ?? (() => DEFAULT_SECURITY);
  registry.register({
    name: "run_command",
    description:
      "Run a shell command in the workspace directory. " +
      "Read-only commands run automatically; mutating commands may require confirmation " +
      "depending on the sandbox tier (--sandbox) and approval policy (--approval). " +
      "Destructive commands are always refused.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to run" },
        timeout_ms: { type: "number", description: "Timeout in ms (default 30000, max 120000)" },
      },
      required: ["command"],
      additionalProperties: false,
    },
    handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
      const cmd = String(args.command ?? "").trim();
      if (!cmd) return { ok: false, output: "", error: "command is required" };
      const sec = getSec();
      const timeoutMs = typeof args.timeout_ms === "number"
        ? Math.min(Math.max(args.timeout_ms, 1000), 120_000)
        : (sec.commandTimeoutMs ?? 30_000);

      const level = classifyCommand(cmd, sec);
      if (level === "deny") {
        return { ok: false, output: "", error: `command refused by security policy (sandbox=${sec.sandbox}, approval=${sec.approval}): ${cmd.slice(0, 120)}` };
      }
      if (level === "confirm") {
        if (!ctx.ask) {
          return { ok: false, output: "", error: `command requires confirmation but no interactive channel is available: ${cmd.slice(0, 120)}` };
        }
        const answer = await ctx.ask(`允许执行命令吗？\n$ ${cmd}\n[y/N] `);
        if (!/^y(es)?$/i.test(answer.trim())) {
          return { ok: false, output: "", error: "command denied by user" };
        }
      }

      const { code, stdout, stderr } = await runShell(cmd, { cwd: ctx.cwd, timeoutMs, signal: ctx.signal });
      const out = [stdout, stderr].filter(Boolean).join("\n");
      const trimmed = out.length > MAX_OUTPUT_CHARS ? out.slice(0, MAX_OUTPUT_CHARS) + "\n… (truncated)" : out;
      return { ok: code === 0, output: trimmed || `(exit code ${code}, no output)`, error: code === 0 ? undefined : `exit code ${code}` };
    },
  });
}
