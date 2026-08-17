/**
 * 插件样式注入。DSH 亮/暗主题通过 body[data-ds-dark-theme] 区分。
 */
const CSS = `
.dt-marquee {
  position: relative;
  display: flex;
  align-items: center;
  height: 34px;
  margin: 0 4px;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 8px;
  background: rgba(128, 128, 128, 0.06);
  overflow: hidden;
  user-select: none;
}
.dt-marquee-viewport {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  height: 100%;
}
.dt-marquee-set {
  display: inline-flex;
  align-items: center;
  flex: none;
  /* 任务之间的间隔（约 9 个数字宽度），组尾同宽，保证循环接缝间距一致 */
  --dt-set-gap: 36px;
  column-gap: var(--dt-set-gap);
  padding-right: var(--dt-set-gap);
}
.dt-marquee-track {
  display: inline-flex;
  align-items: center;
  flex: none;
  white-space: nowrap;
  --dt-set-w: 0px;
  animation: dt-marquee-scroll linear infinite;
  will-change: transform;
}
.dt-marquee:hover .dt-marquee-track,
.dt-marquee.paused .dt-marquee-track {
  animation-play-state: paused;
}
@keyframes dt-marquee-scroll {
  from { transform: translateX(0); }
  to { transform: translateX(calc(-1 * var(--dt-set-w))); }
}
.dt-marquee-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 14px;
  font-size: 13px;
  line-height: 20px;
  color: var(--dt-text, #333);
  cursor: pointer;
  border-radius: 6px;
}
.dt-marquee-item:hover { background: rgba(128, 128, 128, 0.12); }
.dt-marquee-item .dt-dot {
  width: 7px; height: 7px; border-radius: 50%; flex: none;
}
.dt-marquee-item.dt-scope-daily .dt-dot { background: #2f81f7; }
.dt-marquee-item.dt-scope-weekly .dt-dot { background: #9b59b6; }
.dt-marquee-item .dt-badge {
  flex: none; font-size: 11px; line-height: 16px; padding: 0 5px;
  border-radius: 4px; color: #fff;
}
.dt-marquee-item.dt-scope-daily .dt-badge { background: #2f81f7; }
.dt-marquee-item.dt-scope-weekly .dt-badge { background: #9b59b6; }
.dt-marquee-item .dt-cat { flex: none; font-size: 11px; color: rgba(128,128,128,0.9); }
.dt-marquee-item.dt-done { opacity: 0.55; }
.dt-marquee-item.dt-done .dt-title { text-decoration: line-through; }
.dt-marquee-empty {
  flex: 1; text-align: center; font-size: 12px; color: rgba(128,128,128,0.8);
  padding: 0 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dt-marquee-gear {
  position: absolute; right: 2px; top: 50%; transform: translateY(-50%);
  width: 26px; height: 26px; border: none; border-radius: 6px;
  background: rgba(128,128,128,0.12); color: var(--dt-text, #333);
  font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center;
}
.dt-marquee-gear:hover { background: rgba(128,128,128,0.25); }
.dt-marquee-add {
  position: absolute; right: 30px; top: 50%; transform: translateY(-50%);
  width: 26px; height: 26px; border: none; border-radius: 6px;
  background: rgba(47,129,247,0.18); color: #2f81f7;
  font-size: 16px; font-weight: 700; cursor: pointer;
  display: flex; align-items: center; justify-content: center; line-height: 1;
}
.dt-marquee-add:hover { background: rgba(47,129,247,0.32); }

.dt-modal-mask {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0, 0, 0, 0.45);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
}
.dt-modal {
  width: min(520px, 94vw); max-height: 86vh; overflow: auto;
  background: var(--dt-bg, #fff); color: var(--dt-text, #222);
  border-radius: 12px; border: 1px solid rgba(128,128,128,0.3);
  box-shadow: 0 12px 40px rgba(0,0,0,0.25);
}
.dt-modal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid rgba(128,128,128,0.2);
  font-weight: 600; font-size: 15px; position: sticky; top: 0;
  background: var(--dt-bg, #fff);
}
.dt-modal-x {
  border: none; background: transparent; color: inherit; cursor: pointer;
  font-size: 16px; width: 28px; height: 28px; border-radius: 6px;
}
.dt-modal-x:hover { background: rgba(128,128,128,0.15); }
.dt-modal-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }

.dt-section-title { font-size: 12px; color: rgba(128,128,128,0.9); margin: 2px 0; }
.dt-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; border-radius: 8px;
}
.dt-row:hover { background: rgba(128,128,128,0.08); }
.dt-circle {
  flex: none; width: 20px; height: 20px; border-radius: 50%;
  border: 2px solid rgba(128,128,128,0.55); background: transparent;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  color: transparent; font-size: 12px; transition: all 0.15s;
  padding: 0;
}
.dt-circle.dt-checked {
  background: #2ea043; border-color: #2ea043; color: #fff;
}
.dt-circle.dt-big {
  width: 34px; height: 34px; border-width: 3px; font-size: 18px;
}
.dt-task-title { flex: 1; font-size: 14px; cursor: pointer; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.dt-task-title.dt-done { text-decoration: line-through; opacity: 0.6; }
.dt-tag {
  flex: none; font-size: 11px; padding: 1px 6px; border-radius: 4px;
  background: rgba(128,128,128,0.15); color: var(--dt-text, #333);
}
.dt-add-row { display: flex; gap: 6px; }
.dt-add-row input[type="text"] {
  flex: 1; min-width: 0; padding: 7px 10px; border-radius: 8px;
  border: 1px solid rgba(128,128,128,0.4); background: var(--dt-input-bg, #fff);
  color: var(--dt-text, #222); font-size: 13px; outline: none;
}
.dt-add-row input:focus { border-color: #2f81f7; }
.dt-select {
  padding: 6px 8px; border-radius: 8px; border: 1px solid rgba(128,128,128,0.4);
  background: var(--dt-input-bg, #fff); color: var(--dt-text, #222); font-size: 13px;
}
.dt-btn {
  border: 1px solid rgba(128,128,128,0.4); background: transparent; color: inherit;
  padding: 7px 14px; border-radius: 8px; cursor: pointer; font-size: 13px;
}
.dt-btn:hover { background: rgba(128,128,128,0.12); }
.dt-btn-primary { background: #2f81f7; border-color: #2f81f7; color: #fff; }
.dt-btn-primary:hover { background: #1f6fe0; }
.dt-btn-danger { color: #d1242f; border-color: rgba(209,36,47,0.5); }
.dt-btn-danger:hover { background: rgba(209,36,47,0.1); }
.dt-btn:disabled { opacity: 0.5; cursor: default; }
.dt-tabs { display: flex; gap: 6px; }
.dt-tab {
  border: 1px solid transparent; background: transparent; color: inherit;
  padding: 5px 14px; border-radius: 8px; cursor: pointer; font-size: 13px;
}
.dt-tab[aria-current="true"] { background: rgba(47,129,247,0.15); border-color: rgba(47,129,247,0.4); color: #2f81f7; }

.dt-stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.dt-stat {
  border: 1px solid rgba(128,128,128,0.25); border-radius: 10px;
  padding: 10px 8px; text-align: center;
}
.dt-stat .dt-num { font-size: 20px; font-weight: 700; }
.dt-stat .dt-label { font-size: 11px; color: rgba(128,128,128,0.9); margin-top: 2px; }
.dt-summary-text {
  border: 1px solid rgba(128,128,128,0.25); border-radius: 10px; padding: 12px;
  font-size: 13px; line-height: 1.7; white-space: pre-wrap;
  background: rgba(128,128,128,0.05);
}
.dt-spinner {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid rgba(128,128,128,0.3); border-top-color: #2f81f7;
  animation: dt-spin 0.8s linear infinite; display: inline-block;
}
@keyframes dt-spin { to { transform: rotate(360deg); } }
.dt-error { color: #d1242f; font-size: 12px; }
.dt-hint { font-size: 12px; color: rgba(128,128,128,0.85); line-height: 1.6; }
.dt-setting-row {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 6px 0;
}
.dt-setting-row .dt-label { font-size: 13px; }
.dt-switch {
  position: relative; width: 40px; height: 22px; flex: none;
  border-radius: 11px; border: 1px solid rgba(128,128,128,0.4);
  background: rgba(128,128,128,0.2); cursor: pointer; transition: background 0.15s;
  padding: 0;
}
.dt-switch::after {
  content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: #fff; transition: left 0.15s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
}
.dt-switch.dt-on { background: #2ea043; border-color: #2ea043; }
.dt-switch.dt-on::after { left: 20px; }
.dt-range { flex: 1; }
.dt-modal-foot {
  display: flex; justify-content: flex-end; gap: 8px; padding-top: 6px;
  border-top: 1px solid rgba(128,128,128,0.15); margin-top: 4px;
}
.dt-carry-list { display: flex; flex-direction: column; gap: 4px; }
.dt-big-card-note { font-size: 13px; line-height: 1.6; color: rgba(128,128,128,0.9); }

/* ---------- 侧边栏 API 用量小部件 ---------- */
.dt-usage {
  display: flex; flex-direction: column; gap: 4px;
  padding: 8px 10px; margin: 4px 6px 6px;
  border: 1px solid rgba(128,128,128,0.22); border-radius: 10px;
  background: rgba(128,128,128,0.06);
  font-size: 12px;
}
.dt-usage-head {
  display: flex; align-items: center; gap: 6px; width: 100%;
  border: none; background: transparent; color: inherit; cursor: pointer;
  padding: 2px 0; font-size: 12px; font-weight: 600; text-align: left;
}
.dt-usage-head:hover { opacity: 0.85; }
.dt-usage-icon { font-size: 12px; }
.dt-usage-title { flex: 1; }
.dt-usage-balance { color: #2ea043; font-weight: 700; }
.dt-usage-compact { display: flex; flex-direction: column; gap: 3px; }
.dt-usage-row {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  color: var(--dt-text, #333); line-height: 18px;
}
.dt-usage-row > span:first-child { color: rgba(128,128,128,0.85); flex: none; }
.dt-usage-row > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dt-usage-model { font-size: 11px; }

/* 余额卡片 */
.dt-balance-card {
  border: 1px solid rgba(47,129,247,0.35); border-radius: 12px;
  padding: 14px 16px; background: rgba(47,129,247,0.06);
  display: flex; flex-direction: column; gap: 4px;
}
.dt-balance-title { font-size: 12px; color: rgba(128,128,128,0.9); }
.dt-balance-total { font-size: 30px; font-weight: 800; line-height: 1.2; }
.dt-balance-status { font-size: 12px; }
.dt-balance-status.dt-ok { color: #2ea043; }
.dt-balance-status.dt-bad { color: #d1242f; }
.dt-balance-row { display: flex; gap: 24px; margin-top: 8px; }
.dt-num-sm { font-size: 16px; font-weight: 700; }
.dt-label { font-size: 11px; color: rgba(128,128,128,0.85); }

/* 迷你柱状图 */
.dt-bars { display: flex; align-items: flex-end; gap: 6px; height: 74px; padding: 4px 2px 0; }
.dt-bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 0; }
.dt-bar {
  width: 70%; max-width: 26px; border-radius: 3px 3px 0 0;
  background: linear-gradient(180deg, #2f81f7, #5aa2ff);
  min-height: 3px;
}
.dt-bar-label { font-size: 9px; color: rgba(128,128,128,0.8); white-space: nowrap; }

body[data-ds-dark-theme] .dt-marquee {
  background: rgba(255,255,255,0.05);
}
body[data-ds-dark-theme] .dt-modal {
  background: #1f2226; color: #e8eaed; border-color: rgba(255,255,255,0.12);
}
body[data-ds-dark-theme] .dt-modal-head { background: #1f2226; }
body[data-ds-dark-theme] .dt-add-row input,
body[data-ds-dark-theme] .dt-select { background: #2a2d33; color: #e8eaed; }
body[data-ds-dark-theme] .dt-marquee-item { color: #e8eaed; }
body[data-ds-dark-theme] .dt-marquee-gear { color: #e8eaed; }
`

let injected = false

export function injectStyles(): void {
  if (injected) return
  injected = true
  const style = document.createElement('style')
  style.id = 'dsh-daily-tasks-style'
  style.textContent = CSS
  document.head.appendChild(style)
}
