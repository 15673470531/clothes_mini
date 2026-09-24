/**
 * 赚衣架（2026-09 用户定）
 *
 * 「我的」页衣架卡右侧的「获取更多」进的就是这里。不做"功能介绍"那种没用的页，
 * 直接给真能拿到衣架的几项：
 *   每日签到        +1（每天 1 次）
 *   分享群或者好友   +2（每天 1 次）
 *   新用户每月免费领取 +50（每月 1 次，**点一下「领取」才到账**）
 *
 * 最后一项 2026-09 用户改过口径：原来是"每月系统赠送"（进页面就自动到账、不用点），
 * 现在改成用户自己点「领取」—— 这个月没点就没了，下个月按钮又变回「领取」。
 *
 * 样式口径：**「分享群或者好友」按钮固定成"可点"的样子**（2026-09 用户定）——
 * 今天已经领过奖励也不灰、文字也不换，只有上面那行说明会写"今天已经领过"。
 * 「每日签到」保持原样（领过 → 灰掉 +「明天再来」）。
 *
 * 三个口径（跟后端 app/Services/HangerRewardService.php 一套）：
 *  - 奖励加到**总额**（可用衣架），今日额度不动 —— 赚来的是资产
 *  - 数字（+1 / +2 / +50 / 每天几次）**全部由后端下发**，这里一个都不写死
 *    （后端改 config/quota.php 的 reward_* 就能调，不用发小程序版本）
 *  - 分享"点一下就算"：微信从 2021 年起不再返回"是否真的转发成功"，小程序拿不到结果，
 *    只能在 onShareAppMessage 里发奖励（点了转发按钮必然会走到这儿）
 *
 * 页面拿到的每次返回都是"最新状态"，所以领完直接 setData 刷新，不用再发一次请求。
 */
const api = require('../../utils/api.js')
const hanger = require('../../utils/hanger.js')
const T = require('../../utils/texts.js')

Page({
  data: {
    ready: false,
    heroText: '',          // 顶部「493 / 500」：可用 / 总数（后端下发）
    totalState: 'ok',      // ok / low / none（决定数字颜色）

    checkinDesc: '',       // 「每天 +1 个衣架」（数字后端下发）
    checkinBtn: '',        // 「签到」/「明天再来」
    checkinOn: false,      // 按钮是否为可点状态（决定样式）
    canCheckin: false,

    shareDesc: '',         // 「每天 +10 个衣架」/「今天已经领过（+10 个），明天还能再来」
    canShare: false,       // 今天还能不能拿分享奖励（按钮样式不受它影响，见下面）

    // 新用户每月免费领取（每月 1 次，点一下才到账；标题/说明/按钮/状态都由后端拼好下发）
    newcomerOn: false,
    newcomerTitle: '',
    newcomerDesc: '',
    newcomerBtn: '',       // 「领取」
    newcomerStateText: '', // 「本月已领取」（领过就显示文字、不显示按钮）
    canNewcomer: false,

    // 衣架流水（页面最下面那个列表，2026-09 用户要的）：最近的领取记录，后端拼好标题/日期
    logs: [],
    logsTitle: '',
    logsEmpty: '',
    logsNote: '',
    logsTotal: '',      // 「累计 +53 个」（列表标题右边那句小字；没有记录时为空）

    // 分享卡片的文案（用户可改；点「分享群或者好友」弹的就是这个）
    shareTitle: '我在用「海豚衣橱」整理衣服，拍照归类，搭配都存好了'
  },

  /** 每次进来都重新问一次状态（可能跨天了 / 在别的设备领过） */
  onShow() {
    if (!api.isLoggedIn()) {
      wx.showToast({ title: T.t('reward.need_login'), icon: 'none' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    this.load()
  },

  /** 拉今日状态（静默，不弹「加载中」） */
  load() {
    api.hanger.reward().then((d) => {
      this.apply(d)
    }).catch((err) => {
      // 拿不到数字就不显示顶部数字区，但按钮仍在（点了会自己报错）
      console.log('[reward] 没拿到赚衣架状态：', (err && (err.code || err.msg || err.errMsg)) || err)
    })
  },

  /** 把接口出参铺到界面上（接口几个动作出参形状一样） */
  apply(d) {
    const h = hanger.ofQuota(d && d.hanger)
    const cin = (d && d.checkin) || {}
    const sha = (d && d.share) || {}
    const nc = (d && d.newcomer) || {}

    // 新用户每月免费领取：整行文案后端已经拼好，这里直接用
    // （后端配置成 0 时不给标题 → 这一行不显示；已经领过 → 给"本月已领取"、不给按钮）
    const ncGranted = !!nc.granted
    const ncOn = !!(nc.amount > 0 && nc.title)

    this.setData({
      ready: !!h,
      heroText: h ? h.heroText : '',
      totalState: h ? h.totalState : 'ok',

      newcomerOn: ncOn,
      newcomerTitle: nc.title || '',
      newcomerDesc: nc.desc || '',
      newcomerBtn: nc.btnText || T.t('reward.newcomer_btn'),
      newcomerStateText: nc.stateText || '',
      canNewcomer: !!(ncOn && nc.canClaim && !ncGranted),

      checkinDesc: this.desc(cin),
      checkinBtn: cin.canClaim ? '签到' : '明天再来',
      checkinOn: !!cin.canClaim,
      canCheckin: !!cin.canClaim,

      // 衣架流水：标题/空态/超出说明都走文案表，列表内容后端拼好（前端只显示）
      logs: (d && d.logs) || [],
      logsTitle: T.t('reward.logs_title'),
      logsEmpty: T.t('reward.logs_empty'),
      logsNote: (d && d.logsNote) || '',
      logsTotal: (d && d.logsTotal) || '',

      shareDesc: this.desc(sha),
      // 分享按钮的样式/文字**不跟 canShare 走**（用户 2026-09 定：领过了也照样显示成可点，
      // 分享本身就值得鼓励）。canShare 只决定"点转发时还要不要发奖励请求"
      canShare: !!sha.canClaim
    })
  },

  /** 一行说明文案，「+几个 / 每天几次」全部来自后端（前端不编数字） */
  desc(r) {
    if (!r || !r.amount) return '暂时没有这个奖励'
    if (r.timesPerDay > 1) {
      return '每天 ' + r.timesPerDay + ' 次，每次 +' + r.amount + ' 个衣架'
    }
    if (r.doneToday > 0 && r.timesPerDay <= 1) {
      return '今天已经领过（+' + r.amount + ' 个），明天还能再来'
    }
    return '每天 +' + r.amount + ' 个衣架'
  },

  /** 每日签到 */
  onCheckin() {
    if (!this.data.canCheckin) return
    // 先禁掉按钮：连点两下也只是白跑一个请求（后端有防重复，这里少一次网络）
    this.setData({ canCheckin: false })

    api.hanger.checkin().then((d) => {
      this.apply(d)
      // 提示语**由后端拼好**（接口出参里的 toast，见后端 HangerRewardService）——
      // 前端不自己拼，改文案不用发版
      wx.showToast({ title: (d && d.toast) || T.t('reward.checkin_ok', { n: '' }), icon: 'none' })
    }).catch(() => {
      // 4008「今天已经签到过了」这些提示后端已经弹过（request 非 silent），这里只把状态同步回来
      this.load()
    })
  },

  /**
   * 新用户每月免费领取（每月 1 次，点了才给）
   *
   * 领过之后后端会回 4008，并在这行右侧显示「本月已领取」——
   * 所以这里不需要自己判断"能不能领"，只看后端给的 canClaim。
   */
  onClaimNewcomer() {
    if (!this.data.canNewcomer) return
    // 先禁掉按钮：连点两下也只是白跑一个请求（后端有防重复，这里少一次网络）
    this.setData({ canNewcomer: false })

    api.hanger.newcomer().then((d) => {
      this.apply(d)
      // 提示语由后端拼好（接口出参里的 toast），前端不自己拼 —— 改文案不用发版
      wx.showToast({ title: (d && d.toast) || T.t('reward.newcomer_ok', { n: '' }), icon: 'none' })
    }).catch(() => {
      // 4008 这些提示后端已经弹过（request 非 silent），这里只把状态同步回来
      this.load()
    })
  },

  /**
   * 分享群或者好友（微信要求：`<button open-type="share">` 才会拉起转发面板）
   *
   * 奖励就发在这里：点了转发按钮必然走到 onShareAppMessage。
   * 今天已经领过的就只分享、不再请求（省一次网络，UI 也不会跳，
   * 按钮样式是固定"可点"的，见 wxml —— 所以不会出现"点了没反应"的割裂感）。
   */
  onShareAppMessage() {
    if (this.data.canShare) {
      // 标记一下：同一次会话里反复点分享也只请求一次（后端还会再挡一道）
      this.shareAwarded = true
      api.hanger.share().then((d) => {
        this.apply(d)
      }).catch(() => {
        this.load()
      })
    }

    return {
      title: this.data.shareTitle,
      path: '/pages/wardrobe/wardrobe',
      // 分享封面（2026-09 用户要的）：本地图，5:4，上面带 logo 和主宣传语
      // 为什么放包内而不是走后端下发：转发面板要立刻拿到图，不能等网络
      imageUrl: '/images/share-cover.jpg'
    }
  }
})
