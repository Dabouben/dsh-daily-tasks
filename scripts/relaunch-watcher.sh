#!/bin/bash
# 守望进程：等待 3080 端口释放后拉起 dsh web 并验证插件。
# 由独立会话（setsid）启动，脱离 DSH 进程树，DSH 被杀后依然存活。
LOG=/Users/ok/DPchajian/restart.log
DSH_BIN=/Users/ok/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh

echo "[watcher] started $(date '+%H:%M:%S')" >> "$LOG"
for i in $(seq 1 120); do
  if ! lsof -tiTCP:3080 -sTCP:LISTEN >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if lsof -tiTCP:3080 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[watcher] ✗ 端口 120s 内未释放，放弃" >> "$LOG"
  exit 1
fi
echo "[watcher] 端口已释放，拉起 dsh web" >> "$LOG"
cd "$HOME"
nohup "$DSH_BIN" web >> "$LOG" 2>&1 &
echo "[watcher] dsh 已启动 pid=$!" >> "$LOG"
for i in $(seq 1 60); do
  if curl -s --max-time 3 http://127.0.0.1:3080/ 2>/dev/null | grep -q 'dsh-daily-tasks'; then
    echo "[watcher] ✓ 插件已加载 ($(date '+%H:%M:%S'))" >> "$LOG"
    echo -n "[watcher] client bundle HTTP " >> "$LOG"
    curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/plugins/dsh-daily-tasks/client.js >> "$LOG"
    exit 0
  fi
  sleep 2
done
echo "[watcher] ✗ 120s 内插件未加载" >> "$LOG"
tail -20 "$LOG"
exit 1
