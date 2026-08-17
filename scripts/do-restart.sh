#!/bin/bash
# 延迟 3 秒后执行重启（给当前会话收尾时间），由 launchd/nohup 托管，脱离会话进程树。
sleep 3
exec bash /Users/ok/DPchajian/restart-dsh.sh
