/**
 * 我的（tab 2）
 *
 * 登录（参考 money 项目，2026-09 接后端后新增）：
 *  - 未登录：卡片 + 「微信授权登录」按钮（`open-type="chooseAvatar"`）——
 *    微信现在必须由用户点这个按钮才能拿到头像，不能弹窗问
 *  - 已登录：头像（点一下也能换，同一个 chooseAvatar）+ 昵称 + ID
 *  - 昵称：**不给用户自动填微信昵称**，而是点「修改」后用 `<input type="nickname">`
 *    让用户自己选/填（符合微信规范，避免审核卡）
 *  - 头像：chooseAvatar 给的是**临时文件**，必须传到后端换正式地址（`api.user.uploadAvatar`），
 *    否则重开小程序头像就没了
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
    version: '0.1.0',
    loggedIn: false,
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

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setSelected(3)
    }
    this.syncState()
    // 已登录就静默拉一次最新资料（后台改过昵称/头像能同步过来；token 失效会被 api 清掉 → 变回未登录）
    if (this.data.loggedIn) {
      api.user.info().then((d) => {
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

  /**
   * 点了头像按钮（未登录 = 登录；已登录 = 换头像）
   * 注意：这里拿到的是临时文件路径，先本地显示撑住界面，再传后端换正式地址
   */
  onChooseAvatar(e) {
    const localPath = (e.detail && e.detail.avatarUrl) || ''
    if (!localPath) {
      wx.showToast({ title: T.t('mine.avatar_fail'), icon: 'none' })
      return
    }
    // 先本地显示（不等网络）
    this.setData({ 'userInfo.avatarUrl': localPath })

    if (api.isLoggedIn()) {
      this.uploadAvatar(localPath)
      return
    }

    wx.showLoading({ title: T.t('mine.logging_in'), mask: true })
    api.login().then((d) => {
      wx.hideLoading()
      wx.showToast({ title: T.t('mine.login_ok'), icon: 'success' })
      const ui = {
        userId: d.userId,
        name: d.name || '',
        nickName: d.nickName || '',
        avatarUrl: localPath,
        isAdmin: !!d.isAdmin
      }
      this.setData({ loggedIn: true })
      this.applyUser(ui)
      this.loadHanger()                 // 登录成功立刻拉衣架数字（不然要切一下 tab 才出来）
      this.uploadAvatar(localPath)      // 换正式地址（失败不拦，本地先用着）
    }).catch((err) => {
      wx.hideLoading()
      wx.showToast({ title: (err && err.msg) || T.t('mine.login_fail'), icon: 'none' })
    })
  },

  /**
   * 头像上传：成功了换成后端地址（重开小程序也在）
   *
   * **内容没变就不重复传**（2026-09 用户要求）：chooseAvatar 每次给的临时路径都不一样，
   * 用户点开头像又选了同一张会白传一次；这里拿文件内容指纹（utils/file-key.js）比一下。
   * 只有上传成功才记指纹 → 传失败时下次照样会重传，不会把头像"卡"在本地。
   */
  uploadAvatar(localPath) {
    if (!localPath) return
    // 已经是后端的正式地址了就不用再传（换头像时拿到的是临时文件，正常都会走上传）
    if (String(localPath).indexOf('/storage/avatars/') >= 0) return

    const key = fileKey.ofFile(localPath)
    if (key && key === (wx.getStorageSync('avatarKey') || '')) {
      // 跟上次传上去的是同一张：省掉这次上传，界面回到后端那张（本机 userInfo 存的就是后端地址）
      const ui = wx.getStorageSync('userInfo') || {}
      if (ui.avatarUrl) this.setData({ 'userInfo.avatarUrl': ui.avatarUrl })
      return
    }

    api.user.uploadAvatar(localPath).then((url) => {
      const ui = wx.getStorageSync('userInfo') || {}
      ui.avatarUrl = url
      wx.setStorageSync('userInfo', ui)
      wx.setStorageSync('avatarKey', key)      // 传成功才记指纹
      this.setData({ 'userInfo.avatarUrl': url })
    }).catch(() => {
      // 上传失败就用本地临时路径顶着，不打断用户
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
   * 数据统计（2026-09，只有管理员能看到这条菜单）
   * 前端藏入口只是体验；真拦人在后端（非管理员调 /api/admin/* 会被 403）
   */
  onStats() {
    wx.navigateTo({ url: '/pages/admin/stats/stats' })
  }
})
