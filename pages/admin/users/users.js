/**
 * 用户名单（2026-09，仅管理员）
 *
 * 两个入口：
 *  - 统计页点「新增用户」的今日/本周/本月 → 带 date_from（按注册时间筛）
 *  - 统计页点「活跃用户」的日活/周活/月活 → 带 active_from（按最近活跃筛，口径同卡片：不含管理员）
 * 也可以从别处直接进来当「用户列表」用（搜索、管理员筛选、排序都在这一页）。
 *
 * 每行带这个人的数据量（衣物/搭配/打卡天数）和衣架两个数（可用 / 总数）：
 * 看得出谁在用、谁是注册完就没动的空号，也能看出谁的衣架快用完了（要不要给他加）。
 */
const api = require('../../../utils/api.js')
const T = require('../../../utils/texts.js')

const PER_PAGE = 20

Page({
  data: {
    list: [],
    loading: false,
    total: 0,
    page: 1,
    lastPage: 1,
    keyword: '',
    keywordInput: '',
    adminFilter: '',        // '' 全部 / '1' 管理员 / '0' 普通用户
    sortBy: 'last_active_at',
    sortOrder: 'desc',
    hint: ''                // 从统计页带过来的筛选说明（显示在顶部，可一键清除）
  },

  onLoad(options) {
    const o = options || {}
    this.dateFrom = o.date_from || ''
    this.activeFrom = o.active_from || ''
    this.setData({
      hint: o.hint ? decodeURIComponent(o.hint) : '',
      sortBy: o.sort || 'last_active_at'
    })
    this.load(true)
  },

  onReachBottom() {
    if (this.data.page < this.data.lastPage) this.load(false)
  },

  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh())
  },

  /** 组装查询参数（空值不发，后端按需筛） */
  params(page) {
    return {
      page,
      per_page: PER_PAGE,
      keyword: this.data.keyword,
      is_admin: this.data.adminFilter,
      date_from: this.dateFrom,
      active_from: this.activeFrom,
      sort_by: this.data.sortBy,
      sort_order: this.data.sortOrder
    }
  },

  load(reset) {
    if (this.data.loading) return Promise.resolve()
    const page = reset ? 1 : this.data.page + 1
    this.setData({ loading: true })

    return api.admin.users(this.params(page))
      .then((d) => {
        const rows = (d && d.list) || []
        this.setData({
          list: reset ? rows : this.data.list.concat(rows),
          total: (d && d.total) || 0,
          page: (d && d.currentPage) || page,
          lastPage: (d && d.lastPage) || 1,
          loading: false
        })
      })
      .catch((err) => {
        this.setData({ loading: false })
        if (!reset) wx.showToast({ title: (err && err.msg) || T.t('admin.load_fail'), icon: 'none' })
        else this.setData({ list: [], total: 0, lastPage: 1 })
      })
  },

  onKeywordInput(e) {
    this.setData({ keywordInput: e.detail.value })
  },

  doSearch() {
    this.setData({ keyword: this.data.keywordInput }, () => this.load(true))
  },

  /** 管理员 / 普通用户筛选 */
  setAdminFilter(e) {
    const v = e.currentTarget.dataset.v
    if (v === this.data.adminFilter) return
    this.setData({ adminFilter: v }, () => this.load(true))
  },

  /** 排序：点同一项切换升降序 */
  setSort(e) {
    const v = e.currentTarget.dataset.v
    const order = (v === this.data.sortBy && this.data.sortOrder === 'desc') ? 'asc' : 'desc'
    this.setData({ sortBy: v, sortOrder: order }, () => this.load(true))
  },

  /** 清掉统计页带过来的筛选（清完就是全部用户） */
  clearHint() {
    this.dateFrom = ''
    this.activeFrom = ''
    this.setData({ hint: '' }, () => this.load(true))
  },

  /**
   * 点「N 件衣物」→ TA 的衣物明细（只读）
   * 只带 user_id：这个人是谁由明细页自己去后端拿（避免名字在两个页面各传一份、改了对不上）
   */
  openItems(e) {
    wx.navigateTo({ url: '/pages/admin/user-items/user-items?user_id=' + e.currentTarget.dataset.id })
  },

  /** 点「N 套搭配」→ TA 的搭配明细（只读） */
  openOutfits(e) {
    wx.navigateTo({ url: '/pages/admin/user-outfits/user-outfits?user_id=' + e.currentTarget.dataset.id })
  }
})
