/**
 * Minimal zero-dependency argv parser for the agent-me CLI.
 */

export interface CliFlags {
  model?: string;
  provider?: string;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  approval: "untrusted" | "on-request" | "never";
  workspace?: string;
  cwd?: string;
  prompt?: string;
  files: string[];
  outputFormat: "text" | "json" | "stream-json";
  port?: number;
  conversationId?: string;
  help: boolean;
  version: boolean;
  quiet: boolean;
  interactive: boolean;
  positionals: string[];
}

export const SANDBOX_LEVELS = ["read-only", "workspace-write", "danger-full-access"] as const;
export const APPROVAL_LEVELS = ["untrusted", "on-request", "never"] as const;

export function parseArgs(argv: string[]): CliFlags {
  const flags: CliFlags = {
    sandbox: "workspace-write",
    approval: "on-request",
    files: [],
    outputFormat: "text",
    help: false,
    version: false,
    quiet: false,
    interactive: false,
    positionals: [],
  };
  const positionals: string[] = [];

  const take = (i: number, name: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("-")) {
      throw new Error(`选项 ${name} 需要一个值`);
    }
    return v;
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case "-h":
      case "--help":
        flags.help = true;
        break;
      case "-v":
      case "--version":
        flags.version = true;
        break;
      case "-m":
      case "--model":
        flags.model = take(i, a);
        i++;
        break;
      case "-p":
      case "--provider":
        flags.provider = take(i, a);
        i++;
        break;
      case "-s":
      case "--sandbox":
        flags.sandbox = take(i, a) as CliFlags["sandbox"];
        if (!(SANDBOX_LEVELS as readonly string[]).includes(flags.sandbox)) {
          throw new Error(`--sandbox 必须是 ${SANDBOX_LEVELS.join(" | ")}`);
        }
        i++;
        break;
      case "-a":
      case "--approval":
        flags.approval = take(i, a) as CliFlags["approval"];
        if (!(APPROVAL_LEVELS as readonly string[]).includes(flags.approval)) {
          throw new Error(`--approval 必须是 ${APPROVAL_LEVELS.join(" | ")}`);
        }
        i++;
        break;
      case "-w":
      case "--workspace":
        flags.workspace = take(i, a);
        i++;
        break;
      case "--cwd":
        flags.cwd = take(i, a);
        i++;
        break;
      case "-f":
      case "--file":
        flags.files.push(take(i, a));
        i++;
        break;
      case "--output-format":
        flags.outputFormat = take(i, a) as CliFlags["outputFormat"];
        if (!["text", "json", "stream-json"].includes(flags.outputFormat)) {
          throw new Error("--output-format 必须是 text | json | stream-json");
        }
        i++;
        break;
      case "--port":
        flags.port = Number(take(i, a));
        i++;
        break;
      case "--conversation-id":
        flags.conversationId = take(i, a);
        i++;
        break;
      case "-q":
      case "--quiet":
        flags.quiet = true;
        break;
      case "-i":
      case "--interactive":
        flags.interactive = true;
        break;
      default:
        if (a.startsWith("-")) throw new Error(`未知选项: ${a}`);
        positionals.push(a);
    }
  }
  flags.positionals = positionals;
  return flags;
}
