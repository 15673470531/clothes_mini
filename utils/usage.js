/** 轻量行为观测：白名单字段、按账号隔离、批量重试；埋点失败不影响业务。 */
const KEY = 'usage_events_v1'
const PAGES = ['app', 'mine', 'wardrobe', 'item-edit']
let state = null
let timer = null
let sending = false
const id = () => Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12)
function save() { wx.setStorageSync(KEY, state) }
function ready() {
  const user = wx.getStorageSync('userInfo') || {}
  if (!wx.getStorageSync('token') || !user.userId || user.isAdmin) return false
  if (!state) state = wx.getStorageSync(KEY) || {}
  if (state.userId !== user.userId) state = { userId: user.userId, queue: [], last: 0 }
  state.queue = (state.queue || []).filter(e => e.occurred_at > Date.now() - 86400000)
  if (!state.session || Date.now() - state.last > 30 * 60 * 1000) {
    state.session = id(); state.sequence = 0; state.once = {}
    enqueue('session_start', 'app', {})
  }
  state.last = Date.now()
  return true
}
function enqueue(name, page, meta) {
  const event = { event_id: id(), session_id: state.session, name, page: PAGES.includes(page) ? page : 'app', sequence: ++state.sequence, occurred_at: Date.now() }
  if (['fab','empty','camera','album','single','batch','next'].includes(meta.source)) event.source = meta.source
  if (['photo','category','price','success','cancel','fail'].includes(meta.result)) event.result = meta.result
  if (/^[a-zA-Z0-9_-]{1,32}$/.test(String(meta.code || ''))) event.error_code = String(meta.code)
  if (Number.isFinite(meta.duration)) event.duration_ms = Math.max(0, Math.min(1800000, Math.round(meta.duration)))
  if (Number.isFinite(meta.count)) event.count = Math.max(0, Math.min(100, Math.round(meta.count)))
  state.queue.push(event)
  state.queue = state.queue.slice(-100)
}
function schedule() { if (!timer) timer = setTimeout(() => { timer = null; flush() }, 1000) }
function track(name, page, meta = {}) {
  try { if (!ready()) return; enqueue(name, page, meta); save(); schedule() } catch (e) {}
}
function once(name, page, meta = {}) {
  try {
    if (!ready()) return
    if (!state.once[name]) { state.once[name] = true; enqueue(name, page, meta) }
    save(); schedule()
  } catch (e) {}
}
function visit() { try { if (ready()) { save(); schedule() } } catch (e) {} }
function flush() {
  try {
    if (sending || !ready() || !state.queue.length) return
    const owner = state.userId
    const batch = state.queue.slice(0, 30)
    const ids = batch.map(e => e.event_id)
    sending = true
    wx.request({
      url: getApp().globalData.baseUrl + '/usage/events', method: 'POST',
      header: { 'content-type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + wx.getStorageSync('token') },
      data: { events: batch }, timeout: 5000,
      success: res => {
        try {
          if (!state || state.userId !== owner) return
          if ((res.statusCode >= 200 && res.statusCode < 300 && res.data && res.data.code === 0) || res.statusCode === 422) {
            state.queue = state.queue.filter(e => !ids.includes(e.event_id)); save()
            if (state.queue.length) schedule()
          }
        } catch (e) {}
      },
      complete: () => { sending = false }
    })
  } catch (e) { sending = false }
}
function code(err) { return err && /^\d+$/.test(String(err.code)) ? String(err.code) : 'network_or_unknown' }
module.exports = { track, once, visit, flush, code }
