/**
 * 穿搭（tab 1）：我的搭配
 *
 * 顶部按「场合」分类（全部 + 通勤/休闲/运动/正式/居家），点哪个只看那个场合的搭配；
 * 没填场合的搭配只在「全部」里出现。
 *
 * 列表是 3 列缩略图网格（复用 app.wxss 的 .wall 系列，跟衣橱页同规格）：
 * 每格显示这套搭配的「穿搭图片」（预览页点完成时生成的方图）；
 * 还没生成图片的（老数据 / 出图失败）先用这套里第一件衣物的缩略块顶着，
 * 进一次预览页点「完成」就会变成正式图片。
 * 角标显示件数，有衣物被删时显示警示色「缺N」；点格子进预览页，**长按删除**。
 */

const store = require('../../utils/store.js')
const mock = require('../../utils/mock.js')
const cloud = require('../../utils/cloud.js')
const api = require('../../utils/api.js')
const T = require('../../utils/texts.js')
const assets = require('../../utils/assets.js')
const hanger = require('../../utils/hanger.js')

Page({
  data: {
    // 场合筛选：第一个是「全部」（key 为空串）
    occChips: [{ key: '', name: '全部' }].concat(mock.OCCASIONS.map(v => ({ key: v, name: v }))),
    occKey: '',
    outfits: [],     // 当前筛选后要渲染的
    emptyText: '',
    emptyReal: false,   // 真的一套搭配都没有（不是"这个场合下没有"）—— 只有这时才放插画
    emptyPic: ''        // 空态插画（后端下发；拿不到就只显示文字）
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setSelected(1)
    }
    this.refresh()
    cloud.ready().then((r) => { if (r && r.changed) this.refresh() })
  },

  /** 读搭配 → 组装缩略格子 → 按当前场合筛选 */
  refresh() {
    const all = store.outfitCards().map(c => {
      // 没生成图片时用第一件衣物顶着（有照片用照片，没有用色块 + 品类图标）
      const first = (c.items || [])[0] || null
      // 右下角小圆点：封面存哪了（口径同衣橱，只给颜色不写字）；没有远程封面就不挂
      const cb = cloud.coverBadge(c)
      return Object.assign({}, c, {
        thumb: first
          ? { image: first.image, color: first.color, emoji: first.emoji, light: first.light }
          : { image: '', color: mock.NEUTRAL_BLOCK, emoji: '🧥', light: false },
        // 角标：正常是件数，有衣物被删时显示「缺N」（WXML 里不做字符串拼接，这里算好）
        badge: c.missing > 0 ? '缺' + c.missing : String(c.count),
        badgeWarn: c.missing > 0,
        coverBadgeKind: cb ? cb.kind : ''
      })
    })
    const key = this.data.occKey
    const outfits = all.filter(o => !key || (o.occasions || []).indexOf(key) >= 0)

    this.setData({
      outfits,
      emptyText: key ? '这个场合下还没有搭配' : '还没有搭配，点右下角新建一套',
      emptyReal: all.length === 0
    })

    // 空态插画（后端下发，换图不用发版）；拉不到就只有文字
    assets.ensure().then(() => {
      this.setData({ emptyPic: assets.pick('empty.outfit') })
    })
  },

  /** 远端插画加载失败 → 换包内本地图 */
  onEmptyPicErr() {
    const local = assets.fallback('empty.outfit')
    if (local && local !== this.data.emptyPic) this.setData({ emptyPic: local })
  },

  onOcc(e) {
    this.setData({ occKey: e.currentTarget.dataset.key }, () => this.refresh())
  },

  /**
   * 新建搭配：**先看一眼衣架够不够**（2026-09 用户要求：衣架没了就在这个入口拦下）
   *
   * 一套新搭配也占 1 个衣架（跟新增衣物共用一个架子）——不够就别让人白挑一遍，
   * 挑完点完成才被后端拦下最气人。查不到额度（网络问题）就放行：真拦人的是后端
   * （ClothesController::push 的 4001/4002），这里只是提前告知 + 给出路。
   */
  onAdd() {
    api.user.quota().then((q) => {
      const h = hanger.ofQuota(q)
      if (!h || !h.full) return this.goNewOutfit()

      // 是"今天挂满了"还是"衣架用完了"决定标题（口径跟衣橱页那个预检一模一样）
      const daily = (q.hangerDaily != null) ? q.hangerDaily : (q.dailyQuota || 0)
      const isDaily = daily <= 0

      wx.showModal({
        title: T.t(isDaily ? 'wardrobe.quota_daily_title' : 'wardrobe.quota_total_title'),
        content: isDaily
          ? T.t('wardrobe.quota_daily_fallback') + '\n' + T.t('wardrobe.quota_daily_tail')
          : T.t('wardrobe.quota_total_fallback'),
        confirmText: T.t('common.service_ok'),
        cancelText: T.t('common.know'),
        success: (r) => { if (r.confirm) this.goService() }
      })
    }).catch(() => this.goNewOutfit())
  },

  goNewOutfit() {
    wx.navigateTo({ url: '/pages/outfit-edit/outfit-edit' })
  },

  goService() {
    wx.navigateTo({ url: '/pages/service/service' })
  },

  /**
   * 点格子 → 搭配预览页（改名字、改场合、生成图片都在那页）
   * 长按触发后会紧接着来一次 tap，用时间戳挡掉，别删完又跳页
   */
  onOpenOutfit(e) {
    if (Date.now() - (this._longPressAt || 0) < 600) return
    wx.navigateTo({ url: '/pages/outfit-view/outfit-view?id=' + e.currentTarget.dataset.id })
  },

  onLongPressOutfit(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name || '这套搭配'
    this._longPressAt = Date.now()

    wx.showModal({
      title: T.t('outfit.delete_title', { name: name }),
      content: T.t('outfit.delete_content'),
      confirmText: T.t('outfit.delete_ok'),
      success: (r) => {
        if (!r.confirm) return
        // 乐观更新：先从缓存删、界面立刻变；失败就拉回云端还原 + 提示
        cloud.commit(
          () => { store.deleteOutfit(id); this.refresh() },   // 顺手把本机那张封面图也删掉
          () => cloud.removeOutfit(id)
        ).then(() => {
          wx.showToast({ title: T.t('outfit.deleted'), icon: 'none' })
        }).catch((err) => {
          this.refresh()
          wx.showModal({ title: T.t('outfit.delete_fail_title'), content: (err && err.msg) || T.t('common.retry_later'), showCancel: false })
        })
      }
    })
  }
})
