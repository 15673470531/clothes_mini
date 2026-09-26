/**
 * 数据统计（2026-09，仅管理员）
 *
 * 从「我的 → 数据统计」进来（这条菜单只有管理员渲染）。
 * 基础指标由后端 groups 驱动；行为观察独立加载，支持时间范围和访问时间线。
 * 统计口径在后端，页面仅渲染。
 */
const api = require('../../../utils/api.js')

Page({
  data: {
    groups: [],
    usage: null,
    usageDays: 7,
    usageLoading: false,
    usageError: '',
    expandedVisit: '',
    dayOptions: [1, 7, 30],
    loading: true,
    error: ''
  },

  onShow() {
    this.load()
    this.loadUsage()
  },

  /** 下拉刷新（统计数字要手查，给个手动刷新的入口） */
  onPullDownRefresh() {
    Promise.all([this.load(), this.loadUsage()]).then(() => wx.stopPullDownRefresh())
  },

  load() {
    this.setData({ loading: true, error: '' })
    return api.admin.stats()
      .then((d) => {
        this.setData({ groups: (d && d.groups) || [], loading: false })
      })
      .catch((err) => {
        // 401 时 api 层已清 token；403（非管理员）就把后端的话原样显示
        this.setData({ loading: false, error: (err && err.msg) || '加载失败' })
      })
  },

  loadUsage() {
    const days = this.data.usageDays
    const requestId = this._usageRequest = (this._usageRequest || 0) + 1
    this.setData({ usageLoading: true, usageError: '' })
    return api.request('/admin/usage', 'GET', { days }, { silent: true }).then(usage => {
      if (requestId !== this._usageRequest) return
      this.setData({ usage, usageLoading: false })
    }).catch(err => {
      if (requestId !== this._usageRequest) return
      this.setData({ usageLoading: false, usageError: err && err.msg || '行为统计加载失败' })
    })
  },

  onUsageDays(e) {
    this.setData({ usageDays: Number(e.currentTarget.dataset.days), expandedVisit: '', usage: null })
    this.loadUsage()
  },

  onVisit(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ expandedVisit: this.data.expandedVisit === key ? '' : key })
  },

  /**
   * 点统计卡片 → 用户列表
   * 跳转参数由后端给（group.filter = date_from / active_from），前端不写死口径
   */
  onCard(e) {
    const ds = e.currentTarget.dataset
    if (!ds.type || !ds.from) return   // 没有下钻目标的分组（内容量/使用率）不响应
    const hint = encodeURIComponent((ds.title || '') + ' · ' + (ds.label || ''))
    const url = '/pages/admin/users/users?' + ds.filter + '=' + encodeURIComponent(ds.from) +
      '&hint=' + hint + '&sort=' + encodeURIComponent(ds.sort || '')
    wx.navigateTo({ url })
  }
})
