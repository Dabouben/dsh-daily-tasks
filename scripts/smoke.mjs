/**
 * 宿主端逻辑冒烟测试（node 直接跑，不依赖 DSH）：
 *   - 模块可加载、name/apply/Config 齐全
 *   - 每日滚动：昨天任务 → 完成归档 / 未完成进 pendingCarry
 *   - 延期：勾选 → 并入今天；未勾选 → 归档（carriedOver 标记）
 *   - 每周滚动：旧周期每周任务归档
 *   - 周总结聚合：完成/未完成/顺延/完成率
 *   - 设置保存
 */
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TaskStore } from '../lib/store.js'
import { isoDate, weekKeyOfDate } from '../lib/week.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = await mkdtemp(path.join(here, '.smoke-'))
const dataPath = path.join(dir, 'daily-tasks.json')
const store = new TaskStore(dataPath)

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}`) }
}

// 1. 模块与默认状态
const mod = await import('../lib/index.js')
check('host module exports name', mod.name === 'dsh-daily-tasks')
check('host module exports apply', typeof mod.apply === 'function')
check('host module exports Config', mod.Config != null)

// 2. 添加任务
const t1 = await store.addTask({ scope: 'daily', title: '写周报', category: 'work' })
const t2 = await store.addTask({ scope: 'daily', title: '跑步 5km', category: 'life' })
const w1 = await store.addTask({ scope: 'weekly', title: '读完一本书', category: 'study' })
check('addTask daily', t1.scope === 'daily' && t1.title === '写周报')
check('addTask weekly', w1.scope === 'weekly')

// 3. 完成一个任务
await store.updateTask({ id: t1.id, scope: 'daily', patch: { done: true } })
let snap = await store.snapshot()
check('snapshot daily has 2', snap.daily.length === 2)
check('snapshot weekly has 1', snap.weekly.length === 1)
check('done reflected', snap.daily.find(t => t.id === t1.id)?.done === true)

// 4. 模拟“昨天”：把今天两条任务挪到昨天日期下（用新实例重新读盘）
const yesterday = new Date(Date.now() - 86400_000)
const yKey = isoDate(yesterday)
const today = snap.today
const fs = await import('node:fs/promises')
const raw = JSON.parse(await fs.readFile(dataPath, 'utf8'))
raw.daily[yKey] = raw.daily[today] || []
delete raw.daily[today]
await fs.writeFile(dataPath, JSON.stringify(raw))
const store2 = new TaskStore(dataPath)

// 5. 新的一天读状态 → 滚动
snap = await store2.snapshot()
const archivedWeek = weekKeyOfDate(yKey, 0) // 昨日任务归档进它所在周的键
check('pendingCarry 出现昨日未完成(t2)', snap.pendingCarry.some(c => c.id === t2.id))
check('昨日已完成归档(history)', (await store2.summaryStats(archivedWeek)).items.some(h => h.title === '写周报' && h.done))
check('今日 daily 为空', snap.daily.length === 0)
check('popup 应弹（有 pendingCarry）', snap.popup.shouldShow === true)

// 6. 弹窗关闭：勾选 t2 延期，其余归档
await store2.closePopup({ carryIds: [t2.id] })
snap = await store2.snapshot()
check('延期后今日包含 t2', snap.daily.some(t => t.id === t2.id))
check('pendingCarry 已清空', snap.pendingCarry.length === 0)
check('popup 不再弹（今日已看过）', snap.popup.shouldShow === false)
const stats = await store2.summaryStats(archivedWeek)
check('历史含顺延记录', stats.items.some(h => h.title === '跑步 5km' && h.carriedOver === true))
check('顺延统计=1 且未完成=0', stats.carried === 1 && stats.undone === 0)

// 7. 每周滚动：伪造一个旧周期键
const fs2 = await import('node:fs/promises')
const raw2 = JSON.parse(await fs2.readFile(dataPath, 'utf8'))
const oldWeek = '2000-01-02'
raw2.weekly[oldWeek] = [{ id: 'old-w', scope: 'weekly', title: '旧周任务', note: '', category: 'other', done: false, createdAt: 1 }]
await fs2.writeFile(dataPath, JSON.stringify(raw2))
const store3 = new TaskStore(dataPath)
await store3.load()
await store3.snapshot()
const stats2 = await store3.summaryStats(oldWeek)
check('旧周每周任务已归档', stats2.items.some(h => h.title === '旧周任务'))
const snap2 = await store3.snapshot()
check('旧周期键已清理', !(snap2.weekly.some(t => t.id === 'old-w')))

// 8. 设置
const s = await store3.saveSettings({ scrollSpeed: 1.5, popupEnabled: false })
check('settings 保存', s.scrollSpeed === 1.5 && s.popupEnabled === false)

// 9. 删除
const del = await store3.addTask({ scope: 'daily', title: '临时任务' })
await store3.deleteTask({ id: del.id, scope: 'daily' })
const snap3 = await store3.snapshot()
check('删除生效', !snap3.daily.some(t => t.id === del.id))

// 10. 周总结缓存
await store2.saveSummaryCache('2000-01-02', '上周总结文本')
check('summaryCache 命中', store2.summaryCacheFor('2000-01-02') === '上周总结文本')
check('summaryCache 不同周不命中', store2.summaryCacheFor('2000-01-09') === null)

// 11. ackSummary
await store2.ackSummary()
const snap4 = await store2.snapshot()
check('ack 后今日不再是重置日也可读', snap4.today.length === 10)

await rm(dir, { recursive: true, force: true })
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
