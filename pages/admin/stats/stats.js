/**
 * 数据统计（2026-09，仅管理员）
 *
 * 从「我的 → 数据统计」进来（这条菜单只有管理员渲染）。
 * 页面只做一件事：把后端下发的 groups 渲染成卡片，点卡片跳用户列表带筛选参数。
 * **口径全在后端**（AdminController::stats），这里不自己算数、也不写死有哪些指标——
 * 以后加一个统计分组只改后端，这个页面不用动。
 */
const api = require('../../../utils/api.js')

Page({
  data: {
    groups: [],
    loading: true,
    error: ''
  },

  onShow() {
    this.load()
  },

  /** 下拉刷新（统计数字要手查，给个手动刷新的入口） */
  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh())
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
