"""agent-me CLI v2.1 — 参考 OpenCode / Hermes / Codex / Claude Code 设计"""
import sys, os, json, signal, subprocess, threading, time
# Windows 兼容：readline 是 Unix 内置模块，Windows 上需要 pyreadline3
try:
    import readline
except ImportError:
    try:
        import pyreadline3 as readline
    except ImportError:
        readline = None
from pathlib import Path
from typing import Optional, List, Dict, Any
from contextlib import contextmanager
import click
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.table import Table
from rich.status import Status
from rich.syntax import Syntax
from rich.text import Text
from rich.box import ROUNDED
import httpx

# Windows 终端修正
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    os.environ.setdefault("PYTHONUTF8", "1")

console = Console(force_terminal=True, legacy_windows=False, highlight=False)
API_BASE = os.environ.get("AGENT_ME_API", "http://localhost:8000/api")


# === 全局状态 ===
class ChatSession:
    """跟踪当前聊天会话状态"""
    def __init__(self):
        self.conv_id: Optional[str] = None
        self.conv_title: str = "新对话"
        self.model: str = ""
        self.skill: str = "default"
        self.file_ids: List[str] = []
        self.uploaded_files: List[Dict[str, Any]] = []
        self.search_enabled: bool = False
        self._streaming: bool = False

    def reset(self):
        self.conv_id = None
        self.conv_title = "新对话"
        self.file_ids = []
        self.uploaded_files = []
        self.search_enabled = False
        self._streaming = False

    @property
    def streaming(self) -> bool:
        return self._streaming

    @streaming.setter
    def streaming(self, v: bool):
        self._streaming = v


session = ChatSession()


# === API 客户端 ===
@contextmanager
def api_client(timeout: float = 120):
    """上下文管理器 API 客户端"""
    client = httpx.Client(timeout=timeout, follow_redirects=True)
    try:
        yield client
    finally:
        client.close()


def _api_get(client: httpx.Client, path: str, **kwargs):
    return client.get(f"{API_BASE}{path}", **kwargs)


def _api_post(client: httpx.Client, path: str, **kwargs):
    return client.post(f"{API_BASE}{path}", **kwargs)


def _api_delete(client: httpx.Client, path: str, **kwargs):
    return client.delete(f"{API_BASE}{path}", **kwargs)


def check_backend(silent: bool = False) -> bool:
    try:
        with api_client(timeout=5) as client:
            r = _api_get(client, "/health")
            if r.status_code == 200:
                data = r.json()
                if not silent:
                    features = data.get("features", [])
                    feat_str = f" ({len(features)} features)" if features else ""
                    console.print(f"[green]✓[/] [bold]{data.get('name','agent-me')}[/] v{data.get('version','')}{feat_str}")
                return True
    except Exception:
        pass
    if not silent:
        console.print("[red]✗ Backend not running. Start: .\\start.ps1[/]")
    return False


# === 代码库感知（参考 Claude Code） ===
class RepoContext:
    """检测并分析当前代码库上下文"""

    PROJECT_MARKERS = {
        "package.json": "Node.js",
        "requirements.txt": "Python",
        "pyproject.toml": "Python",
        "setup.py": "Python",
        "Cargo.toml": "Rust",
        "go.mod": "Go",
        "pom.xml": "Java/Maven",
        "build.gradle": "Java/Gradle",
        "CMakeLists.txt": "C/C++",
        "composer.json": "PHP",
        "Gemfile": "Ruby",
        "pubspec.yaml": "Flutter/Dart",
        "Package.swift": "Swift",
        "build.sbt": "Scala",
        "mix.exs": "Elixir",
    }

    def __init__(self, cwd: Path = None):
        self.cwd = cwd or Path.cwd()
        self.is_git = (self.cwd / ".git").is_dir()
        self.git_branch: Optional[str] = None
        self.git_commit: Optional[str] = None
        self.git_status_count: int = 0
        self.project_type: Optional[str] = None
        self.key_files: List[str] = []
        self._analyze()

    def _run_git(self, args: List[str]) -> str:
        try:
            result = subprocess.run(
                ["git"] + args, cwd=str(self.cwd),
                capture_output=True, text=True, timeout=5,
                encoding="utf-8", errors="replace"
            )
            return result.stdout.strip() if result.returncode == 0 else ""
        except Exception:
            return ""

    def _analyze(self):
        if self.is_git:
            self.git_branch = self._run_git(["branch", "--show-current"]) or None
            commit = self._run_git(["log", "-1", "--format=%h %s"])
            self.git_commit = commit[:60] if commit else None
            status = self._run_git(["status", "--short"])
            self.git_status_count = len([l for l in status.splitlines() if l.strip()]) if status else 0

        for marker, ptype in self.PROJECT_MARKERS.items():
            if (self.cwd / marker).exists():
                self.project_type = ptype
                break

        for pattern in ["README*", "CLAUDE.md", "CONTRIBUTING*"]:
            for f in self.cwd.glob(pattern):
                if f.is_file():
                    self.key_files.append(f.name)
                    break

    def display_banner(self):
        """在聊天开始时显示代码库上下文"""
        if not self.is_git and not self.project_type:
            return

        items = []
        if self.project_type:
            items.append(f"[bold cyan]{self.project_type}[/]")
        if self.is_git:
            branch = self.git_branch or "unknown"
            items.append(f"[dim]git:[/][bold]{branch}[/]")
            if self.git_status_count > 0:
                items.append(f"[yellow]{self.git_status_count} modified[/]")

        if items:
            console.print(f"[dim]│ 工作区: {' │ '.join(items)}[/]")

    def get_system_hint(self) -> str:
        """生成用于系统提示的上下文"""
        lines = []
        if self.project_type:
            lines.append(f"Current project is a {self.project_type} project located at {self.cwd}.")
        if self.is_git:
            lines.append(f"Git branch: {self.git_branch or 'unknown'}")
            if self.git_status_count > 0:
                lines.append(f"There are {self.git_status_count} uncommitted changes.")
        if self.key_files:
            lines.append(f"Key documentation: {', '.join(self.key_files[:3])}")
        return "\n".join(lines) if lines else ""


# === 工具函数 ===
def _pick_model(client: httpx.Client, flag_model: str = "") -> str:
    """让用户选择模型"""
    try:
        r = _api_get(client, "/config/models")
        models_data = r.json() if r.status_code == 200 else []
    except Exception:
        models_data = []

    if not models_data:
        console.print("[yellow]! 没有已配置的模型，使用默认模型[/]")
        return "openai/gpt-4o-mini"

    if flag_model:
        for m in models_data:
            if flag_model.lower() in m["value"].lower() or flag_model.lower() in m["label"].lower():
                return m["value"]
        console.print(f"[yellow]! 未找到模型 '{flag_model}'，将使用列表选择[/]")

    if len(models_data) == 1:
        m = models_data[0]
        console.print(f"[dim]自动选择: {m['label']}[/]")
        return m["value"]

    table = Table(title="可用模型", box=ROUNDED, show_header=True, padding=(0, 1))
    table.add_column("#", style="dim cyan", justify="right", width=3)
    table.add_column("模型", style="bold", min_width=20)
    table.add_column("提供商", style="dim", min_width=10)
    for i, m in enumerate(models_data, 1):
        table.add_row(str(i), m["label"], m["provider"])
    console.print(table)

    while True:
        choice = console.input("[bold]选择模型[/] (序号/名称, Enter=1): ") or "1"
        try:
            idx = int(choice) - 1
            if 0 <= idx < len(models_data):
                return models_data[idx]["value"]
        except ValueError:
            for m in models_data:
                if choice.lower() in m["value"].lower() or choice.lower() in m["label"].lower():
                    console.print(f"[green]✓[/] 选择: {m['label']}")
                    return m["value"]
        console.print("[red]无效选择，请重试[/]")


def _render_markdown(text: str):
    """安全渲染 Markdown"""
    if not text.strip():
        return
    try:
        md = Markdown(text, code_theme="monokai")
        console.print(md)
    except Exception:
        console.print(text)


# === 斜杠命令处理器（参考 Hermes Agent 的斜杠命令系统） ===
def _handle_slash(client: httpx.Client, cmd: str, current_model: str) -> Optional[str]:
    """处理斜杠命令，返回新的模型字符串（如果有变更）"""
    parts = cmd.strip().split(maxsplit=1)
    verb = parts[0].lower()
    arg = parts[1] if len(parts) > 1 else ""

    # 帮助
    if verb in ("/help", "/h"):
        _show_help()
        return None

    # 退出
    if verb in ("/quit", "/q", "/exit"):
        raise KeyboardInterrupt

    # 新建对话
    if verb == "/new":
        title = arg or "CLI Chat"
        try:
            r = _api_post(client, "/chat/new", json={"title": title, "model": current_model})
            data = r.json()
            session.conv_id = data["id"]
            session.conv_title = title
            session.file_ids = []
            session.uploaded_files = []
            console.print(f"[green]✓[/] 新建对话: [bold]{data['id'][:8]}[/] {title}")
        except Exception as e:
            console.print(f"[red]✗ 创建失败: {e}[/]")
        return None

    # 列出对话
    if verb == "/list":
        try:
            r = _api_get(client, "/chat/list")
            convs = r.json() if r.status_code == 200 else []
            if not convs:
                console.print("[dim]没有对话[/]")
                return None

            table = Table(title="对话列表", box=ROUNDED, show_header=True)
            table.add_column("ID", style="dim", width=8)
            table.add_column("标题", min_width=20)
            table.add_column("消息", justify="right", width=6)
            table.add_column("时间", style="dim", width=16)

            for c in convs[:20]:
                is_current = c["id"] == session.conv_id
                prefix = "[bold cyan]▸[/] " if is_current else "  "
                table.add_row(
                    prefix + c["id"][:6],
                    c.get("title", "未命名")[:35] + ("..." if len(c.get("title", "")) > 35 else ""),
                    str(c.get("message_count", 0)),
                    c.get("updated_at", "")[:16]
                )
            console.print(table)
            if len(convs) > 20:
                console.print(f"[dim]... 还有 {len(convs) - 20} 个对话[/]")
        except Exception as e:
            console.print(f"[red]错误: {e}[/]")
        return None

    # 切换对话
    if verb == "/switch":
        if not arg:
            console.print("[yellow]用法: /switch <对话ID>[/]")
            return None
        try:
            r = _api_get(client, "/chat/list")
            convs = r.json() if r.status_code == 200 else []
            target = None
            for c in convs:
                if c["id"].startswith(arg) or c["id"] == arg:
                    target = c
                    break

            if target:
                session.conv_id = target["id"]
                session.conv_title = target.get("title", "未命名")
                console.print(f"[green]✓[/] 切换到: [bold]{session.conv_title}[/] ({target['id'][:8]})")
            else:
                console.print(f"[red]未找到对话: {arg}[/]")
        except Exception as e:
            console.print(f"[red]错误: {e}[/]")
        return None

    # 重命名
    if verb == "/rename":
        if not arg:
            console.print("[yellow]用法: /rename <新标题>[/]")
            return None
        if not session.conv_id:
            console.print("[red]没有活动对话[/]")
            return None
        console.print(f"[dim]重命名需要后端支持，当前对话: {session.conv_title} → {arg}[/]")
        return None

    # 删除
    if verb == "/delete":
        target_id = arg or session.conv_id
        if not target_id:
            console.print("[red]没有指定对话[/]")
            return None
        try:
            r = _api_delete(client, f"/chat/{target_id}")
            if r.status_code in (200, 204):
                console.print(f"[green]✓[/] 已删除")
                if target_id == session.conv_id:
                    session.reset()
            else:
                console.print(f"[red]删除失败: {r.status_code}[/]")
        except Exception as e:
            console.print(f"[red]错误: {e}[/]")
        return None

    # 模型切换
    if verb == "/model":
        if arg:
            try:
                r = _api_get(client, "/config/models")
                models = r.json() if r.status_code == 200 else []
                for m in models:
                    if arg.lower() in m["value"].lower() or arg.lower() in m["label"].lower():
                        console.print(f"[green]✓[/] 切换到: {m['label']}")
                        return m["value"]
                console.print(f"[red]未找到模型: {arg}[/]")
            except Exception as e:
                console.print(f"[red]错误: {e}[/]")
        else:
            try:
                r = _api_get(client, "/config/models")
                models = r.json() if r.status_code == 200 else []
                for m in models:
                    marker = "[green]●[/] " if m["value"] == current_model else "  "
                    console.print(f"{marker}{m['label']} [dim]({m['value']})[/]")
            except Exception as e:
                console.print(f"[red]错误: {e}[/]")
        return None

    # 技能
    if verb == "/skill":
        if arg:
            console.print(f"[dim]技能切换为: {arg}[/]")
            session.skill = arg
        else:
            try:
                r = _api_get(client, "/skills/modes")
                modes = r.json() if r.status_code == 200 else []
                for m in modes:
                    console.print(f"  [bold]{m.get('key','')}[/] - {m.get('description','')}")
            except Exception as e:
                console.print(f"[red]错误: {e}[/]")
        return None

    # 联网搜索开关
    if verb == "/search":
        if arg:
            session.search_enabled = True
            console.print(f"[dim]临时开启联网搜索: {arg}[/]")
        else:
            session.search_enabled = not session.search_enabled
            status = "开启" if session.search_enabled else "关闭"
            console.print(f"[dim]联网搜索已{status}[/]")
        return None

    # 上传文件
    if verb == "/file":
        if not arg:
            console.print("[yellow]用法: /file <文件路径>[/]")
            return None
        fp = Path(arg)
        if not fp.exists():
            console.print(f"[red]文件不存在: {arg}[/]")
            return None
        try:
            console.print(f"[dim]上传 {fp.name}...[/]", end="")
            with open(fp, "rb") as f:
                r = client.post(f"{API_BASE}/files/upload", files={"file": (fp.name, f, "application/octet-stream")})
            if r.status_code == 200:
                data = r.json()
                session.file_ids.append(data.get("id"))
                session.uploaded_files.append({"id": data.get("id"), "name": fp.name})
                console.print(f" [green]✓[/] ({data.get('chunk_count', 0)} chunks)")
            else:
                console.print(f" [red]✗ {r.status_code}[/]")
        except Exception as e:
            console.print(f" [red]✗ {e}[/]")
        return None

    # 清空
    if verb == "/clear":
        if session.conv_id:
            try:
                _api_delete(client, f"/chat/{session.conv_id}")
                r = _api_post(client, "/chat/new", json={"title": session.conv_title, "model": current_model})
                data = r.json()
                session.conv_id = data["id"]
                session.file_ids = []
                session.uploaded_files = []
                console.print("[dim]对话已清空[/]")
            except Exception as e:
                console.print(f"[red]错误: {e}[/]")
        return None

    # 历史
    if verb == "/history":
        if not session.conv_id:
            console.print("[red]没有活动对话[/]")
            return None
        try:
            r = _api_get(client, f"/chat/{session.conv_id}/messages")
            msgs = r.json() if r.status_code == 200 else []
            for i, m in enumerate(msgs, 1):
                role = m.get("role", "")
                content = m.get("content", "")[:100]
                role_style = "[bold blue]User[/]" if role == "user" else "[bold green]AI[/]"
                console.print(f"{i:3d}. {role_style}: {content}{'...' if len(m.get('content', '')) > 100 else ''}")
        except Exception as e:
            console.print(f"[red]错误: {e}[/]")
        return None

    # 信息
    if verb == "/info":
        if session.conv_id:
            console.print(f"[bold]当前对话[/]")
            console.print(f"  ID:    {session.conv_id[:8]}")
            console.print(f"  标题:  {session.conv_title}")
            console.print(f"  模型:  {current_model or '默认'}")
            console.print(f"  技能:  {session.skill}")
            console.print(f"  搜索:  {'开启' if session.search_enabled else '关闭'}")
            if session.uploaded_files:
                console.print(f"  文件:  {', '.join(f['name'] for f in session.uploaded_files)}")
        else:
            console.print("[dim]没有活动对话[/]")
        console.print(f"  后端:  {API_BASE}")
        return None

    # 导出
    if verb == "/export":
        target = arg or session.conv_id
        if not target:
            console.print("[red]没有指定对话[/]")
            return None
        try:
            r = _api_get(client, f"/export/{target}?format=markdown")
            data = r.json()
            if "content" in data:
                out = Path(f"agent-me-{data.get('title','export')[:30].replace(' ','_')}.md")
                out.write_text(data["content"], encoding="utf-8")
                console.print(f"[green]✓[/] 已导出: {out}")
            else:
                console.print("[red]导出失败[/]")
        except Exception as e:
            console.print(f"[red]错误: {e}[/]")
        return None

    # 撤销
    if verb == "/undo":
        console.print("[yellow]撤销功能需要后端支持，暂不可用[/]")
        return None

    # 未知命令
    console.print(f"[dim]未知命令: {verb}，/help 查看帮助[/]")
    return None


def _show_help():
    """显示帮助信息"""
    help_text = """
[bold]斜杠命令[/]

[bold cyan]/new [标题][/]      新建对话
[bold cyan]/list[/]            列出所有对话
[bold cyan]/switch <ID>[/]     切换到指定对话
[bold cyan]/rename <标题>[/]   重命名当前对话
[bold cyan]/delete [ID][/]     删除对话
[bold cyan]/model [名称][/]    查看或切换模型
[bold cyan]/skill [名称][/]    查看或切换技能
[bold cyan]/search [查询][/]   开启/临时联网搜索
[bold cyan]/file <路径>[/]     上传文件到当前对话
[bold cyan]/clear[/]           清空当前对话
[bold cyan]/history[/]         显示对话历史
[bold cyan]/info[/]            显示当前会话信息
[bold cyan]/export [ID][/]     导出对话为 Markdown
[bold cyan]/undo[/]            撤销最后一条消息
[bold cyan]/help, /h[/]        显示此帮助
[bold cyan]/quit, /q[/]       退出

[dim]快捷键: Ctrl+C 取消流式输出 | Ctrl+D 退出[/]
"""
    console.print(help_text)


# === CLI 命令 ===
@click.group()
@click.version_option(version="2.1.0")
def cli():
    """agent-me — 通用个人 AI Agent 终端版 v2.1"""


@cli.command()
@click.option("--model", "-m", default="", help="使用的模型")
@click.option("--skill", "-s", default="", help="技能模式")
@click.option("--search", is_flag=True, help="开启联网搜索")
def chat(model, skill, search):
    """交互式聊天（参考 Claude Code / Hermes Agent 设计）"""
    if not check_backend():
        return

    with api_client() as client:
        selected_model = _pick_model(client, model)
        session.model = selected_model
        session.skill = skill or "default"
        session.search_enabled = search

        # 代码库感知（参考 Claude Code 的代码库理解）
        repo = RepoContext()

        # 创建新对话
        try:
            r = _api_post(client, "/chat/new", json={"title": "CLI Chat", "model": selected_model})
            data = r.json()
            session.conv_id = data["id"]
            session.conv_title = "CLI Chat"
        except Exception as e:
            console.print(f"[red]创建对话失败: {e}[/]")
            return

        # 显示欢迎信息
        console.print()
        console.print(Panel.fit(
            f"[bold #534AB7]agent-me[/] [dim]v2.1[/]\n"
            f"[dim]模型: {selected_model} | 对话: {session.conv_id[:8]}[/]",
            border_style="#534AB7"
        ))
        repo.display_banner()
        console.print("[dim]输入 /help 查看命令，Ctrl+C 取消流，Ctrl+D 退出[/]")
        console.print()

        # 主循环
        while True:
            try:
                user_input = console.input("[bold blue]You[/] > ")
            except (KeyboardInterrupt, EOFError):
                console.print("\n[dim]再见！[/]")
                break

            user_input = user_input.strip()
            if not user_input:
                continue

            # 斜杠命令
            if user_input.startswith("/"):
                new_model = _handle_slash(client, user_input, selected_model)
                if new_model:
                    selected_model = new_model
                    session.model = new_model
                continue

            # 发送消息
            console.print()
            try:
                payload = {
                    "conversation_id": session.conv_id,
                    "content": user_input,
                    "model": selected_model or None,
                    "skill_key": session.skill or None,
                    "file_ids": session.file_ids,
                    "search_enabled": session.search_enabled,
                }

                with Status("[dim]思考中...[/]", spinner="dots") as status:
                    with client.stream("POST", f"{API_BASE}/chat/send", json=payload, timeout=120) as response:
                        full = ""
                        first_token = False

                        for line in response.iter_lines():
                            if line == "data: [DONE]":
                                break
                            if line.startswith("data: "):
                                try:
                                    data = json.loads(line[6:])
                                    token = data.get("token", "")
                                    if token:
                                        if not first_token:
                                            status.stop()
                                            console.print("[bold green]AI[/] > ", end="")
                                            first_token = True
                                        full += token
                                        console.print(token, end="")
                                except json.JSONDecodeError:
                                    pass

                console.print()

            except httpx.ConnectError:
                console.print("[red]后端连接失败，请检查服务是否运行[/]")
                break
            except KeyboardInterrupt:
                console.print("\n[dim][已取消][/]")
                try:
                    _api_post(client, f"/chat/cancel/{session.conv_id}")
                except Exception:
                    pass
            except Exception as e:
                console.print(f"\n[red]错误: {e}[/]")


@cli.command()
@click.argument("question")
@click.option("--model", "-m", default="", help="使用的模型")
@click.option("--file", "-f", multiple=True, help="要分析的文件（可多次指定）")
@click.option("--skill", "-s", default="", help="技能模式")
@click.option("--search", is_flag=True, help="开启联网搜索")
def ask(question, model, file, skill, search):
    """一次性问答"""
    if not check_backend():
        return

    with api_client() as client:
        selected_model = _pick_model(client, model)

        # 上传文件
        file_ids = []
        content = question
        for fpath in file:
            fp = Path(fpath)
            if fp.exists():
                console.print(f"[dim]上传 {fp.name}...[/]", end="")
                try:
                    with open(fp, "rb") as f:
                        r = client.post(f"{API_BASE}/files/upload", files={"file": (fp.name, f, "application/octet-stream")})
                    if r.status_code == 200:
                        data = r.json()
                        file_ids.append(data.get("id"))
                        console.print(" [green]✓[/]")
                    else:
                        console.print(" [red]✗[/]")
                except Exception as e:
                    console.print(f" [red]✗ {e}[/]")
            else:
                console.print(f"[yellow]文件不存在: {fpath}[/]")

        if file_ids:
            content = f"[文件分析请求]\n{question}"

        # 创建对话并发送
        try:
            r = _api_post(client, "/chat/new", json={"title": question[:40]})
            conv_id = r.json()["id"]

            console.print()
            with Status("[dim]思考中...[/]", spinner="dots") as status:
                with client.stream("POST", f"{API_BASE}/chat/send", json={
                    "conversation_id": conv_id,
                    "content": content,
                    "model": selected_model or None,
                    "skill_key": skill or None,
                    "file_ids": file_ids,
                    "search_enabled": search,
                }, timeout=120) as response:
                    full = ""
                    first_token = False

                    for line in response.iter_lines():
                        if line == "data: [DONE]":
                            break
                        if line.startswith("data: "):
                            try:
                                data = json.loads(line[6:])
                                token = data.get("token", "")
                                if token:
                                    if not first_token:
                                        status.stop()
                                        first_token = True
                                    full += token
                                    console.print(token, end="")
                            except json.JSONDecodeError:
                                pass

            console.print()

        except Exception as e:
            console.print(f"[red]错误: {e}[/]")


@cli.command()
def models():
    """列出可用模型"""
    if not check_backend(silent=True):
        return
    with api_client(timeout=10) as client:
        try:
            r = _api_get(client, "/config/models")
            models_data = r.json() if r.status_code == 200 else []
            if not models_data:
                console.print("[dim]没有可用模型，请在 Web 端配置 API Key[/]")
                return

            table = Table(title="可用模型", box=ROUNDED, show_header=True)
            table.add_column("模型", style="bold")
            table.add_column("提供商", style="dim")
            table.add_column("标识", style="dim cyan")
            for m in models_data:
                table.add_row(m["label"], m["provider"], m["value"])
            console.print(table)
        except Exception as e:
            console.print(f"[red]错误: {e}[/]")


@cli.command("conversations")
@click.option("--limit", "-l", default=20, help="显示数量")
def list_conversations(limit):
    """列出所有对话"""
    if not check_backend(silent=True):
        return
    with api_client(timeout=10) as client:
        try:
            r = _api_get(client, "/chat/list")
            convs = r.json() if r.status_code == 200 else []
            if not convs:
                console.print("[dim]没有对话记录[/]")
                return

            table = Table(title="对话列表", box=ROUNDED, show_header=True)
            table.add_column("ID", style="dim", width=8)
            table.add_column("标题", min_width=20)
            table.add_column("模型", style="dim", width=20)
            table.add_column("消息", justify="right", width=6)
            table.add_column("更新时间", style="dim", width=16)

            for c in convs[:limit]:
                table.add_row(
                    c["id"][:6] + "..",
                    c.get("title", "未命名")[:30],
                    c.get("model", "")[:20],
                    str(c.get("message_count", 0)),
                    c.get("updated_at", "")[:16]
                )
            console.print(table)
        except Exception as e:
            console.print(f"[red]错误: {e}[/]")


@cli.command()
@click.argument("conv_id", required=False)
def export(conv_id):
    """导出对话为 Markdown"""
    if not check_backend(silent=True):
        return
    with api_client() as client:
        if not conv_id:
            try:
                r = _api_get(client, "/chat/list")
                convs = r.json() if r.status_code == 200 else []
                if not convs:
                    console.print("[dim]没有对话[/]")
                    return

                table = Table(title="对话列表", box=ROUNDED)
                table.add_column("#", style="dim")
                table.add_column("ID", style="dim")
                table.add_column("标题")
                for i, c in enumerate(convs[:20], 1):
                    table.add_row(str(i), c["id"][:8], c.get("title", "")[:40])
                console.print(table)

                choice = console.input("选择对话 (序号/ID): ")
                try:
                    idx = int(choice) - 1
                    if 0 <= idx < len(convs):
                        conv_id = convs[idx]["id"]
                except ValueError:
                    conv_id = choice
            except Exception as e:
                console.print(f"[red]错误: {e}[/]")
                return

        if not conv_id:
            console.print("[red]未指定对话[/]")
            return

        try:
            r = _api_get(client, f"/export/{conv_id}?format=markdown")
            data = r.json()
            if "content" in data:
                out = Path(f"agent-me-{data.get('title','export')[:30].replace(' ','_')}.md")
                out.write_text(data["content"], encoding="utf-8")
                console.print(f"[green]✓[/] 已导出: [bold]{out}[/]")
            else:
                console.print("[red]导出失败[/]")
        except Exception as e:
            console.print(f"[red]错误: {e}[/]")


@cli.command()
def status():
    """查看后端状态"""
    with api_client(timeout=5) as client:
        try:
            r = _api_get(client, "/health")
            if r.status_code == 200:
                data = r.json()
                console.print(Panel.fit(
                    f"[bold green]●[/] [bold]{data.get('name','agent-me')}[/] v{data.get('version','')}\n"
                    f"[dim]功能: {', '.join(data.get('features', []))}[/]",
                    title="后端状态", border_style="green"
                ))
            else:
                console.print(f"[red]后端返回: {r.status_code}[/]")
        except Exception as e:
            console.print(f"[red]后端未运行: {e}[/]")


@cli.command()
@click.argument("query")
@click.option("--max", default=5, help="结果数量")
def search(query, max):
    """联网搜索"""
    if not check_backend(silent=True):
        return
    with api_client(timeout=30) as client:
        try:
            with Status("[dim]搜索中...[/]", spinner="dots") as status:
                r = _api_get(client, f"/search/web?q={query}&max_results={max}")
                status.stop()
                results = r.json() if r.status_code == 200 else []

            if not results:
                console.print("[dim]没有结果[/]")
                return

            for i, res in enumerate(results, 1):
                console.print(f"\n[bold]{i}.[/] [bold blue]{res.get('title','')}[/]")
                if res.get('snippet'):
                    console.print(f"   {res.get('snippet','')[:200]}")
                if res.get('url'):
                    console.print(f"   [dim]{res.get('url')}[/dim]")
        except Exception as e:
            console.print(f"[red]搜索失败: {e}[/]")


@cli.command()
@click.argument("query")
@click.option("--limit", "-l", default=5, help="结果数量")
def memory(query, limit):
    """搜索长期记忆"""
    if not check_backend(silent=True):
        return
    with api_client(timeout=15) as client:
        try:
            r = _api_get(client, f"/memory/search?q={query}")
            results = r.json() if r.status_code == 200 else []

            if not results:
                console.print("[dim]没有相关记忆[/]")
                return

            for i, item in enumerate(results[:limit], 1):
                content = item.get("content", "")[:200]
                meta = item.get("metadata", {})
                ts = meta.get("timestamp", "")[:16]
                console.print(f"\n[bold]{i}.[/] [dim]{ts}[/]")
                console.print(f"   {content}{'...' if len(item.get('content','')) > 200 else ''}")
        except Exception as e:
            console.print(f"[red]错误: {e}[/]")


@cli.command()
def tasks():
    """任务管理"""
    if not check_backend(silent=True):
        return
    with api_client() as client:
        try:
            r = _api_get(client, "/tasks/list")
            tasks_list = r.json() if r.status_code == 200 else []

            if not tasks_list:
                console.print("[dim]没有任务[/]")
                return

            table = Table(title="任务列表", box=ROUNDED, show_header=True)
            table.add_column("ID", style="dim", width=4)
            table.add_column("标题", min_width=20)
            table.add_column("状态", width=8)
            table.add_column("截止日期", style="dim", width=12)

            for t in tasks_list:
                status_style = {
                    "done": "[green]✓[/]",
                    "pending": "[yellow]○[/]",
                    "in_progress": "[blue]◐[/]",
                }.get(t.get("status", ""), "[dim]?[/]")
                table.add_row(
                    str(t.get("id", "")),
                    t.get("title", "")[:30],
                    status_style,
                    t.get("due_date", "") or "-"
                )
            console.print(table)
        except Exception as e:
            console.print(f"[red]错误: {e}[/]")


@cli.group(invoke_without_command=True)
def config():
    """配置管理"""
    ctx = click.get_current_context()
    if ctx.invoked_subcommand is None:
        _interactive_config()


@config.command("list")
def config_list():
    """列出所有提供商"""
    if not check_backend(silent=True):
        return
    with api_client() as client:
        try:
            r = _api_get(client, "/config/providers")
            providers = r.json() if r.status_code == 200 else []
            if not providers:
                console.print("[dim]没有获取到提供商信息[/]")
                return
            table = Table(title="LLM 提供商", box=ROUNDED)
            table.add_column("ID", style="dim")
            table.add_column("名称")
            table.add_column("状态")
            table.add_column("默认")
            for p in providers:
                status = "[green]已配置[/]" if p.get("configured") else "[dim]未配置[/]"
                default = "[yellow]★[/]" if p.get("is_default") else ""
                table.add_row(p["key"], p["name"], status, default)
            console.print(table)
        except Exception as e:
            console.print(f"[red]错误: {e}[/]")


def _interactive_config():
    """交互式配置：列出提供商→选择→输入 Key→保存（明文显示）"""
    if not check_backend(silent=True):
        return
    with api_client() as client:
        try:
            r = _api_get(client, "/config/providers")
            providers = r.json() if r.status_code == 200 else []
        except Exception:
            console.print("[red]无法获取提供商列表，请确认后端已启动[/]")
            return

        if not providers:
            console.print("[red]未获取到提供商列表[/]")
            return

        # 显示可用提供商
        table = Table(title="选择要配置的 LLM 提供商", box=ROUNDED, show_header=True)
        table.add_column("#", style="dim cyan", justify="right", width=3)
        table.add_column("ID", style="dim")
        table.add_column("名称")
        table.add_column("状态")
        for i, p in enumerate(providers, 1):
            status = "[green]已配置[/]" if p.get("configured") else "[dim]未配置[/]"
            table.add_row(str(i), p["key"], p["name"], status)
        console.print(table)

        # 让用户选择
        while True:
            choice = console.input("[bold]选择序号或 ID[/] (输入回车退出): ").strip()
            if not choice:
                return
            selected = None
            try:
                idx = int(choice) - 1
                if 0 <= idx < len(providers):
                    selected = providers[idx]
            except ValueError:
                for p in providers:
                    if p["key"] == choice:
                        selected = p
                        break
            if selected:
                break
            console.print("[red]无效选择，请重试[/]")

        provider_key = selected["key"]
        provider_name = selected["name"]

        # 输入 API Key（明文显示）
        console.print(f"\n配置 [bold]{provider_name}[/] ({provider_key})")
        console.print("请输入 API Key（明文显示，如需复制粘贴请放心）")
        api_key = console.input(f"[bold]API Key[/]: ").strip()

        if not api_key:
            console.print("[red]API Key 不能为空[/]")
            return

        # 可选设为默认
        set_default = console.input("设为此提供商为默认模型？(y/N): ").strip().lower() == "y"

        # 保存
        try:
            r = _api_post(client, "/config/provider", json={
                "provider_key": provider_key, "api_key": api_key, "enabled": True,
                "is_default": set_default, "models": [],
            })
            if r.status_code == 200:
                console.print(f"[green]✓[/] {provider_name} 配置已保存")
                if set_default:
                    r2 = _api_post(client, "/config/default", json={"provider_key": provider_key})
                    if r2 and r2.ok:
                        console.print(f"[green]✓[/] {provider_name} 已设为默认")
            else:
                console.print(f"[red]保存失败: {r.status_code}[/]")
        except Exception as e:
            console.print(f"[red]错误: {e}[/]")


@config.command("test")
@click.argument("provider")
def config_test(provider):
    """测试提供商连接"""
    if not check_backend(silent=True):
        return
    with api_client() as client:
        console.print(f"[dim]测试 {provider}...[/]")
        try:
            r = _api_post(client, "/config/test", json={"provider_key": provider})
            result = r.json()
            if result.get("success"):
                console.print(f"[green]✓[/] {result['message']}")
            else:
                console.print(f"[red]✗[/] {result['message']}")
        except Exception as e:
            console.print(f"[red]错误: {e}[/]")


@cli.command()
@click.option("--lines", "-n", default=50, help="显示行数")
@click.option("--type", "log_type", default="all", help="日志类型 (all/errors)")
def logs(lines, log_type):
    """查看后端日志"""
    if not check_backend(silent=True):
        return
    with api_client(timeout=10) as client:
        try:
            r = _api_get(client, f"/logs?type={log_type}&lines={lines}")
            data = r.json() if r.status_code == 200 else {}
            log_lines = data.get("logs", [])
            if not log_lines:
                console.print("[dim]没有日志[/]")
                return

            for line in log_lines:
                if "ERROR" in line or "错误" in line:
                    console.print(f"[red]{line}[/]")
                elif "WARN" in line:
                    console.print(f"[yellow]{line}[/]")
                else:
                    console.print(line)
        except Exception as e:
            console.print(f"[red]错误: {e}[/]")


if __name__ == "__main__":
    cli()
