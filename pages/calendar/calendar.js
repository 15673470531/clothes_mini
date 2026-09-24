/**
 * 穿搭日历（tab 2）：哪天穿了哪套
 *
 * 数据（utils/store.js 的 wear* 系列）：`clothes_wear = { 'YYYY-MM-DD': 搭配 id }`，**一天只记一套**。
 * 只存 id、不存快照 → 搭配改名/换封面日历跟着变；搭配被删了那天标成灰色点 + 列表里显示「已删除的搭配」。
 *
 * 页面分工（2026-09 用户定的最终版）：
 *  - 月历只放**日期 + 状态点**（7 列格子只有 93rpx，塞图也看不清，索性不塞）
 *  - **点哪天，下面就显示哪天的穿搭**（大图卡：300rpx 方图 + 名称 + 件数·场合 + 换一套/清除）
 *  - 卡片上的「选一套／换一套」→ 弹半屏弹层挑（一天一套）；「清除」清掉那天的记录
 *  - 未来日期也能记（提前安排）
 */

const store = require('../../utils/store.js')
const mock = require('../../utils/mock.js')
const cloud = require('../../utils/cloud.js')
const T = require('../../utils/texts.js')
const assets = require('../../utils/assets.js')

const WEEK = ['一', '二', '三', '四', '五', '六', '日']

/** 'YYYY-MM-DD'（补零，跟存储 key 一致） */
function fmt(y, m, d) {
  const mm = m < 10 ? '0' + m : '' + m
  const dd = d < 10 ? '0' + d : '' + d
  return y + '-' + mm + '-' + dd
}

Page({
  data: {
    week: WEEK,
    year: 2026,
    month: 9,
    cells: [],
    today: '',
    selDate: '',
    selText: '',
    selName: '',
    selDesc: '',
    selPhoto: '',
    selGone: false,
    sheet: false,
    pickList: [],
    emptyPic: ''        // 「选一套」弹层空态插画（后端下发；拿不到就只显示文字）
  },

  onLoad() {
    const now = new Date()
    const t = fmt(now.getFullYear(), now.getMonth() + 1, now.getDate())
    this.setData({ year: now.getFullYear(), month: now.getMonth() + 1, today: t, selDate: t })
  },

  onShow() {
    // 空态插画（后端下发，换图不用发版）。只用在「选一套」弹层的空态里；拉不到就只有文字
    assets.ensure().then(() => {
      this.setData({ emptyPic: assets.pick('empty.calendar') })
    })

    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setSelected(2)
    }
    this.refresh()
    cloud.ready().then((r) => { if (r && r.changed) this.refresh() })
  },

  /** 远端插画加载失败（域名没白名单/格式不认/断网）→ 换包内本地图，别留个空位 */
  onEmptyPicErr() {
    const local = assets.fallback('empty.calendar')
    if (local && local !== this.data.emptyPic) this.setData({ emptyPic: local })
  },

  /** 读搭配 + 日历记录 → 组装月历格子和本月列表 */
  refresh() {
    const cards = store.outfitCards()
    this._byId = {}
    cards.forEach(c => {
      const first = (c.items || [])[0] || null
      this._byId[c.id] = {
        id: c.id,
        name: c.name,
        photo: c.photo || '',
        desc: c.count + ' 件' + (c.occasions && c.occasions.length ? ' · ' + c.occasions.join('、') : ''),
        color: first ? first.color : mock.NEUTRAL_BLOCK,
        emoji: first ? first.emoji : '🧥',
        light: first ? !!first.light : false
      }
    })
    this._cards = cards

    const wear = store.wearMap()
    const { year, month } = this.data
    const days = new Date(year, month, 0).getDate()
    // 周一打头：把 JS 的 0(周日) 换算成 0(周一)
    const offset = (new Date(year, month - 1, 1).getDay() + 6) % 7

    const cells = []
    for (let i = 0; i < offset; i++) cells.push({ key: 'b' + i, blank: true })
    for (let d = 1; d <= days; d++) {
      const date = fmt(year, month, d)
      const oid = wear[date] || ''
      const card = oid ? this._byId[oid] : null
      cells.push({
        key: date,
        day: d,
        date,
        blank: false,
        wear: !!oid,                    // 这天记了
        photo: card ? card.photo : '',  // 那天的穿搭图（格子里日期下面显示）
        gone: !!oid && !card,           // 记过但搭配已删 → 虚线「已删」
        isToday: date === this.data.today,
        isSel: date === this.data.selDate
      })
    }
    while (cells.length % 7) cells.push({ key: 't' + cells.length, blank: true })

    this.setData({ cells }, () => this.applySel())
  },

  /** 当天卡片（选中那天穿了什么）+ 弹层候选列表（当前那套带勾） */
  applySel() {
    const date = this.data.selDate
    const oid = store.wearOf(date)
    const card = oid ? this._byId[oid] : null

    const pickList = (this._cards || []).map(c => {
      const first = (c.items || [])[0] || null
      return {
        id: c.id,
        name: c.name,
        photo: c.photo || '',
        color: first ? first.color : mock.NEUTRAL_BLOCK,
        emoji: first ? first.emoji : '🧥',
        light: first ? !!first.light : false,
        on: c.id === oid
      }
    })

    this.setData({
      selText: this.dateText(date),
      selName: oid ? (card ? card.name : '已删除的搭配') : '',
      selDesc: card ? card.desc : '',
      selPhoto: card ? card.photo : '',
      selGone: !!oid && !card,
      pickList
    })
  },

  /** '9月20日 · 今天 / 明天 / 昨天' */
  dateText(date) {
    const p = date.split('-')
    const y = Number(p[0]), m = Number(p[1]), d = Number(p[2])
    const t = new Date(this.data.today.replace(/-/g, '/'))
    const one = 24 * 3600 * 1000
    const diff = Math.round((new Date(y, m - 1, d).getTime() - t.getTime()) / one)
    const tail = diff === 0 ? ' · 今天' : (diff === 1 ? ' · 明天' : (diff === -1 ? ' · 昨天' : ''))
    return m + '月' + d + '日' + tail
  },

  onPrevMonth() {
    let { year, month } = this.data
    month--
    if (month < 1) { month = 12; year-- }
    this.setData({ year, month }, () => this.refresh())
  },

  onNextMonth() {
    let { year, month } = this.data
    month++
    if (month > 12) { month = 1; year++ }
    this.setData({ year, month }, () => this.refresh())
  },

  /** 点某天 → 选中它，下面就是那天的穿搭（不弹层，要改再点卡片上的按钮） */
  onTapDay(e) {
    const date = e.currentTarget.dataset.date
    if (!date) return
    this.setData({ selDate: date }, () => this.refresh())
  },

  onOpenSheet() {
    this.setData({ sheet: true })
  },

  onCloseSheet() {
    this.setData({ sheet: false })
  },

  /** 选一套 → 记到这天（一天一套，覆盖原来的） */
  onPick(e) {
    const id = e.currentTarget.dataset.id
    const date = this.data.selDate
    if (!id || !date) return
    const card = this._byId[id]
    // 乐观更新：界面立刻显示；接口失败会把缓存拉回云端真相 + 弹提示
    cloud.commit(
      () => { store.setWear(date, id); this.setData({ sheet: false }, () => this.refresh()) },
      () => cloud.setWear(date, id)
    ).then(() => {
      wx.showToast({ title: T.t('calendar.marked', { name: card ? '「' + card.name + '」' : '' }), icon: 'none' })
    }).catch((err) => {
      this.refresh()
      wx.showModal({ title: T.t('calendar.mark_fail_title'), content: (err && err.msg) || T.t('common.retry_later'), showCancel: false })
    })
  },

  /** 清除这天的记录（没记录时只关弹层） */
  onClearDay() {
    const date = this.data.selDate
    if (!store.wearOf(date)) {
      this.setData({ sheet: false })
      return
    }
    wx.showModal({
      title: T.t('calendar.clear_title'),
      content: T.t('calendar.clear_content'),
      confirmText: T.t('calendar.clear_ok'),
      success: (r) => {
        if (!r.confirm) return
        cloud.commit(
          () => { store.clearWear(date); this.setData({ sheet: false }, () => this.refresh()) },
          () => cloud.setWear(date, '')
        ).then(() => {
          wx.showToast({ title: T.t('calendar.cleared'), icon: 'none' })
        }).catch((err) => {
          this.refresh()
          wx.showModal({ title: T.t('calendar.clear_fail_title'), content: (err && err.msg) || T.t('common.retry_later'), showCancel: false })
        })
      }
    })
  }
})
