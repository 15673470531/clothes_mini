/**
 * 衣橱（tab 0）
 *
 * 页首为紧凑分类区，数量以辅助文字显示在图片墙上方。
 * 筛选分两级：一级品类（横向胶囊）→ 二级类目（选中具体品类后才出现，一行均分）；
 * 列表是图片墙：有照片显示照片，没有用「颜色块 + 品类图标」，格子下留一行小字。
 */

const usage = require('../../utils/usage.js')
const store = require('../../utils/store.js')
const mock = require('../../utils/mock.js')
const cloud = require('../../utils/cloud.js')
const photo = require('../../utils/photo.js')
const api = require('../../utils/api.js')
const T = require('../../utils/texts.js')
const assets = require('../../utils/assets.js')

Page({
  data: {
    loggedIn: false,
    syncing: false,
    syncError: false,
    total: 0,
    pendingCount: 0,
    cats: mock.CATEGORIES,
    catKey: 'all',
    subs: [],        // 二级类目条：[{ key:'', name:'全部' }, ...细分]；选「全部」品类时为空数组 → 不显示
    subKey: '',
    list: [],
    emptyText: '',
    washNote: '',        // 「N 件白底图正在生成」那行（没有生成中的就是空串 → 不显示）
    emptyReal: false,     // 真的空衣橱（不是"这个分类下没有"）—— 只有这种情况才放插画和宣传语
    emptyPic: assets.fallback('empty.wardrobe'), // 新版包内插画，首屏即可显示
    emptySlogan: ''       // 空态那句宣传语（文案表下发）
  },

  onShow() {
    // 同步底部导航高亮（custom tab bar 必须每个 tab 页自己设）
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setSelected(0)
    }
    // 2026-09 口径：MySQL 是真相，本机只是渲染缓存
    // 先用缓存把画面立刻刷出来（不白屏）→ 再拉云端，真有变化才重画一遍
    // ready() 里还会把没上云的照片补传，传成功了要重画一次（把「待上传」角标去掉）
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
      if (!(r && r.error) && this.data.total === 0) usage.once('wardrobe_empty', 'wardrobe')
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
      this.setData({ loggedIn: false, list: [], total: 0, pendingCount: 0, subs: [], syncing: false, syncError: false, emptyReal: true })
      return false
    }
    this.setData({ loggedIn: true })
    return true
  },

  onGoLogin() {
    wx.switchTab({ url: '/pages/mine/mine' })
  },

  onHide() {
    // 原生图片预览也会触发 onHide；页面隐藏不代表退出登录。
    this.checkLogin()
    // 离开页面就别再盯白底图了（回来时 refresh() 会自己再算一次）
    if (this._washTimer) {
      clearTimeout(this._washTimer)
      this._washTimer = null
    }
  },

  onListImageError(e) {
    const index = e.currentTarget.dataset.index
    const updates = {}
    updates['list[' + index + '].image'] = ''
    this.setData(updates)
  },

  /**
   * 读取本地数据 → 组装二级筛选条 + 图片墙格子
   * 注意：subKey 会在这里被纠正（切了品类之后原来的二级可能不存在了）
   */
  refresh() {
    const loggedIn = this.checkLogin()
    const all = loggedIn ? store.getItems() : []
    const cat = this.data.catKey

    // 二级条：只在选中具体一级品类时出现（「全部」品类没有二级）
    const subs = cat === 'all'
      ? []
      : [{ key: '', name: '全部' }].concat(mock.subsOf(cat).map(s => ({ key: s.key, name: s.name })))

    const want = this.data.subKey
    const subKey = subs.some(s => s.key === want) ? want : ''

    const list = all
      .filter(i => (cat === 'all' || i.category === cat) && (!subKey || i.sub === subKey))
      .map(i => {
        const catName = mock.categoryOf(i.category).name
        // 没选颜色时用中性灰块，而不是被当成「黑」
        const b = mock.blockOf(i.colors)
        // 右下角小圆点（2026-09）：照片存哪了，只给个颜色，不写字
        // 口径集中在 cloud.photoBadge（wait 灰 / local 黄 / OSS 成功不显示），别在这重写
        const badge = cloud.photoBadge(i)
        return {
          id: i.id,
          image: i.image || i.imageUrl || '',
          badgeKind: badge ? badge.kind : '',
          // 一行小字：名称 → 二级类目 → 一级品类，三级兜底，保证格子下面不空着
          text: i.name || mock.subName(i.category, i.sub) || catName,
          emoji: mock.categoryOf(i.category).emoji,
          color: b.hex,
          light: b.light
        }
      })

    // 白底图生成中（2026-09 方案 6：格子不标、列表顶一行提示）
    //  ① 排队中 / 正在洗（后端 pull 带下来的 normalizeStatus）算
    //  ② **刚加的**（10 分钟内）也算：照片是后台上传的，后端要等照片上了 OSS 才真正入队，
    //     本机状态那一刻还是空的 —— 不认这一条，用户刚保存完返回衣橱就看不到这行提示
    //     （用户实测反馈："点了添加衣物，顶部没有文字"）
    const now = Date.now()
    const washing = all.filter(i => {
      const st = String(i.normalizeStatus || '')
      if (st === 'queued' || st === 'running') return true
      if (st === 'failed' || st === 'done') return false
      if (i.normalizedUrl) return false                       // 已经有白底图 → 不会再洗
      if (i.normalizeAuto === false) return false             // 这件关掉了自动洗
      if (!(i.image || i.imageUrl)) return false              // 没照片，洗不了
      return now - (i.createdAt || 0) < 10 * 60 * 1000         // 只认刚加的，老数据不瞎猜
    }).length

    this.setData({
      total: all.length,
      pendingCount: loggedIn ? store.pendingPhotoCount() : 0,
      subs,
      subKey,
      list,
      emptyText: all.length === 0
        ? '衣橱还是空的，点右下角「＋」记一件'
        : '还没有' + (subKey ? mock.subName(cat, subKey) : mock.categoryOf(cat).name),
      emptyReal: all.length === 0,
      // 白底图生成中的件数（2026-09 自动洗白底）→ 列表顶上一行总提示；格子不再放圆点（用户选方案 6）
      washNote: washing > 0 ? T.t('wardrobe.normalize_pending', { n: washing }) : ''
    })

    // 还在生成 → 隔几秒补拉一次，洗完用户能直接看到换成白底图（只在有活干的时候跑，不是常驻轮询）
    this.pollWash(washing)

    // 空态采用新版包内插画，避免服务器旧图覆盖；宣传语仍取文案表
    // 拉不到就只有文字，页面照常显示（绝不出现破图）
    assets.ensure().then(() => {
      this.setData({
        emptyPic: assets.fallback('empty.wardrobe'),
        emptySlogan: T.t('slogan.wardrobe_empty')
      })
    })
  },

  /** 远端插画加载失败（域名没白名单/格式不认/断网）→ 换包内本地图，别留个空位 */
  onEmptyPicErr() {
    const local = assets.fallback('empty.wardrobe')
    if (local && local !== this.data.emptyPic) this.setData({ emptyPic: local })
  },

  /**
   * 白底图还在生成时：每隔 7 秒补拉一次数据（洗完那件就会自动换成白底图）
   *
   * 为什么不常驻轮询：只有"确实在生成"时才跑，且最多 12 轮（约 1.5 分钟），
   * 洗完（件数归零）自己就停了 —— 省电、也省流量。
   * 一张白底图 10~20 秒，所以通常两三轮就能看到结果。
   */
  pollWash(pending) {
    if (this._washTimer) return          // 已经排着了，别排第二次

    if (!pending) {
      this._washRounds = 0
      return
    }

    this._washRounds = (this._washRounds || 0) + 1
    if (this._washRounds > 12) return     // 兜底：洗太久就不盯了，下次进页面自然会看到

    this._washTimer = setTimeout(() => {
      this._washTimer = null
      cloud.ready().then(() => this.refresh()).catch(() => {})
    }, 7000)
  },

  onContinuePending() {
    if (!this.checkLogin()) { this.onGoLogin(); return }
    if (!store.pendingPhotoCount()) { this.refresh(); return }
    wx.navigateTo({ url: '/pages/item-edit/item-edit' })
  },

  onViewAll() {
    this.setData({ catKey: 'all', subKey: '' }, () => this.refresh())
  },

  onCat(e) {
    this.setData({ catKey: e.currentTarget.dataset.key, subKey: '' }, () => this.refresh())
  },

  onSub(e) {
    this.setData({ subKey: e.currentTarget.dataset.key }, () => this.refresh())
  },

  /**
   * 「＋」录入：先选照片来源（拍照 1 张 / 相册可多选，最多 5 张），拿到照片再进录入页填其他信息
   *
   * 2026-09 加多选：相册一次能选 5 张，选完逐张压好落盘、进「待录入队列」，
   * 录入页一张张填（点保存自动翻下一张）。
   * 上次没录完的队列还留在本机 —— 这里先问一句「继续 / 丢掉」，别默默把人家选的照片扔了。
   */
  onAdd(e) {
    if (!this.checkLogin()) { this.onGoLogin(); return }
    usage.track('add_click', 'wardrobe', { source: e && e.currentTarget.dataset.source || 'fab' })
    const left = store.pendingPhotoCount()
    if (left > 0) {
      wx.showModal({
        title: T.t('wardrobe.pending_title', { n: left }),
        content: T.t('wardrobe.pending_content'),
        confirmText: T.t('wardrobe.pending_ok'),
        cancelText: T.t('wardrobe.pending_cancel'),
        success: (r) => {
          if (r.confirm) {
            wx.navigateTo({ url: '/pages/item-edit/item-edit' })
          } else if (r.cancel) {
            store.dropPendingPhotos()     // 丢掉：连同本机文件一起清
            this.pickSource()
          }
        }
      })
      return
    }
    this.checkQuotaThenPick()
  },

  /**
   * 录之前先看一眼衣架够不够（2026-09 第三版：额度＝衣架）
   *
   * 为什么要提前查：满了才让选照片 = 白选白填一遍，最后保存被后端拦下，很气人。
   * 但真正拦人的还是后端（ClothesController::push），这里只是提前告知。
   * 查不到额度（网络问题）就直接放行——本地能用，后端也会兜住。
   */
  checkQuotaThenPick() {
    api.user.quota().then((q) => {
      if (!q) return this.pickSource()

      // 衣架口径优先，旧后端只有 itemQuota/dailyQuota 时兜一下
      const total = (q.hangerTotal != null) ? q.hangerTotal : (q.itemQuota || 0)   // 一共还剩几个衣架
      const daily = (q.hangerDaily != null) ? q.hangerDaily : (q.dailyQuota || 0)   // 今天还能挂几个
      const left = Math.min(total, daily)   // 两个都要够（一个衣架挂一件衣物）

      if (left <= 0) {
        usage.track('quota_block', 'wardrobe', { code: daily <= 0 ? '4002' : '4001' })
        const isDaily = daily <= 0

        wx.showModal({
          title: T.t(isDaily ? 'wardrobe.quota_daily_title' : 'wardrobe.quota_total_title'),
          // 用完不只是告知，也要给出路（2026-09）：想继续挂就联系客服
          // 每日上限的数字不再报（2026-09 用户定：界面不显示每日数量），只说"用完了、明天恢复"
          content: isDaily
            ? T.t('wardrobe.quota_daily_fallback') + '\n' + T.t('wardrobe.quota_daily_tail')
            : T.t('wardrobe.quota_total_fallback'),
          confirmText: T.t('common.service_ok'),
          cancelText: T.t('common.know'),
          success: (r) => { if (r.confirm) this.goService() }
        })
        return
      }

      if (left < 9) {
        // 还剩几个衣架就最多选几张（相册多选一次最多 9 张）
        wx.showModal({
          title: T.t('wardrobe.left_title', { n: left }),
          content: T.t('wardrobe.left_content', { n: left }),
          showCancel: false,
          confirmText: T.t('common.ok'),
          success: () => this.pickSource(left)
        })
        return
      }
      this.pickSource()
    }).catch(() => this.pickSource())
  },

  /**
   * 额度用完了给个出路：去「联系客服」页（那页有「进入客服会话」按钮）
   * 文案里的「联系客服」就落在这里，别让人看完提示不知道下一步点哪
   */
  goService() {
    wx.navigateTo({ url: '/pages/service/service' })
  },

  /** 选照片来源（多选只对相册有意义：拍照一次只能一张） */
  pickSource(max) {
    const cap = max || 9
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择（最多 ' + cap + ' 张）'],
      success: (res) => {
        this.pickPhoto(res.tapIndex === 0 ? ['camera'] : ['album'], cap)
      },
      fail: err => usage.track(/cancel/i.test(err.errMsg || '') ? 'photo_cancel' : 'photo_fail', 'wardrobe')
    })
  },

  /**
   * 选照片 → 逐张压缩 + 落盘 → 塞进「待录入队列」→ 进录入页
   * （临时路径重启会失效，必须 saveFile；一批最多 9 张，每张都先过一道压缩再落盘，
   *   不然本机用户目录会被顶满）
   */
  pickPhoto(sourceType, max) {
    usage.track('photo_start', 'wardrobe', { source: sourceType[0] })
    const camera = sourceType[0] === 'camera'
    wx.chooseMedia({
      count: camera ? 1 : (max || 9),
      mediaType: ['image'],
      sourceType,
      sizeType: ['compressed'],
      success: (res) => {
        usage.track('photo_success', 'wardrobe', { source: sourceType[0], count: (res.tempFiles || []).length })
        const files = (res.tempFiles || []).map(f => f.tempFilePath).filter(Boolean)
        if (files.length) this.savePhotos(files)
      },
      // 用户取消选照片：什么都不做，留在衣橱页
      fail: err => usage.track(/cancel/i.test(err.errMsg || '') ? 'photo_cancel' : 'photo_fail', 'wardrobe', { source: sourceType[0], code: /cancel/i.test(err.errMsg || '') ? '' : usage.code(err) })
    })
  },

  /**
   * 逐张压缩 + 落盘（**串行**：一次压 5 张会让界面卡住）
   * 落盘失败的跳过并告知，别因为一张失败把整批丢掉；一张都没成功就提示后留在本页
   */
  savePhotos(files) {
    const done = []
    let failed = 0

    const next = (i) => {
      if (i >= files.length) return Promise.resolve()
      wx.showLoading({ title: T.t('wardrobe.preparing', { i: i + 1, n: files.length }), mask: true })
      return photo.compress(files[i]).then((src) => new Promise((resolve) => {
        wx.getFileSystemManager().saveFile({
          tempFilePath: src,
          success: (r) => { done.push(r.savedFilePath); resolve() },
          fail: () => { failed++; resolve() }
        })
      })).then(() => next(i + 1))
    }

    next(0).then(() => {
      wx.hideLoading()
      if (failed) usage.track('prepare_fail', 'wardrobe', { count: failed })
      if (!done.length) {
        wx.showToast({ title: T.t('wardrobe.photo_save_fail'), icon: 'none' })
        return
      }
      store.pushPendingPhotos(done)
      if (failed) wx.showToast({ title: T.t('wardrobe.some_failed', { n: failed }), icon: 'none' })
      wx.navigateTo({ url: '/pages/item-edit/item-edit' })
    })
  },

  /** 图片点击预览当前分类，缺少照片时直接编辑。 */
  onOpenItem(e) {
    if (!this.checkLogin()) { this.onGoLogin(); return }
    if (Date.now() - (this._longPressAt || 0) < 600) return
    const id = e.currentTarget.dataset.id
    const item = this.data.list.find(i => i.id === id)
    if (!item) return
    if (!item.image) return this.editItem(id)
    wx.previewImage({
      current: item.image,
      urls: this.data.list.filter(i => i.image).map(i => i.image),
      fail: () => wx.showToast({ title: '图片预览失败，请重试', icon: 'none' })
    })
  },

  editItem(id) {
    wx.navigateTo({ url: '/pages/item-edit/item-edit?id=' + encodeURIComponent(id) })
  },

  noop() {},

  onMoreItem(e) {
    if (!this.checkLogin()) { this.onGoLogin(); return }
    const id = e.currentTarget.dataset.id
    wx.showActionSheet({
      itemList: ['编辑衣物', '删除衣物'],
      success: r => {
        if (r.tapIndex === 0) this.editItem(id)
        if (r.tapIndex === 1) this.confirmDelete(id)
      }
    })
  },

  /** 长按打开相同菜单；删除继续保留引用检查及确认。 */
  onLongPressItem(e) {
    this._longPressAt = Date.now()
    this.onMoreItem(e)
  },

  /**
   * 删除前检查是否被搭配引用，避免静默产生悬挂引用
   */
  confirmDelete(id) {
    const used = store.outfitsUsingItem(id)
    // 乐观更新：先从缓存删、界面立刻变；接口失败就拉回云端还原 + 弹提示
    const doDelete = () => {
      cloud.commit(
        () => { store.deleteItem(id); this.refresh() },
        () => cloud.removeItem(id)
      ).then(() => {
        wx.showToast({ title: T.t('wardrobe.deleted'), icon: 'none' })
      }).catch((err) => {
        this.refresh()
        wx.showModal({
          title: T.t('wardrobe.delete_fail_title'),
          content: (err && err.msg) || T.t('common.retry_later'),
          showCancel: false
        })
      })
    }

    if (used.length === 0) {
      wx.showModal({
        title: T.t('wardrobe.delete_title'),
        content: T.t('wardrobe.delete_content'),
        confirmText: T.t('wardrobe.delete_ok'),
        success: (r) => { if (r.confirm) doDelete() }
      })
      return
    }

    const names = used.map(o => o.name || '未命名搭配').slice(0, 3).join('、')
    wx.showModal({
      title: T.t('wardrobe.in_outfit_title'),
      content: T.t('wardrobe.in_outfit_content', {
        names: names,
        more: used.length > 3 ? T.t('wardrobe.in_outfit_more', { n: used.length }) : ''
      }),
      confirmText: T.t('wardrobe.in_outfit_ok'),
      success: (r) => { if (r.confirm) doDelete() }
    })
  }
})
