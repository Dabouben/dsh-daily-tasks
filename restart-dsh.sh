#!/bin/bash
# 重启 DeepSeek Harness web（加载 dsh-daily-tasks 插件）并自动验证
# 用法: bash restart-dsh.sh
set -u
PORT=3080
DSH_BIN="/Users/ok/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh"
LOG=/Users/ok/DPchajian/restart.log

OLD=$(lsof -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null | head -1)
if [ -n "$OLD" ]; then
  echo "[1/4] 停止旧进程 PID=$OLD ..."
  kill -TERM "$OLD" 2>/dev/null
  for i in $(seq 1 30); do
    lsof -tiTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 || break
    sleep 1
  done
else
  echo "[1/4] 未发现运行中的实例"
fi

echo "[2/4] 启动 dsh web（nohup 后台）..."
cd "$HOME"
nohup "$DSH_BIN" web >> "$LOG" 2>&1 &
echo "      已启动，日志: $LOG（会话数据保存在 ~/.dsh/sessions，不丢失）"

echo "[3/4] 等待插件加载（最多 120s）..."
READY=0
for i in $(seq 1 60); do
  if curl -s --max-time 3 "http://127.0.0.1:$PORT/" 2>/dev/null | grep -q 'dsh-daily-tasks'; then
    READY=1
    break
  fi
  sleep 2
done

if [ "$READY" = "1" ]; then
  echo "[4/4] ✓ 插件已加载！"
  echo -n "  client bundle: HTTP "
  curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$PORT/plugins/dsh-daily-tasks/client.js"
  echo -n "  任务接口: "
  curl -s --max-time 5 "http://127.0.0.1:$PORT/dsh-daily-tasks/state" | head -c 160
  echo
  echo "请刷新浏览器 http://127.0.0.1:$PORT —— 输入栏上方应出现任务滚动条"
else
  echo "[4/4] ✗ 超时未加载，请查看日志: $LOG"
  tail -20 "$LOG"
fi
