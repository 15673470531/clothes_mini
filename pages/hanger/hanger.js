/**
 * 衣架说明（2026-09 · 用户定的方案 1）
 *
 * （2026-09 隐藏中：用户觉得内容写得不合适，卡上点哪儿都去赚衣架页了 —— 按需再放出来）
 * 讲清**概念 / 怎么来 / 怎么算 / 不够了怎么办**，
 * 上面带当前剩余（今日 / 总共）。数字口径跟「我的」页那一行完全一样（utils/hanger.js + 同一个接口）。
 *
 * 文案口径（跟后端 App\Services\Quota 的报错话术对齐，别一边一个说法）：
 *  - 一个衣架挂一样东西：新增一件衣物占 1 个、新增一套搭配占 1 个
 *  - 编辑已有的不占；删掉会还回**总数**（今日不回补）
 *  - 今日用完了明天自动恢复；总数用完了删东西腾，或联系客服
 */
const api = require('../../utils/api.js')
const hanger = require('../../utils/hanger.js')

Page({
  data: {
    ready: false,
    heroText: '',          // 顶部大数字「493 / 500」：数字由接口下发
    totalState: 'ok',      // ok / low / none（决定颜色）
    full: false,
    fullText: '',          // 用完时那句提示（没满为空串）
    freeName: ''           // 「这个号一共 N 个」里的 N 也由接口下发（调额度不用改小程序）
  },

  /** 从客服页返回时也刷新一下（可能刚加过衣架） */
  onShow() {
    this.load()
  },

  load() {
    api.user.quota().then((q) => {
      const h = hanger.ofQuota(q)
      if (!h) return

      this.setData({
        ready: true,
        // 数字全部来自接口（hangerTotalLimit）—— 后端调了免费额度，小程序一个字都不用改、不用发版
        heroText: h.heroText,
        freeName: h.freeName,
        totalState: h.totalState,
        full: h.full,
        fullText: h.full
          ? (h.total <= 0
            ? '衣架用完了。删掉不想要的能腾出衣架，也可以联系客服。'
            : '今天挂不上了（当天的额度用完了，明天自动恢复）；想今天继续挂可以联系客服。')
          : ''
      })
    }).catch(() => {
      // 拿不到就不显示数字区（页面上的说明照常看）
    })
  },

  /** 联系客服：那页有「进入客服会话」（加衣架、问问题都走这里） */
  onService() {
    wx.navigateTo({ url: '/pages/service/service' })
  }
})
