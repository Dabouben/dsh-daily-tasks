/**
 * 宿主端端到端集成测试：用假 cordis ctx 跑 apply()，验证全部 HTTP 路由。
 * 不需要真实 DSH，覆盖：状态读取、任务增删改、延期、设置、周总结数据、
 * AI 总结生成（假 LLM）、ack。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
import { apply } from '../lib/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = await mkdtemp(path.join(here, '.itest-'))
const dataPath = path.join(dir, 'daily-tasks.json')

let handler = null
const llmCalls = []
const fakeCtx = {
  inject(_services, cb) { cb(fakeCtx) },
  logger: { warn: (...a) => console.warn(...a) },
  webServer: { register(route) { handler = route; return () => {} } },
  llm: {
    async *stream(options) {
      llmCalls.push(options)
      yield { type: 'text-delta', text: '上周你完成了不少任务' }
      yield { type: 'text-delta', text: '，继续保持！' }
    },
  },
  agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) },
  get(name) {
    if (name === 'llm') return this.llm
    if (name === 'agentDefaultModel') return this.agentDefaultModel
    return undefined
  },
}

apply(fakeCtx, { dataPath })

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}`) }
}

async function call(method, pathname, body) {
  const req = new PassThrough()
  req.method = method
  req.url = pathname
  if (body !== undefined) req.write(JSON.stringify(body))
  req.end()
  const res = new EventEmitter()
  res.writeHead = (status) => { res.status = status }
  res.end = (text) => { res.body = JSON.parse(text); res.emit('done') }
  const done = new Promise(r => res.on('done', r))
  await handler.handler(req, res)
  await done
  return res
}

check('路由已注册（prefix /dsh-daily-tasks）', handler && handler.kind === 'prefix' && handler.path === '/dsh-daily-tasks')

// 1. 初始状态
let r = await call('GET', '/dsh-daily-tasks/state')
check('state 200', r.status === 200)
check('state 默认设置', r.body.state.settings.popupEnabled === true && r.body.state.settings.weeklyResetDay === 0)
check('state 空任务', r.body.state.daily.length === 0 && r.body.state.weekly.length === 0)

// 2. 添加任务
r = await call('POST', '/dsh-daily-tasks/tasks', { scope: 'daily', title: '  写周报  ', category: 'work' })
check('addTask 200 且去空格', r.status === 200 && r.body.task.title === '写周报')
const d1 = r.body.task.id
r = await call('POST', '/dsh-daily-tasks/tasks', { scope: 'weekly', title: '读完一本书', category: 'study' })
const w1 = r.body.task.id
check('addTask weekly', r.status === 200 && r.body.task.scope === 'weekly')

// 3. 空标题被拒
r = await call('POST', '/dsh-daily-tasks/tasks', { scope: 'daily', title: '   ' })
check('空标题 500（含错误信息）', r.status === 500 && r.body.error)

// 4. 状态包含任务
r = await call('GET', '/dsh-daily-tasks/state')
check('state 含 1 每日 1 每周', r.body.state.daily.length === 1 && r.body.state.weekly.length === 1)

// 5. 完成
r = await call('PATCH', '/dsh-daily-tasks/tasks', { id: d1, scope: 'daily', patch: { done: true } })
check('patch done', r.status === 200 && r.body.task.done === true)

// 6. 删除
r = await call('POST', '/dsh-daily-tasks/tasks', { scope: 'weekly', title: '临时任务' })
const tmp = r.body.task.id
r = await call('DELETE', '/dsh-daily-tasks/tasks', { id: tmp, scope: 'weekly' })
check('delete 200', r.status === 200 && r.body.ok === true)

// 7. 弹窗关闭（无候选）
r = await call('POST', '/dsh-daily-tasks/popup/close', { carryIds: [] })
check('closePopup 200', r.status === 200 && r.body.ok === true)
r = await call('GET', '/dsh-daily-tasks/state')
check('closePopup 后不再弹窗', r.body.state.popup.shouldShow === false)

// 8. 设置
r = await call('POST', '/dsh-daily-tasks/settings', { scrollSpeed: 2, soundEnabled: true })
check('settings 保存', r.status === 200 && r.body.settings.scrollSpeed === 2 && r.body.settings.soundEnabled === true)
r = await call('GET', '/dsh-daily-tasks/settings')
check('settings 读取', r.body.settings.marqueeEnabled === true)

// 9. 周总结数据（本周可能没有归档，返回空统计即可）
const st = await call('GET', '/dsh-daily-tasks/state')
const weekKey = st.body.state.currentWeekKey
r = await call('GET', `/dsh-daily-tasks/summary/data?weekKey=${weekKey}`)
check('summary/data 200', r.status === 200 && typeof r.body.stats.rate === 'number')

// 10. AI 总结生成（假 LLM）
r = await call('POST', '/dsh-daily-tasks/summary/generate', { weekKey })
check('summary/generate 返回文本', r.status === 200 && r.body.text.includes('上周'))
check('LLM 收到默认模型', llmCalls.length === 1 && llmCalls[0].provider === 'deepseek' && llmCalls[0].model === 'deepseek-chat')
check('LLM 收到中文提示', llmCalls[0].messages[0].content[0].text.includes('周总结'))
// 缓存命中
r = await call('POST', '/dsh-daily-tasks/summary/generate', { weekKey })
check('第二次生成命中缓存', r.body.cached === true)

// 11. ack
r = await call('POST', '/dsh-daily-tasks/summary/ack')
check('ack 200', r.status === 200 && r.body.ok === true)

// 12. 用量统计
r = await call('GET', '/dsh-daily-tasks/usage/stats')
check('usage/stats 200', r.status === 200 && r.body.ok === true)
check('usage 结构完整', typeof r.body.usage.today.cost === 'number'
  && Array.isArray(r.body.usage.week) && typeof r.body.usage.cumulative.cost === 'number'
  && Array.isArray(r.body.usage.cumulative.byModel))

// 13. 余额（无 credentials → 返回友好错误，不发网络请求）
r = await call('GET', '/dsh-daily-tasks/usage/balance')
check('usage/balance 200（错误路径）', r.status === 200 && r.body.balance.error && r.body.balance.available === false)

// 14. 404
r = await call('GET', '/dsh-daily-tasks/nope')
check('未知路由 404', r.status === 404)

// 13. 非法 JSON
const badReq = new PassThrough()
badReq.method = 'POST'
badReq.url = '/dsh-daily-tasks/tasks'
badReq.write('{invalid')
badReq.end()
const badRes = new EventEmitter()
badRes.writeHead = (status) => { badRes.status = status }
badRes.end = (text) => { badRes.body = JSON.parse(text); badRes.emit('done') }
const badDone = new Promise(r2 => badRes.on('done', r2))
await handler.handler(badReq, badRes)
await badDone
check('非法 JSON 500', badRes.status === 500)

await rm(dir, { recursive: true, force: true })
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
