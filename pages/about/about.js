/**
 * 关于应用（2026-09）
 *
 * 从「我的」页的「关于应用」点进来，把这个软件能干什么讲清楚。
 * 分块跟底部 tab 一一对应（衣橱 / 穿搭 / 日历），再加一块「数据与账号」，
 * 文案只说实际做了的功能，别写还没做的（用户按这个页面认识产品）。
 */
const app = getApp()
const assets = require('../../utils/assets.js')
const T = require('../../utils/texts.js')

Page({
  data: {
    version: '',
    heroPic: '',        // 顶部横幅插画（后端下发，见 utils/assets.js；拿不到就只显示文字）
    slogan: ''          // 全站主宣传语（文案表下发）
  },

  onLoad() {
    this.setData({
      version: (app.globalData && app.globalData.version) || '',
      slogan: T.t('slogan.main')
    })

    assets.ensure().then(() => {
      this.setData({ heroPic: assets.pick('about.hero') })
    })
  },

  /** 远端横幅加载失败 → 换包内本地图（真机白名单没配也不会空一块） */
  onHeroPicErr() {
    const local = assets.fallback('about.hero')
    if (local && local !== this.data.heroPic) this.setData({ heroPic: local })
  }
})
