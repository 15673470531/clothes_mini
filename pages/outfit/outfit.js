/**
 * 穿搭（tab 1）：我的搭配
 *
 * 顶部按「场合」分类（全部 + 通勤/休闲/运动/正式/居家），点哪个只看那个场合的搭配；
 * 没填场合的搭配只在「全部」里出现。
 *
 * 列表是 2 列缩略图网格（复用 app.wxss 的 .wall 系列，跟衣橱页同规格）：
 * 每格显示这套搭配的「穿搭图片」（预览页点完成时生成的方图）；
 * 还没生成图片或封面加载失败时，以现有衣物组成小拼图，
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
const { shoot } = require('../../utils/outfit-photo.js')

Page({
  data: {
    loggedIn: false,
    syncing: false,
    syncError: false,
    // 场合筛选：第一个是「全部」（key 为空串）
    occChips: [{ key: '', name: '全部' }].concat(mock.OCCASIONS.map(v => ({ key: v, name: v }))),
    occKey: '',
    total: 0,
    hasClothes: false,
    outfits: [],     // 当前筛选后要渲染的
    emptyText: '',
    emptyReal: false,   // 真的一套搭配都没有（不是"这个场合下没有"）—— 只有这时才放插画
    emptyPic: assets.fallback('empty.outfit.v2')        // 空态插画（后端下发；拿不到就只显示文字）
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setSelected(1)
    }
    this.refresh()
    this.syncPage()
  },

  // 同步期间保留缓存；首次无数据时不误报为空衣橱/空搭配。
  syncPage() {
    if (!this.checkLogin()) return
    if (this._syncing) return
    this._syncing = true
    this.setData({ syncing: true, syncError: false })
    return cloud.ready().then((r) => {
      if (!this.checkLogin()) return
      this.refresh()
      this.setData({ syncing: false, syncError: !!(r && r.error) })
    }).catch(() => {
      if (!this.checkLogin()) return
      this.setData({ syncing: false, syncError: true })
    }).then(() => { this._syncing = false })
  },

  onRetrySync() { this.syncPage() },

  checkLogin() {
    const loggedIn = api.isLoggedIn()
    if (!loggedIn) {
      this.setData({ loggedIn: false, outfits: [], total: 0, hasClothes: false, syncing: false, syncError: false, emptyReal: true })
      return false
    }
    this.setData({ loggedIn: true })
    return true
  },

  onGoLogin() { wx.switchTab({ url: '/pages/mine/mine' }) },

  onHide() {
    // 原生图片预览也会触发 onHide；保持真实登录状态。
    this.checkLogin()
  },

  onListImageError(e) {
    const { id, src } = e.currentTarget.dataset
    // 按 ID 和地址定位，避免切换筛选后旧图片的失败事件改到另一张卡。
    const index = this.data.outfits.findIndex(o => o.id === id && o.photo === src)
    if (index < 0) return
    this.setData({ ['outfits[' + index + '].photo']: '' })
  },

  onTileImageError(e) {
    const { id, itemId, src } = e.currentTarget.dataset
    const index = this.data.outfits.findIndex(o => o.id === id)
    if (index < 0) return
    const tile = this.data.outfits[index].tiles.findIndex(i => i.id === itemId && i.image === src)
    if (tile < 0) return
    this.setData({ ['outfits[' + index + '].tiles[' + tile + '].image']: '' })
  },

  /** 读搭配 → 组装缩略格子 → 按当前场合筛选 */
  refresh() {
    const loggedIn = this.checkLogin()
    const all = (loggedIn ? store.outfitCards() : []).map(c => {
      // 封面缺失时按已保存的衣物顺序显示拼图，最多九件。
      const tiles = (c.items || []).slice(0, 9)
      // 右下角小圆点：封面存哪了（口径同衣橱，只给颜色不写字）；没有远程封面就不挂
      const cb = cloud.coverBadge(c)
      return Object.assign({}, c, {
        tiles,
        tileColumns: tiles.length <= 1 ? 1 : (tiles.length <= 4 ? 2 : 3),
        // 缺失提示保留在右上角，正常件数放在标题下面。
        badge: c.missing > 0 ? '缺 ' + c.missing + ' 件' : '',
        meta: ((c.occasions || []).length ? c.occasions.join(' / ') + ' · ' : '') + c.count + ' 件',
        badgeWarn: c.missing > 0,
        coverBadgeKind: cb ? cb.kind : ''
      })
    })
    const key = this.data.occKey
    const outfits = all.filter(o => !key || (o.occasions || []).indexOf(key) >= 0)

    this.setData({
      outfits,
      total: all.length,
      hasClothes: loggedIn && store.getItems().length > 0,
      emptyText: key ? '这个场合下还没有搭配' : '还没有搭配，点右下角新建一套',
      emptyReal: all.length === 0
    })

    // 空态插画（后端下发，换图不用发版）；拉不到就只有文字
    assets.ensure().then(() => {
      this.setData({ emptyPic: assets.pick('empty.outfit.v2') })
    })
  },

  /** 远端插画加载失败 → 换包内本地图 */
  onEmptyPicErr() {
    const local = assets.fallback('empty.outfit.v2')
    if (local && local !== this.data.emptyPic) this.setData({ emptyPic: local })
  },

  onEmptyAction() {
    if (!this.checkLogin()) { this.onGoLogin(); return }
    if (!this.data.hasClothes) {
      wx.switchTab({ url: '/pages/wardrobe/wardrobe' })
      return
    }
    this.onAdd()
  },

  onViewAll() {
    this.setData({ occKey: '' }, () => this.refresh())
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
  onAdd() { this.checkQuotaThen(() => this.goNewOutfit()) },

  checkQuotaThen(proceed) {
    if (!this.checkLogin()) { this.onGoLogin(); return Promise.resolve() }
    return api.user.quota().catch(() => null).then((q) => {
      if (!this.checkLogin()) { this.onGoLogin(); return }
      const h = hanger.ofQuota(q)
      if (!h || !h.full) return proceed()

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
    })
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
  async onOpenOutfit(e) {
    if (!this.checkLogin()) { this.onGoLogin(); return }
    if (Date.now() - (this._longPressAt || 0) < 600 || this._previewBusy) return
    const id = e.currentTarget.dataset.id
    const cards = this.data.outfits.slice()
    if (!cards.some(c => c.id === id)) return
    this._previewBusy = true
    wx.showLoading({ title: '正在准备预览', mask: true })
    try {
      const images = []
      // 共用一个隐藏画布，缺封面的搭配逐张生成，避免并发绘制互相覆盖。
      for (const card of cards) {
        if (this._unloaded) return
        let path = card.photo || ''
        if (!path && (card.items || []).length) {
          path = await new Promise(resolve => {
            shoot(this, { items: card.items, slots: card.slots, kind: 'album', destPath: '' }, resolve)
          })
        }
        if (path) images.push({ id: card.id, path })
      }
      if (this._unloaded) return
      if (!this.checkLogin()) return
      const current = images.find(image => image.id === id)
      if (!current) {
        wx.showToast({ title: '这套暂无可预览图片，请编辑搭配后保存', icon: 'none' })
        return
      }
      wx.hideLoading()
      wx.previewImage({
        current: current.path,
        urls: images.map(image => image.path),
        fail: () => wx.showToast({ title: '预览打开失败，请重试', icon: 'none' })
      })
    } catch (err) {
      if (!this._unloaded) wx.showToast({ title: '预览生成失败，请重试', icon: 'none' })
    } finally {
      wx.hideLoading()
      this._previewBusy = false
    }
  },

  onUnload() { this._unloaded = true },

  noop() {},

  onMoreOutfit(e) {
    if (!this.checkLogin()) { this.onGoLogin(); return }
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name || '这套搭配'
    wx.showActionSheet({
      itemList: ['编辑搭配', '复制搭配', '删除搭配'],
      success: (r) => {
        if (!this.checkLogin()) { this.onGoLogin(); return }
        if (r.tapIndex === 0) wx.navigateTo({ url: '/pages/outfit-view/outfit-view?id=' + encodeURIComponent(id) })
        if (r.tapIndex === 1) this.onCopyOutfit(id)
        if (r.tapIndex === 2) this.confirmDeleteOutfit(id, name)
      }
    })
  },

  onCopyOutfit(id) {
    if (this._copying) return
    this._copying = true
    return this.checkQuotaThen(() => {
      const source = store.getOutfit(id)
      if (!source) {
        wx.showToast({ title: '这套搭配已经不在了', icon: 'none' })
        return
      }
      const available = new Set(store.getItems().map(i => i.id))
      const itemIds = (source.itemIds || []).filter(id => available.has(id))
      if (!itemIds.length) {
        wx.showToast({ title: '原搭配的衣物已删除，请新建搭配', icon: 'none' })
        return
      }
      // 只复制可编辑属性，不共享封面文件、远程地址或原搭配 ID。
      const draft = store.createDraft({
        name: (source.name || '未命名搭配').slice(0, 59) + ' 副本',
        nameAuto: false,
        occasions: (source.occasions || []).slice(),
        itemIds,
        slots: (source.slots || []).map(id => itemIds.indexOf(id) >= 0 ? id : '')
      })
      wx.navigateTo({
        url: '/pages/outfit-view/outfit-view?id=' + draft.id,
        fail: () => {
          store.deleteOutfit(draft.id)
          wx.showToast({ title: '打开失败，请重试', icon: 'none' })
        }
      })
    }).then(() => { this._copying = false }, () => { this._copying = false })
  },

  onLongPressOutfit(e) {
    this._longPressAt = Date.now()
    this.onMoreOutfit(e)
  },

  confirmDeleteOutfit(id, name) {
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
