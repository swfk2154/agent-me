"""命令执行 + 三级安全审批"""
import json, subprocess, shlex, re, datetime as dt
from pathlib import Path
from app_config.settings import STORAGE_DIR

RULES_PATH = STORAGE_DIR / "command_rules.json"
REQUEST_LOG_PATH = STORAGE_DIR / "command_requests.json"

HIGH_RISK_PATTERNS = [
    (r"\brm\s+-rf\b", "递归强制删除"),
    (r"\bgit\s+reset\s+--hard\b", "Git 硬重置"),
    (r"\bgit\s+clean\b", "Git 清理未跟踪"),
    (r">\s*/dev/", "覆写设备文件"),
    (r"\bdd\s+if=", "磁盘直接写入"),
    (r"\bchmod\s+777\b", "开放所有权限"),
    (r"\bcurl.*\|\s*(ba)?sh\b", "远程脚本管道执行"),
    (r"\bwget.*-O\s*-\s*\|\s*(ba)?sh\b", "远程脚本管道执行"),
    (r"\bsudo\b", "提权操作"),
    (r"\bformat\b", "格式化磁盘"),
    (r"\bshutdown\b", "关机"),
    (r"\b-del\s+/[fqs]", "PowerShell 强制删除"),
    (r"\bRemove-Item\s+-Recurse\s+-Force\b", "PowerShell 递归强制删除"),
    (r"\bInvoke-Expression\b|\biex\b", "表达式执行"),
    (r"\bStart-Process\b.*\b-Verb\s+runas\b", "提权启动"),
    (r"\bnet\s+user\b|\bnet\s+localgroup\b", "用户账户操作"),
    (r"\breg\s+delete\b|\bRemove-ItemProperty\b.*\bHK[CLU]M:\b", "注册表删除"),
    (r"\bEncodedCommand\b|\b-ec\b", "Base64 编码命令"),
    (r"\bInvoke-WebRequest\b.*\|.*\bInvoke-Expression\b", "远程脚本管道执行"),
]

DEFAULT_RULES = [
    {"prefix": ["ls"], "action": "always_allow", "reason": "列出文件"},
    {"prefix": ["cat"], "action": "always_allow", "reason": "查看文件"},
    {"prefix": ["echo"], "action": "always_allow", "reason": "输出文本"},
    {"prefix": ["rg"], "action": "always_allow", "reason": "搜索"},
    {"prefix": ["grep"], "action": "always_allow", "reason": "搜索"},
    {"prefix": ["find"], "action": "always_allow", "reason": "查找"},
    {"prefix": ["head"], "action": "always_allow", "reason": "读取文件"},
    {"prefix": ["wc"], "action": "always_allow", "reason": "统计"},
    {"prefix": ["pwd"], "action": "always_allow", "reason": "当前路径"},
    {"prefix": ["whoami"], "action": "always_allow", "reason": "当前用户"},
    {"prefix": ["python", "--version"], "action": "always_allow", "reason": "版本"},
    {"prefix": ["node", "--version"], "action": "always_allow", "reason": "版本"},
    {"prefix": ["git", "status"], "action": "always_allow", "reason": "Git状态"},
    {"prefix": ["git", "diff"], "action": "always_allow", "reason": "Git差异"},
    {"prefix": ["git", "log"], "action": "always_allow", "reason": "Git日志"},
    {"prefix": ["git", "branch"], "action": "always_allow", "reason": "Git分支"},
    {"prefix": ["mkdir"], "action": "ask_first", "reason": "创建目录"},
    {"prefix": ["python"], "action": "ask_first", "reason": "执行Python"},
    {"prefix": ["npm"], "action": "ask_first", "reason": "npm操作"},
    {"prefix": ["git", "add"], "action": "ask_first", "reason": "暂存"},
    {"prefix": ["git", "commit"], "action": "ask_first", "reason": "提交"},
    {"prefix": ["git", "push"], "action": "ask_first", "reason": "推送"},
    {"prefix": ["mv"], "action": "ask_first", "reason": "移动文件"},
    {"prefix": ["cp"], "action": "ask_first", "reason": "复制文件"},
    {"prefix": ["rm"], "action": "ask_first", "reason": "删除文件"},
    {"prefix": ["pip", "install"], "action": "ask_first", "reason": "安装包"},
    {"prefix": ["rm", "-rf"], "action": "never_allow", "reason": "递归强删"},
    {"prefix": ["git", "reset", "--hard"], "action": "never_allow", "reason": "硬重置"},
    {"prefix": ["sudo"], "action": "never_allow", "reason": "提权"},
    {"prefix": ["shutdown"], "action": "never_allow", "reason": "关机"},
]

class CommandService:
    def __init__(self): self._ensure_files()

    def _ensure_files(self):
        if not RULES_PATH.exists():
            RULES_PATH.write_text(json.dumps(DEFAULT_RULES, ensure_ascii=False, indent=2), encoding="utf-8")
        if not REQUEST_LOG_PATH.exists():
            REQUEST_LOG_PATH.write_text(json.dumps([], ensure_ascii=False), encoding="utf-8")

    def get_rules(self): return json.loads(RULES_PATH.read_text(encoding="utf-8"))
    def save_rules(self, rules): RULES_PATH.write_text(json.dumps(rules, ensure_ascii=False, indent=2), encoding="utf-8")
    def reset_rules(self): self.save_rules(DEFAULT_RULES)

    def _split_cmd(self, cmd):
        parts = re.split(r'\s*(\|\||&&|;|\|)\s*', cmd)
        segments, i = [], 0
        while i < len(parts):
            seg = parts[i].strip()
            if seg and seg not in ("||", "&&", ";", "|"):
                try: tokens = shlex.split(seg)
                except ValueError: tokens = seg.split()
                if tokens: segments.append(tokens)
            i += 2 if i + 1 < len(parts) else 1
        return segments

    def _check_high_risk(self, cmd):
        risks = []
        for pat, desc in HIGH_RISK_PATTERNS:
            if re.search(pat, cmd, re.IGNORECASE): risks.append(desc)
        return risks

    def evaluate(self, cmd, workdir="."):
        high_risks = self._check_high_risk(cmd)
        if high_risks:
            return {"action": "never_allow", "reason": f"高危模式: {', '.join(high_risks)}",
                    "segments": [], "high_risks": high_risks, "workdir": workdir}
        segments = self._split_cmd(cmd)
        if not segments:
            return {"action": "never_allow", "reason": "空命令", "segments": [], "high_risks": [], "workdir": workdir}
        rules, results, overall = self.get_rules(), [], "always_allow"
        for seg_tokens in segments:
            action, matched_rule, bl = "ask_first", None, 0
            for rule in rules:
                p = rule["prefix"]
                if len(seg_tokens) >= len(p) and seg_tokens[:len(p)] == p and len(p) > bl:
                    action = rule["action"]; matched_rule = rule["reason"]; bl = len(p)
            results.append({"segment": " ".join(seg_tokens), "action": action, "reason": matched_rule or "未匹配"})
            if action == "never_allow": overall = "never_allow"
            elif action == "ask_first" and overall == "always_allow": overall = "ask_first"
        return {"action": overall, "segments": results, "high_risks": [], "workdir": workdir}

    def execute(self, cmd, workdir=".", timeout=30, approved=False):
        evaluation = self.evaluate(cmd, workdir)
        if evaluation["action"] == "never_allow":
            return {"success": False, "output": "", "error": f"已阻止: {evaluation.get('reason','')}", "evaluation": evaluation}
        if evaluation["action"] == "ask_first" and not approved:
            return {"success": False, "output": "", "error": "此命令需要审批", "evaluation": evaluation, "needs_approval": True}
        # 拒绝含 shell 操作符的多段命令——evaluate() 逐段评估，但 PowerShell 执行整条组合命令
        segments = self._split_cmd(cmd)
        if len(segments) > 1:
            return {"success": False, "output": "", "error": "不允许包含多段命令操作符 (; || && |)", "evaluation": evaluation}
        try:
            result = subprocess.run(
                ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "RemoteSigned", "-Command", cmd],
                capture_output=True, text=True, timeout=timeout, cwd=str(workdir), encoding="utf-8", errors="replace")
            self._log(cmd, result.returncode == 0, str(workdir))
            return {"success": result.returncode == 0, "output": result.stdout[-5000:],
                    "error": result.stderr[-2000:] if result.stderr else "", "returncode": result.returncode, "evaluation": evaluation}
        except subprocess.TimeoutExpired:
            return {"success": False, "output": "", "error": f"超时({timeout}s)", "evaluation": evaluation}
        except Exception as e:
            return {"success": False, "output": "", "error": str(e), "evaluation": evaluation}

    def _log(self, cmd, success, workdir):
        log = json.loads(REQUEST_LOG_PATH.read_text(encoding="utf-8") or "[]")
        log.append({"timestamp": dt.datetime.now().isoformat(), "command": cmd, "workdir": workdir, "success": success})
        if len(log) > 100: log = log[-100:]
        REQUEST_LOG_PATH.write_text(json.dumps(log, ensure_ascii=False, indent=2), encoding="utf-8")

    def get_log(self, limit=50):
        log = json.loads(REQUEST_LOG_PATH.read_text(encoding="utf-8") or "[]")
        return log[-limit:]

command_service = CommandService()
