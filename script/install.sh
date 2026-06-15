#!/usr/bin/env bash
# agent-me 一键安装脚本 (macOS / Linux)
# 功能：环境检测、镜像加速、零报错安装、并行安装、进度显示

set -e

USE_MIRROR=false
USE_VENV=false
FULL_INSTALL=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --mirror) USE_MIRROR=true; shift ;;
        --venv) USE_VENV=true; shift ;;
        --full) FULL_INSTALL=true; shift ;;
        -h|--help)
            echo "用法: ./install.sh [--mirror] [--venv] [--full]"
            echo "  --mirror  使用国内镜像源加速（强烈推荐）"
            echo "  --venv    使用 Python 虚拟环境"
            echo "  --full    安装完整版（含向量记忆 + 文件分析，约 400MB）"
            exit 0
            ;;
        *) echo "未知参数: $1"; exit 1 ;;
    esac
done

start_time=$(date +%s)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

step() {
    echo ""
    echo "==> $1"
}

ok() {
    echo "   $1"
}

warn() {
    echo "   $1"
}

# ==================== 1. 环境检测 ====================
step "检测运行环境"

if ! command -v python3 &>/dev/null; then
    echo "[错误] 未找到 python3。请先安装 Python 3.10+"
    echo "下载地址：https://www.python.org/downloads/"
    exit 1
fi

py_version=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
py_major=$(echo "$py_version" | cut -d. -f1)
py_minor=$(echo "$py_version" | cut -d. -f2)
if [[ "$py_major" -lt 3 ]] || [[ "$py_major" -eq 3 && "$py_minor" -lt 10 ]]; then
    echo "[错误] Python 版本 $py_version 过低，需要 3.10+"
    exit 1
fi
ok "Python $py_version"

if ! command -v node &>/dev/null; then
    echo "[错误] 未找到 Node.js。请先安装 Node.js 18+"
    echo "下载地址：https://nodejs.org/"
    exit 1
fi

node_major=$(node --version | sed 's/v\([0-9]*\).*/\1/')
if [[ "$node_major" -lt 18 ]]; then
    echo "[错误] Node.js 版本过低，需要 18+"
    exit 1
fi
ok "Node.js $(node --version)"

# ==================== 2. 虚拟环境 (可选) ====================
PYTHON_CMD="python3"
if [[ "$USE_VENV" == true ]]; then
    step "创建虚拟环境"
    if [[ ! -d "$ROOT_DIR/.venv" ]]; then
        python3 -m venv "$ROOT_DIR/.venv"
    fi
    source "$ROOT_DIR/.venv/bin/activate"
    PYTHON_CMD="$ROOT_DIR/.venv/bin/python"
    ok "已激活虚拟环境"
fi

# ==================== 3. 配置镜像源 ====================
if [[ "$USE_MIRROR" == true ]]; then
    step "配置国内镜像源"

    # pip
    pip_config_dir="$HOME/.config/pip"
    mkdir -p "$pip_config_dir"
    cat > "$pip_config_dir/pip.conf" <<EOF
[global]
index-url = https://pypi.tuna.tsinghua.edu.cn/simple
trusted-host = pypi.tuna.tsinghua.edu.cn
EOF
    ok "pip 已切换至清华镜像"

    # npm
    npm config set registry https://registry.npmmirror.com
    ok "npm 已切换至淘宝镜像"
else
    warn "提示：国内网络较慢可加 --mirror 参数启用镜像加速"
fi

# ==================== 4. 并行安装依赖 ====================
step "安装依赖（后端和前端并行）"

REQ_FILE="requirements.txt"
if [[ "$FULL_INSTALL" == true ]]; then
    REQ_FILE="requirements-full.txt"
    warn "完整版依赖约 400MB（ONNX 嵌入替代 PyTorch），首次安装 3~8 分钟属正常"
else
    warn "安装轻量版核心依赖（约 50MB）。如需向量记忆 + 文件分析，加 --full 参数"
fi

# 构建 pip 参数
PIP_EXTRA_ARGS="--prefer-binary"
if [[ "$USE_MIRROR" == true ]]; then
    PIP_EXTRA_ARGS="$PIP_EXTRA_ARGS -i https://pypi.tuna.tsinghua.edu.cn/simple --trusted-host pypi.tuna.tsinghua.edu.cn"
fi

# 后端
(
    cd "$ROOT_DIR/backend"
    $PYTHON_CMD -m pip install --upgrade pip setuptools wheel >/dev/null 2>&1
    $PYTHON_CMD -m pip install -r $REQ_FILE $PIP_EXTRA_ARGS
    echo "[后端] 安装完成"
) &
BACKEND_PID=$!

# 前端
(
    cd "$ROOT_DIR/frontend"
    npm install
    echo "[前端] 安装完成"
) &
FRONTEND_PID=$!

# 等待两个任务完成，并检查退出码
backend_ok=true
frontend_ok=true

wait $BACKEND_PID || backend_ok=false
wait $FRONTEND_PID || frontend_ok=false

if [[ "$backend_ok" != true ]]; then
    echo ""
    echo "[错误] 后端依赖安装失败。常见原因："
    echo "  1. 网络不稳定（国内建议加 --mirror 参数）"
    echo "  2. 磁盘空间不足（需要至少 3GB 可用空间）"
    exit 1
fi

if [[ "$frontend_ok" != true ]]; then
    echo ""
    echo "[错误] 前端依赖安装失败。请检查网络连接。"
    exit 1
fi

# ==================== 5. 安装 CLI (可选) ====================
read -rp "是否安装 CLI 工具？(y/N) " install_cli
if [[ "$install_cli" =~ ^[Yy]$ ]]; then
    step "安装 CLI 工具"
    cd "$ROOT_DIR/cli"
    $PYTHON_CMD -m pip install -e . --prefer-binary
    cd "$ROOT_DIR"
    ok "CLI 安装完成"
fi

# ==================== 6. 完成 ====================
elapsed=$(($(date +%s) - start_time))
step "安装完成"
ok "总耗时: ${elapsed} 秒"
echo ""
echo "启动项目:"
echo "  ./start.sh"
echo ""
echo "停止项目:"
echo "  ./stop.sh"
