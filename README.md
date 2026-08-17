# dsh-daily-tasks

**DeepSeek Harness 每日/每周任务管理 + DeepSeek API 用量监控插件**

一个为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web GUI 打造的双功能插件：**每日/每周任务管理**与 **DeepSeek API 用量/余额监控**。纯本地运行，数据落盘在 `$DSH_HOME`，不修改 DSH 源码。

---

## ✨ 功能总览

### 🗓️ 每日/每周任务

| 功能 | 说明 |
|---|---|
| 🪟 **启动弹窗提醒** | 每天第一次打开 DSH 时弹出窗口，填写今日任务与本周任务 |
| 🔁 **延期选择** | 关闭弹窗时，昨日未完成任务用圆圈选择「延期到今天」或「归档」（顺延任务进入周总结统计） |
| 🎞️ **横屏滚动条** | 固定在对话输入栏上方，今日（蓝）与本周（紫）任务混排横向滚动，悬停暂停；间隔可调 |
| ⭕ **圆圈完成** | 点击滚动任务展开大卡片，右侧大圆圈一键完成/取消；卡片内可编辑标题/备注/分类、删除 |
| ➕ **随时添加** | 滚动条右侧「＋」按钮随时添加今日/本周任务，无需等待启动弹窗 |
| 📊 **周日 AI 周总结** | 每周日（可自定义重置日）打开时弹出上周总结：DeepSeek 模型生成文字总结 + 完成率/分类统计 + 可复制 |
| ⚙️ **可自定义设置** | 弹窗/滚动条/延期提醒/提示音开关、每周重置日（周日至周六）、滚动速度（实时预览） |

### ⚡ DeepSeek API 用量监控（侧边栏小部件）

| 功能 | 说明 |
|---|---|
| 💰 **余额卡片** | 官方 `/user/balance` 接口实时查询：总余额/赠送余额/充值余额 + 可用状态（缓存 60s） |
| 📈 **用量概览** | 今日/累计消耗金额与 tokens（按 DeepSeek 官方价目表折算，含 2026-08-17 起峰谷定价：北京 9-12/14-18 高峰×3） |
| 📊 **按模型明细** | 每个模型（deepseek-v4-flash / v4-pro 等）的费用、调用次数、token 拆分 |
| 📉 **近 7 日柱状图** | 每日费用迷你柱状图，仿 DeepSeek 官方 API 使用页面 |
| 🔄 **定时/手动刷新** | 每 60s 自动刷新 + 手动刷新按钮 |
| 📍 **位置** | 侧边栏底部（设置上方），随侧边栏一起折叠/展开 |

**数据来源**：用量由本地 `$DSH_HOME/sessions` 会话日志聚合（zstd 解压，`assistant/message` 事件的 usage 字段），真实反映本机 DSH 的消耗；余额来自 DeepSeek 官方接口（通过 DSH 凭证系统读取 API Key）。

---

## 📦 安装

### 方式一：npm 安装（推荐，插件市场标准方式）

```sh
# 从 npm 安装到 web profile（会通过 pnpm 链接进 profile）
dsh plugin --profile web add @dabouben/dsh-daily-tasks

# 重启 DSH，然后刷新浏览器
# 重启方式：kill 旧进程后重新 dsh web，或直接重启你使用的启动器
```

### 方式二：本地源码安装（开发用）

```sh
npm install
npm run build

# 在 ~/.dsh/profiles/web/package.json 的 dependencies 与 dsh.profile.bundles 中加入本包，
# 并把包链接进 profile 的 node_modules，然后重启 DSH
```

> 插件在 DSH 启动时扫描加载，安装后**必须重启**才生效。

---

## 🚀 使用

1. **每天第一次打开** DSH → 自动弹出任务填写窗 → 添加今日/本周任务 → 关闭
2. **查看任务** → 对话输入栏上方的滚动条（今日蓝色、本周紫色）
3. **完成任务** → 点击滚动条里的任务 → 大卡片 → 点右侧大圆圈
4. **随时添加** → 滚动条右侧「＋」
5. **周日总结** → 重置日当天打开自动弹出上周总结（AI 文字 + 数据）
6. **用量监控** → 左侧栏底部「⚡ API 用量」→ 点击弹出余额卡片与明细

---

## ⚙️ 配置

`cordis.patch.yml`（安装后可通过 profile patch 或 `settings.yaml` 覆盖）：

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `dataPath` | `daily-tasks.json` | 任务数据文件（相对 `$DSH_HOME`） |
| `apiKeyRef` | `DEEPSEEK_API_KEY` | 查询余额用的凭证引用 |
| `balanceCacheMs` | `60000` | 余额缓存 |
| `usageCacheMs` | `30000` | 用量聚合缓存 |
| `sessionsRoot` | `''` | 会话日志目录（空 = `$DSH_HOME/sessions`） |
| `prices` | `{}` | 模型价目表覆盖（CNY/百万 tokens） |
| `priceSchedule` | `[]` | 峰谷价目表覆盖 |

---

## 💾 数据模型

任务数据保存在 `$DSH_HOME/daily-tasks.json`：

```jsonc
{
  "settings": { "weeklyResetDay": 0, "scrollSpeed": 1, "popupEnabled": true, "marqueeEnabled": true, "postponeEnabled": true, "soundEnabled": false },
  "daily":  { "2026-08-16": [ { "id": "…", "scope": "daily", "title": "…", "note": "", "category": "work", "done": false, "createdAt": 0 } ] },
  "weekly": { "2026-08-16": [ /* 同上，scope: weekly */ ] },
  "history": [ /* 归档条目，供周总结聚合 */ ],
  "pendingCarry": [ /* 昨日未完成、等待延期选择的候选 */ ],
  "lastPopupDate": "2026-08-16",
  "lastSummaryWeek": "2026-08-09",
  "summaryCache": { "weekKey": "2026-08-09", "text": "…", "at": 0 }
}
```

---

## 🏗️ 架构

```
浏览器端（React bundle）                宿主端（Node）
┌────────────────────────────┐       ┌──────────────────────────────┐
│ conversation.input.dock 插槽│  HTTP  │ /dsh-daily-tasks/* 路由      │
│  任务横屏滚动条 + 弹窗/卡片  │◄─────►│  任务存储（JSON 原子落盘）    │
│ sidebar.footer.action 插槽  │  fetch │  每日/每周滚动 + 延期逻辑     │
│  API 用量小部件             │       │  LLM 周总结（ctx.llm）        │
└────────────────────────────┘       │  用量聚合（会话日志 zstd）     │
                                     │  余额查询（credentials + API） │
                                     └──────────────────────────────┘
```

- **宿主端**（`src/index.ts` / `src/store.ts` / `src/usage.ts`）：HTTP 路由、任务存储、周总结、用量/余额
- **客户端**（`src/client/`）：React 组件，通过官方插槽机制挂载，相对路径 fetch
- **构建**：`tsc` → `lib/`；`esbuild` → `lib/client.js`（`window.__ModuleLoader__.load` 官方 bundle 格式）

---

## 💻 跨平台

**Windows 与 macOS 均可运行**：浏览器端为纯标准 Web API；宿主端全部使用跨平台 Node API（`path` / `resolveDshHome` / `node:zlib` 的 zstd，官方 Node ≥ 22.18 双平台内置）。数据与凭证路径自动跟随系统。唯一差异：一键重启脚本 `restart-dsh.sh` 为 bash（macOS/Linux），Windows 直接按平时方式重启 DSH 即可。

---

## 📋 开发

```sh
npm install
npm run build      # tsc 宿主端 + esbuild 客户端 bundle
npm run typecheck  # 宿主端类型检查
node scripts/smoke.mjs   # 存储逻辑冒烟测试
node scripts/itest.mjs   # HTTP 路由集成测试
```

---

## 🙏 致谢

- 用量聚合与余额查询的实现思路改编自 [dsh-usage-dashboard-plus](https://github.com/1HelloMan1/dsh-usage-dashboard-plus) / [dsh-usage-dashboard](https://github.com/1690834643/dsh-usage-dashboard)（MIT），详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

## 📄 License

[MIT](LICENSE)
