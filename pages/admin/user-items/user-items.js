/**
 * 某个用户录的衣物（管理端，只读）
 *
 * 从「我的 → 数据统计 → 用户名单」里点某人的「N 件衣物」进来。
 * 只读：看的是别人的数据，不做编辑/删除；点一下放大看照片（管理员核对照片是不是真的传上去了）。
 * 版式：2 列大图（图片优先、图要大），跟衣橱那套格子同一套配色/圆角/角标口径，
 * 管理员看到的照片存哪，跟用户自己看到的小圆点含义一致（灰待上传 / 绿 OSS / 黄 本地盘）。
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
    list: [],        // 图片墙格子（已经算好颜色块/图标/角标）
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

  /**
   * 拉这一页衣物
   * @param {boolean} reset true = 第一页（下拉刷新 / 首次进页面）
   */
  load(reset) {
    if (this.data.loading && !reset) return Promise.resolve()
    const page = reset ? 1 : this.data.page + 1
    this.setData({ loading: true, error: '' })

    return api.admin.userItems(this.userId, { page, per_page: PER_PAGE })
      .then((d) => {
        const rows = this.build((d && d.list) || [])
        const total = (d && d.total) || 0
        const user = (d && d.user) || null
        this.setData({
          user,
          total,
          headSub: '共 ' + total + ' 件衣物',
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

  /** 接口数据 → 图片墙格子（没照片时用品类图标 + 颜色块，跟衣橱页的兜底一致） */
  build(rows) {
    return rows.map((i) => {
      const catName = mock.categoryOf(i.category).name
      const block = mock.blockOf(i.colors)          // 没选颜色给中性灰块，不显示成黑
      const badge = cloud.storageBadge(i.imageStorage, i.imageUrl)
      return {
        id: i.id,
        image: i.imageUrl || '',
        badgeKind: badge ? badge.kind : '',
        // 一行小字：名称 → 二级类目 → 一级品类，三级兜底，保证格子下面不空着
        text: i.name || mock.subName(i.category, i.sub) || catName,
        emoji: mock.categoryOf(i.category).emoji,
        color: block.hex,
        light: block.light,
        date: i.createdAt || ''
      }
    })
  },

  /** 点格子 → 放大看照片（只带这一页里有图的，左右可以翻） */
  onPreview(e) {
    const photos = this.data.list.filter((x) => x.image).map((x) => x.image)
    if (!photos.length) {
      wx.showToast({ title: T.t('admin.no_photo'), icon: 'none' })
      return
    }
    const cur = this.data.list[e.currentTarget.dataset.idx]
    wx.previewImage({
      current: (cur && cur.image) || photos[0],
      urls: photos
    })
  }
})
