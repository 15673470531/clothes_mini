const personalTryon = require('../../utils/personal-tryon.js')
/**
 * 我的（tab 2）
 *
 * 登录（参考 money 项目，2026-09 接后端后新增）：
 *  - 未登录：卡片 + 「微信登录」按钮（普通 button，bindtap）→ 直接登录，不弹任何选择器
 *  - 已登录：头像（点一下就能换）+ 昵称 + ID
 *  - 昵称：**不给用户自动填微信昵称**，而是点「修改」后用 `<input type="nickname">`
 *    让用户自己选/填（符合微信规范，避免审核卡）
 *  - 头像：`wx.chooseMedia` 从相册/拍照选（**只有这两项，没有"使用微信头像"**）
 *    ⚠️ 微信从 2022-10-25 起 getUserProfile 只返回匿名数据（昵称「微信用户」+ 灰头像），
 *      "登录完自动就有微信头像"这条路是平台关掉的 —— 想一键用微信头像，只能让用户点
 *      `<button open-type="chooseAvatar">`（原生选择器里有那一项）。
 *    ⚠️ 2026-09 试过"点登录时就弹头像选择器"（登录按钮挂 open-type="chooseAvatar"），**已撤回**：
 *      真机上表现不稳（"点了直接进去、不弹选择器"）；那版还有"退出登录后再点登录没反应"的 bug
 *      （登录 promise 缓存没清）。要再做，先把这两条解决。
 *  - 头像拿到的是**临时文件**，必须传到后端换正式地址（`api.user.uploadAvatar`），否则重开小程序头像就没了
 *
 * 数据仍然只存本机（一期后端只做登录 + 用户资料 + 意见反馈）：登录成功不代表衣物上云，
 * 所以清空本机数据、换手机丢失这些说明保留。
 *
 * ID 显示：`10` + userId（掩藏真实用户数，跟 money 同一套口径）
 */

const store = require('../../utils/store.js')
const api = require('../../utils/api.js')
const cloud = require('../../utils/cloud.js')
const fileKey = require('../../utils/file-key.js')
const hanger = require('../../utils/hanger.js')
const T = require('../../utils/texts.js')

/**
 * 衣架（2026-09 用户定的方案 A：头部一颗小药丸）
 *
 * 只看**总数**（还剩几个），每日额度不在界面上出现；卡上点哪儿都 → 赚衣架页（pages/reward）。
 * 口径、文案、状态色全在 utils/hanger.js —— 别在这里另写一套。
 * （衣架说明页 pages/hanger 2026-09 隐藏，只留着文件：用户觉得那页写得不合适）
 */

Page({
  data: {
    personalTryonVisible: false,
    version: '0.1.0',
    loggedIn: false,
    loggingIn: false,
    avatarUploading: false,
    isDevelop: false,
    userInfo: { userId: 0, name: '', nickName: '', avatarUrl: '', isAdmin: false },
    displayName: '',
    displayId: '',
    editingName: false,
    nameDraft: '',
    quotaFull: false,     // 今天/总数已经不够了（后端会拦）
    // 衣架药丸（2026-09 方案 A：头部一颗小胶囊，只看总数，点进说明页）
    // 拿到数字才显示（hangerReady）—— 免得查失败时显示成 0 误导人
    hangerReady: false,
    hangerTotal: 0,
    hangerTotalState: 'ok',   // ok / low / none（决定数字颜色）
    hangerCardText: ''        // 「衣架 97 / 162」= 可用 / 总数：在 JS 里拼好，WXML 不拼接
  },

  onPersonalTryon() { personalTryon.open('') },

  onShow() {
    personalTryon.visibility(this)
    // 仅开发版展示全部现有菜单；读取失败按正式环境处理。
    let isDevelop = false
    try { isDevelop = wx.getAccountInfoSync().miniProgram.envVersion === 'develop' } catch (e) {}
    this.setData({ isDevelop })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setSelected(3)
    }
    this.syncState()
    // 已登录就静默拉一次最新资料（后台改过昵称/头像能同步过来；token 失效会被 api 清掉 → 变回未登录）
    if (this.data.loggedIn) {
      const avatarRevision = this._avatarRevision || 0
      const profileToken = wx.getStorageSync('token')
      api.user.info().then((d) => {
        if (profileToken !== wx.getStorageSync('token') || this.data.avatarUploading || avatarRevision !== (this._avatarRevision || 0)) return
        const ui = {
          userId: d.userId,
          name: d.name || '',
          nickName: d.nickName || '',
          avatarUrl: d.avatarUrl || '',
          // 管理端入口靠它判断，必须一起存（后端改过权限后，重进本页就会同步过来）
          isAdmin: !!d.isAdmin
        }
        wx.setStorageSync('userInfo', ui)
        this.applyUser(ui)
      }).catch(() => {
        if (!api.isLoggedIn()) this.syncState()
      })
      this.loadHanger()
    }
    // 数据上云：登录状态下顺便对齐一次（升级后第一次进来就是在这儿把老本机数据迁上去）
    cloud.ready()
  },

  /**
   * 拉衣架数字铺到卡片上（口径统一在 utils/hanger.js，拦人在后端，这里只是告知）
   *
   * 为什么抽成方法：**刚在本页登录成功后也要立刻拉一次**（2026-09 用户反馈：
   * 登录完衣架卡不出来，得切一下 tab 才出现 —— 因为原来只有 onShow 会拉，
   * 而页内登录不会重新触发 onShow）。
   */
  loadHanger() {
    api.user.quota().then((q) => {
      const h = hanger.ofQuota(q)
      if (!h) return

      this.setData({
        hangerReady: true,
        hangerTotal: h.total,
        hangerTotalState: h.totalState,
        hangerCardText: h.cardText,
        quotaFull: h.full
      })
    }).catch((err) => {
      // 拿不到衣架数字就不显示这张卡（别显示成 0/N 误导）。留一条日志，方便排查为什么没出来
      console.log('[hanger] 没拿到衣架数字，衣架卡不显示：', (err && (err.code || err.msg || err.errMsg)) || err)
    })
  },

  /**
   * 点衣架卡主体（「衣架 97 / 162」那块）→ 赚衣架页
   *
   * 2026-09 用户定：**衣架说明页隐藏**（"写的不太好"），卡上点哪儿都统一进「获取更多」那一页；
   * 说明页文件、app.json 注册都留着，要放出来就把这里指回 `/pages/hanger/hanger`
   */
  onHanger() {
    wx.navigateTo({ url: '/pages/reward/reward' })
  },

  /**
   * 点卡片右侧「获取更多」→ 赚衣架页（每日签到 / 分享群或者好友 / 每月免费领取，数字以后端为准）
   * 用户 2026-09 定：不要"功能介绍"那种没用的页，进去就得真能拿到衣架
   */
  onReward() {
    wx.navigateTo({ url: '/pages/reward/reward' })
  },

  /** 从本地存储同步登录态到页面 */
  syncState() {
    const loggedIn = api.isLoggedIn()
    const ui = wx.getStorageSync('userInfo') || { userId: 0, name: '', nickName: '', avatarUrl: '', isAdmin: false }
    this.setData({ loggedIn })
    this.applyUser(ui)
  },

  applyUser(ui) {
    const info = ui || {}
    this.setData({
      userInfo: info,
      // 名称优先，昵称兜底；都没有就留空（不写「匿名」这类占位）
      displayName: info.name || info.nickName || (info.userId ? '微信用户' : ''),
      // ID 用 10 前缀掩藏真实用户数
      displayId: info.userId ? ('10' + info.userId) : ''
    })
  },

  /** 登录（bindtap 触发）：只做登录，头像在「我的」页点头像单独换 */
  onLogin() {
    if (this.data.loggingIn) return
    this.setData({ loggingIn: true })
    return api.login().then(d => {
      this.setData({ loggedIn: true })
      this.applyUser({ userId: d.userId, name: d.name || '', nickName: d.nickName || '', avatarUrl: d.avatarUrl || '', isAdmin: !!d.isAdmin })
      this.loadHanger()
      personalTryon.visibility(this)
      cloud.ready()
      wx.showToast({ title: T.t('mine.login_ok'), icon: 'success' })
    }).catch(err => {
      const reason = err && (err.msg || err.message || err.errMsg)
      wx.showModal({ title: '登录未成功', content: reason || '网络异常，请稍后重试', showCancel: false })
    }).finally(() => this.setData({ loggingIn: false }))
  },

  /** 点头像换头像：从相册或拍照选一张 */
  onPickAvatar() {
    if (this.data.avatarUploading) return
    if (!api.isLoggedIn()) { this.syncState(); return }
    const token = wx.getStorageSync('token')
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'],
      success: r => {
        if (token !== wx.getStorageSync('token')) return
        const path = r.tempFiles && r.tempFiles[0] && r.tempFiles[0].tempFilePath
        if (path) this.uploadAvatar(path)
      },
      fail: err => {
        if (/cancel/i.test(err.errMsg || '')) return
        wx.showModal({ title: '无法选择头像', content: err.errMsg || '请检查相册或相机权限后重试', showCancel: false })
      }
    })
  },

  /** 保留原生头像回调兼容旧入口（现在按钮走 onPickAvatar，不再绑它）。 */
  onChooseAvatar(e) {
    const path = e.detail && e.detail.avatarUrl
    if (path && api.isLoggedIn()) return this.uploadAvatar(path)
  },

  uploadAvatar(localPath) {
    if (!localPath || this.data.avatarUploading || !api.isLoggedIn()) return
    const token = wx.getStorageSync('token')
    const previous = (wx.getStorageSync('userInfo') || {}).avatarUrl || ''
    const key = fileKey.ofFile(localPath)
    if (key && previous && key === wx.getStorageSync('avatarKey')) {
      this.setData({ 'userInfo.avatarUrl': previous })
      wx.showToast({ title: '已是当前头像', icon: 'none' })
      return
    }
    this._avatarRevision = (this._avatarRevision || 0) + 1
    this.setData({ avatarUploading: true, 'userInfo.avatarUrl': localPath })
    return api.user.uploadAvatar(localPath).then(url => {
      if (token !== wx.getStorageSync('token')) return
      const ui = wx.getStorageSync('userInfo') || {}
      ui.avatarUrl = url
      wx.setStorageSync('userInfo', ui)
      wx.setStorageSync('avatarKey', key)
      this.setData({ 'userInfo.avatarUrl': url })
      wx.showToast({ title: '头像已更新', icon: 'success' })
    }).catch(err => {
      if (token !== wx.getStorageSync('token')) return
      this.setData({ 'userInfo.avatarUrl': previous })
      wx.showModal({ title: '头像更新失败', content: err && (err.msg || err.message || err.errMsg) || '请稍后重试', showCancel: false })
    }).finally(() => {
      this._avatarRevision++
      this.setData({ avatarUploading: false })
    })
  },

  onEditName() {
    this.setData({ editingName: true, nameDraft: this.data.userInfo.name || this.data.userInfo.nickName || '' })
  },

  onNameInput(e) {
    this.setData({ nameDraft: e.detail.value })
  },

  /**
   * 失焦也算保存（用户要求：改完昵称点别的地方离开 = 保存）
   *
   * 分三种情况，别一律提交：
   *  - 没改：静默退出编辑态（不发请求、不弹 toast —— 点开又离开不该打扰用户）
   *  - 改了且非空：走 onSaveName 保存
   *  - 改空了：**当作没改**（退出编辑、保留原昵称）。主动点「保存」按钮才会提示不能为空，
   *    失焦属于「离开」语义，不该把人卡在编辑态里
   */
  onNameBlur() {
    // ⚠️ 点「保存」按钮时，input 会先失焦 → 这里再提交一次就重复了。
    //    所以：正在保存中、或刚保存完 600ms 内，一律跳过（按钮那条路已经处理了）
    if (this._savingName || Date.now() - (this._nameSavedAt || 0) < 600) return
    const cur = (this.data.userInfo.name || this.data.userInfo.nickName || '').trim()
    const draft = (this.data.nameDraft || '').trim()
    if (draft == cur || !draft) {
      this.setData({ editingName: false })
      return
    }
    this.onSaveName()
  },

  /** 保存昵称：走后端 /user/update-name */
  onSaveName() {
    // 点「保存」按钮时，input 会先失焦 → blur 那条路已经提交了；这里再提交就重复。
    // 顺带挡住手快连点两次（同一次保存 600ms 内只发一次请求）
    if (this._savingName || Date.now() - (this._nameSavedAt || 0) < 600) return
    const name = (this.data.nameDraft || '').trim()
    if (!name) {
      wx.showToast({ title: T.t('mine.name_empty'), icon: 'none' })
      return
    }
    this._savingName = true
    api.user.updateName(name).then(() => {
      this._savingName = false
      this._nameSavedAt = Date.now()
      const ui = wx.getStorageSync('userInfo') || {}
      ui.name = name
      ui.nickName = name
      wx.setStorageSync('userInfo', ui)
      this.setData({ editingName: false })
      this.applyUser(ui)
      wx.showToast({ title: T.t('mine.saved'), icon: 'none' })
    }).catch((err) => {
      this._savingName = false          // 失败也要解锁，否则失焦再也保存不了
      wx.showToast({ title: (err && err.msg) || T.t('mine.save_fail'), icon: 'none' })
    })
  },

  /** 退出登录：清本地 token（后端也把当前 token 删掉） */
  onLogout() {
    wx.showModal({
      title: T.t('mine.logout_title'),
      content: T.t('mine.logout_content'),
      success: (r) => {
        if (!r.confirm) return
        api.user.logout().catch(() => {})
        wx.removeStorageSync('token')
        wx.removeStorageSync('userInfo')
        wx.removeStorageSync('openid')
        // 头像指纹也要清：换账号登录时不能拿上一个账号的指纹去比，否则新头像可能被跳过
        wx.removeStorageSync('avatarKey')
        // 衣架数字也要清：退出后换账号登录，不能先显示上一个账号的
        this.setData({
          loggedIn: false, editingName: false, quotaFull: false,
          hangerReady: false, hangerTotal: 0, hangerCardText: '', hangerTotalState: 'ok'
        })
        this.applyUser({ userId: 0, name: '', nickName: '', avatarUrl: '', isAdmin: false })
        wx.showToast({ title: T.t('mine.logged_out'), icon: 'none' })
      }
    })
  },

  /** 联系客服：跳「联系客服」页（微信官方客服会话 / 微信号复制，不用登录） */
  onService() {
    wx.navigateTo({ url: '/pages/service/service' })
  },

  /**
   * 关于应用：跳「关于应用」页（原来只弹一句版本号，2026-09 改成整页功能介绍）
   */
  onAbout() {
    wx.navigateTo({ url: '/pages/about/about' })
  },

  /**
   * 数据统计（开发版展示入口；体验版、正式版仅管理员可见）
   * 前端藏入口只是体验；真拦人在后端（非管理员调 /api/admin/* 会被 403）
   */
  onStats() {
    wx.navigateTo({ url: '/pages/admin/stats/stats' })
  }
})
