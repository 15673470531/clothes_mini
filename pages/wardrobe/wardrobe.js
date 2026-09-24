/**
 * 衣橱（tab 0）
 *
 * 概览数字放在内容卡里（不做独立标题栏）。
 * 筛选分两级：一级品类（横向胶囊）→ 二级类目（选中具体品类后才出现，一行均分）；
 * 列表是图片墙：有照片显示照片，没有用「颜色块 + 品类图标」，格子下留一行小字。
 */

const store = require('../../utils/store.js')
const mock = require('../../utils/mock.js')
const cloud = require('../../utils/cloud.js')
const photo = require('../../utils/photo.js')
const api = require('../../utils/api.js')
const T = require('../../utils/texts.js')
const assets = require('../../utils/assets.js')

Page({
  data: {
    total: 0,
    cats: mock.CATEGORIES,
    catKey: 'all',
    subs: [],        // 二级类目条：[{ key:'', name:'全部' }, ...细分]；选「全部」品类时为空数组 → 不显示
    subKey: '',
    list: [],
    emptyText: '',
    emptyReal: false,     // 真的空衣橱（不是"这个分类下没有"）—— 只有这种情况才放插画和宣传语
    emptyPic: '',         // 空态插画（后端下发，见 utils/assets.js；拿不到就只显示文字）
    headerPic: '',        // 顶部「N 件衣物」那栏右侧的小插画（做小一点，别顶高卡片）
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
    cloud.ready().then((r) => {
      if (r && (r.changed || (r.upload && r.upload.uploaded))) this.refresh()
    })
  },

  /**
   * 读取本地数据 → 组装二级筛选条 + 图片墙格子
   * 注意：subKey 会在这里被纠正（切了品类之后原来的二级可能不存在了）
   */
  refresh() {
    const all = store.getItems()
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
        // 口径集中在 cloud.photoBadge（wait 灰 / oss 绿 / local 黄），别在这重写
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

    this.setData({
      total: all.length,
      subs,
      subKey,
      list,
      emptyText: all.length === 0
        ? '衣橱还是空的，点右下角「＋」记一件'
        : (subKey ? '这个细分下还没有衣物' : '这个分类下还没有衣物'),
      emptyReal: all.length === 0
    })

    // 空态插画 + 宣传语：图在后端（utils/assets.js，换图不用发版），文案在文案表
    // 拉不到就只有文字，页面照常显示（绝不出现破图）
    assets.ensure().then(() => {
      this.setData({
        emptyPic: assets.pick('empty.wardrobe'),
        headerPic: assets.pick('wardrobe.header'),
        emptySlogan: T.t('slogan.wardrobe_empty')
      })
    })
  },

  /** 顶部小插画加载失败（域名没白名单/格式不认/断网）→ 换包内本地图，拿不到就不显示这一块 */
  onHeaderPicErr() {
    const local = assets.fallback('wardrobe.header')
    if (local && local !== this.data.headerPic) this.setData({ headerPic: local })
    else this.setData({ headerPic: '' })
  },

  /** 远端插画加载失败（域名没白名单/格式不认/断网）→ 换包内本地图，别留个空位 */
  onEmptyPicErr() {
    const local = assets.fallback('empty.wardrobe')
    if (local && local !== this.data.emptyPic) this.setData({ emptyPic: local })
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
  onAdd() {
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
      }
    })
  },

  /**
   * 选照片 → 逐张压缩 + 落盘 → 塞进「待录入队列」→ 进录入页
   * （临时路径重启会失效，必须 saveFile；一批最多 9 张，每张都先过一道压缩再落盘，
   *   不然本机用户目录会被顶满）
   */
  pickPhoto(sourceType, max) {
    const camera = sourceType[0] === 'camera'
    wx.chooseMedia({
      count: camera ? 1 : (max || 9),
      mediaType: ['image'],
      sourceType,
      sizeType: ['compressed'],
      success: (res) => {
        const files = (res.tempFiles || []).map(f => f.tempFilePath).filter(Boolean)
        if (files.length) this.savePhotos(files)
      },
      // 用户取消选照片：什么都不做，留在衣橱页
      fail: () => {}
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
      if (!done.length) {
        wx.showToast({ title: T.t('wardrobe.photo_save_fail'), icon: 'none' })
        return
      }
      store.pushPendingPhotos(done)
      if (failed) wx.showToast({ title: T.t('wardrobe.some_failed', { n: failed }), icon: 'none' })
      wx.navigateTo({ url: '/pages/item-edit/item-edit' })
    })
  },

  /**
   * 点某个格子 → **直接进编辑页**（2026-09 用户要求：不再弹「编辑/删除」菜单）
   * 删除挪到两处：编辑页底部那行，以及列表长按（跟穿搭列表同一个手感）
   */
  onOpenItem(e) {
    if (Date.now() - (this._longPressAt || 0) < 600) return   // 长按结束后紧跟的 tap 挡掉，别删完又跳页
    wx.navigateTo({ url: '/pages/item-edit/item-edit?id=' + e.currentTarget.dataset.id })
  },

  /** 长按格子 → 删除（确认逻辑跟以前一样：被搭配用着会告诉你是哪几套） */
  onLongPressItem(e) {
    this._longPressAt = Date.now()
    this.confirmDelete(e.currentTarget.dataset.id)
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
