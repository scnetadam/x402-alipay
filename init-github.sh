#!/bin/bash
# init-github.sh — 初始化 GitHub 仓库并推送
# 用法: bash init-github.sh <your-github-username>

set -e

if [ -z "$1" ]; then
  echo "用法: bash init-github.sh <your-github-username>"
  echo "示例: bash init-github.sh mingci"
  exit 1
fi

USERNAME=$1
REPO_NAME="x402-alipay"

echo "==> 初始化 Git 仓库..."
git init

echo "==> 添加文件..."
git add .

echo "==> 首次提交..."
git commit -m "feat: x402-alipay 沙箱支付演示

将 x402 支付协议替换为支付宝沙箱实现。
- FastAPI 服务端：402 → 支付 → 验签 → 放行
- 支付宝沙箱：免费测试，无需营业执照
- 抽象 PaymentBackend 接口，方便后续扩展"

echo "==> 创建 GitHub 仓库（需安装 gh CLI）..."
gh repo create "$USERNAME/$REPO_NAME" --public --source=. --remote=origin --push

echo ""
echo "✅ 完成！仓库地址: https://github.com/$USERNAME/$REPO_NAME"
echo "   部署说明见 README.md"
