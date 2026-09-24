/**
 * 某个用户建的搭配（管理端，只读）
 *
 * 从「我的 → 数据统计 → 用户名单」里点某人的「N 套搭配」进来。
 * 只读，点一下放大看这套的封面图。
 * 卡片口径跟用户的「穿搭」页一致：右上角件数角标（有衣物被删显示「缺N」）、
 * 没生成封面就用这套里第一件衣物顶着，不留空白格子。
 */
const api = require('../../../utils/api.js')
const mock = require('../../../utils/mock.js')
const cloud = require('../../../utils/cloud.js')
const T = require('../../../utils/texts.js')

const PER_PAGE = 30

Page({
  data: {
    user: null,
    total: 0,
    headSub: '',
    list: [],
    loading: true,
    error: '',
    page: 1,
    lastPage: 1
  },

  onLoad(options) {
    this.userId = (options && options.user_id) || ''
    if (!this.userId) {
      this.setData({ loading: false, error: '缺少用户参数' })
      return
    }
    this.load(true)
  },

  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.page < this.data.lastPage) this.load(false)
  },

  /** 拉这一页搭配（reset=true 表示第一页） */
  load(reset) {
    if (this.data.loading && !reset) return Promise.resolve()
    const page = reset ? 1 : this.data.page + 1
    this.setData({ loading: true, error: '' })

    return api.admin.userOutfits(this.userId, { page, per_page: PER_PAGE })
      .then((d) => {
        const rows = this.build((d && d.list) || [])
        const total = (d && d.total) || 0
        const user = (d && d.user) || null
        this.setData({
          user,
          total,
          headSub: '共 ' + total + ' 套搭配',
          list: reset ? rows : this.data.list.concat(rows),
          page: (d && d.currentPage) || page,
          lastPage: (d && d.lastPage) || 1,
          loading: false
        })
      })
      .catch((err) => {
        this.setData({ loading: false, error: (err && err.msg) || '加载失败' })
      })
  },

  /** 接口数据 → 卡片：封面优先，没有就用第一件衣物顶（有照片用照片、没有用色块 + 图标） */
  build(rows) {
    return rows.map((o) => {
      const thumb = o.thumb || null
      const block = thumb ? mock.blockOf(thumb.colors) : { hex: mock.NEUTRAL_BLOCK, light: false }
      const badge = cloud.storageBadge(o.coverStorage, o.coverUrl)
      return {
        id: o.id,
        // 封面：有正式封面用封面，否则用第一件衣物那张图
        image: o.coverUrl || (thumb && thumb.imageUrl) || '',
        color: block.hex,
        light: block.light,
        emoji: thumb ? mock.categoryOf(thumb.category).emoji : '🧥',
        // 右上角角标：正常是件数，有衣物被删时显示「缺N」（WXML 里不做字符串拼接，这里算好）
        badge: o.missing > 0 ? '缺' + o.missing : String(o.count),
        badgeWarn: o.missing > 0,
        badgeKind: badge ? badge.kind : '',
        // 名称留空时（自动命名的老数据）显示件数，别留一行空白
        name: o.name || '未命名搭配',
        date: o.createdAt || ''
      }
    })
  },

  /** 点卡片 → 放大看封面（只带这一页里有图的） */
  onPreview(e) {
    const photos = this.data.list.filter((x) => x.image).map((x) => x.image)
    if (!photos.length) {
      wx.showToast({ title: T.t('admin.no_cover'), icon: 'none' })
      return
    }
    const cur = this.data.list[e.currentTarget.dataset.idx]
    wx.previewImage({
      current: (cur && cur.image) || photos[0],
      urls: photos
    })
  }
})
