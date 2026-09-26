/**
 * 后端接口封装（跟 money 项目同一套写法）
 *
 * 约定：
 *  - 统一响应 {code, msg, data}，code=0 才算成功（不看 HTTP 状态码）
 *  - 自动带 Bearer Token（存在 storage 的 token 里）
 *  - options.silent = true 时不弹「加载中」遮罩（后台静默拉取用）
 *  - 401：清掉本地 token 并 reject（**不跳页** —— clothes 的衣物/搭配都在本机，
 *    掉登录不该把人从当前页面带走；「我的」页下次 onShow 会自己回到未登录态）
 *
 * 登录：wx.login 拿 code → 后端 jscode2session 换 openid → Sanctum token
 *  - 开发者工具：platform=devtools 时**固定把 code 换成 'dev_local'**（不是"给 code 加 dev_ 前缀"）——
 *    后端的 devLogin 是按 code 的 md5 建号的，用工具里那种每次不同的 code 会变成"每登一次多一个用户"。
 *    另外后端必须 ALLOW_DEV_LOGIN=true 才放行（线上绝不允许，见 UserController::devLoginAllowed）
 *  - 头像：chooseAvatar 给的是**临时文件**，必须上传到后端换正式地址（见 uploadAvatar）；
 *    同一张头像重复选不会重复上传（内容指纹判断，见 utils/file-key.js）
 */

const app = getApp()
const T = require('./texts.js')     // 提示语统一走文案表（后端下发，见 utils/texts.js）

function request(url, method = 'GET', data = {}, options = {}) {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync('token')

    if (!options.silent) {
      wx.showLoading({ title: T.t('common.loading'), mask: true })
    }

    wx.request({
      url: app.globalData.baseUrl + url,
      method,
      data,
      ...(options.timeout ? { timeout: options.timeout } : {}),
      header: {
        'content-type': 'application/json',
        'Accept': 'application/json',
        ...(token ? { 'Authorization': 'Bearer ' + token } : {})
      },
      success(res) {
        if (res.statusCode === 401) {
          wx.removeStorageSync('token')
          wx.removeStorageSync('userInfo')
          reject(res.data || { msg: '登录已失效' })
          return
        }
        if (res.statusCode >= 200 && res.statusCode < 300 && res.data && res.data.code === 0) {
          resolve(res.data.data)
        } else {
          const msg = (res.data && res.data.msg) || T.t('common.request_fail')
          if (!options.silent) wx.showToast({ title: msg, icon: 'none' })
          reject(res.data || { msg })
        }
      },
      fail(err) {
        if (!options.silent) wx.showToast({ title: T.t('common.network_fail'), icon: 'none' })
        reject(err)
      },
      complete() {
        if (!options.silent) wx.hideLoading()
      }
    })
  })
}

/**
 * 微信登录：拿 code 换 token
 * @param {string} nickName 昵称（可空 —— 昵称在「我的」页用 input type="nickname" 单独设置）
 * @return {Promise<Object>} {token, openid, userId, name, nickName, avatarUrl, isAdmin}
 */
function login(nickName = '') {
  return new Promise((resolve, reject) => {
    wx.login({
      timeout: 10000,
      success(res) {
        if (!res.code) {
          reject(new Error('wx.login 没拿到 code'))
          return
        }
        // 仅开发者工具连接回环地址时使用测试账号；线上始终使用微信 code。
        let isDevtools = false
        try { isDevtools = (wx.getSystemInfoSync() || {}).platform === 'devtools' } catch (e) {}
        const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(app.globalData.baseUrl)
        const code = isDevtools && isLocal ? 'dev_local' : res.code
        request('/user/login', 'POST', { code, nickName }, { silent: true, timeout: 15000 }).then((data) => {
          wx.setStorageSync('token', data.token)
          wx.setStorageSync('openid', data.openid)
          wx.setStorageSync('userInfo', {
            userId: data.userId,
            name: data.name || '',
            nickName: data.nickName || '',
            avatarUrl: data.avatarUrl || '',
            isAdmin: !!data.isAdmin
          })
          require('./usage.js').track('login_success', 'mine')
          resolve(data)
        }).catch(reject)
      },
      fail: reject
    })
  })
}

/** 已登录？（token 在就算登录；后端 401 时会自动清掉） */
function isLoggedIn() {
  return !!wx.getStorageSync('token')
}

/**
 * 上传图片（衣物照片 / 搭配封面）：小程序 → 本后端 → OSS
 *
 * 后端按 OSS_* 配置决定存哪：配了 OSS 就进 OSS，没配落服务器本地盘（storage/app/public）
 * @param {string} filePath 本地文件路径（wx.saveFile 存的、canvas 导出的都行）
 * @param {string} dir      clothes | outfit | avatar | feedback（后端白名单，传错会被挡）
 * @param {object} options  { silent: true } 不弹「上传中」（后台补传用）
 * @return {Promise<{path:string, url:string, driver:string}>} url 可直接给 <image src>
 */
function uploadImage(filePath, dir = 'clothes', options = {}) {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync('token')
    if (!token) {
      reject({ msg: '还没登录，先登录再上传' })
      return
    }
    if (!options.silent) wx.showLoading({ title: T.t('common.uploading'), mask: true })

    wx.uploadFile({
      url: app.globalData.baseUrl + '/upload/image',
      filePath,
      name: 'file',
      formData: { dir },
      // Accept 也带上：后端虽然强制 JSON 了，但带上更明确（校验失败时能看到中文原因）
      header: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' },
      success(res) {
        let body = {}
        try { body = JSON.parse(res.data || '{}') } catch (e) { body = {} }
        if (res.statusCode >= 200 && res.statusCode < 300 && body.code === 0 && body.data && body.data.url) {
          resolve(body.data)
        } else {
          reject(body && body.msg ? body : { msg: '图片上传失败' })
        }
      },
      fail: reject,
      complete() {
        if (!options.silent) wx.hideLoading()
      }
    })
  })
}

/** 拼查询串（空值不发；调用方只需给参数，不用自己判空） */
function queryString(params = {}) {
  const qs = Object.keys(params)
    .filter((k) => params[k] !== '' && params[k] !== undefined && params[k] !== null)
    .map((k) => k + '=' + encodeURIComponent(params[k]))
    .join('&')
  return qs ? '?' + qs : ''
}

module.exports = {
  request,
  login,
  isLoggedIn,
  uploadImage,

  /**
   * 插画资源表（2026-09）：{ items: {key: url}, version }
   *
   * 空态/关于页的插画 URL 都从这儿来（图在 OSS 上，换图不用发版）。
   * **免登录**，也没啥好提示的失败场景 —— silent，拿不到就用本地缓存（见 utils/assets.js）
   */
  assets() {
    return request('/assets', 'GET', {}, { silent: true })
  },

  user: {
    info() {
      return request('/user/info', 'GET', {}, { silent: true })
    },
    /** 改昵称（「我的」页点昵称，用 input type="nickname" 拿到用户自己填的微信昵称） */
    updateName(name) {
      return request('/user/update-name', 'POST', { name })
    },
    /** 免费额度用量：{ items, itemLimit, uploadsToday, uploadLimit }（只用于显示） */
    quota() {
      return request('/user/quota', 'GET', {}, { silent: true })
    },
    /**
     * 上传头像：chooseAvatar 给的是临时文件路径，必须存到后端才不会重开就丢
     * @param {string} filePath 本地临时路径
     * @return {Promise<string>} 正式头像地址
     */
    uploadAvatar(filePath) {
      return new Promise((resolve, reject) => {
        wx.showLoading({ title: T.t('common.avatar_uploading'), mask: true })
        wx.uploadFile({
          url: app.globalData.baseUrl + '/user/avatar',
          filePath,
          name: 'file',
          timeout: 20000,
          header: { Accept: 'application/json', 'Authorization': 'Bearer ' + (wx.getStorageSync('token') || '') },
          success(res) {
            let body = {}
            try { body = JSON.parse(res.data || '{}') } catch (e) { body = {} }
            if (res.statusCode >= 200 && res.statusCode < 300 && body.code === 0 && body.data && body.data.avatarUrl) {
              resolve(body.data.avatarUrl)
            } else {
              reject({ msg: body.msg || body.message || (res.statusCode === 401 ? '登录已失效，请重新登录后更换头像' : '头像上传失败（HTTP ' + res.statusCode + '）') })
            }
          },
          fail: reject,
          complete() {
            wx.hideLoading()
          }
        })
      })
    },
    logout() {
      return request('/user/logout', 'POST', {}, { silent: true })
    }
  },

  feedback: {
    submit(data) {
      return request('/feedback/submit', 'POST', data)
    }
  },

  /**
   * 洗白底（归一化 · 2026-09）：记录衣物页底部那个入口
   *  - 跟 AI 试穿的开关**解耦**（后端 NORMALIZE_ENABLED）：试穿藏着也能用
   *  - **同步**接口，一次 15~20 秒；命中缓存（同一件 + 同一张原图）秒回，data.cached = true
   *  - 业务码：4004 没照片·找不到 / 4008 生成失败 / 4009 功能没开 / 4010 今天次数用完
   */
  items: {
    /** 入口状态：{ enabled, leftToday, dailyLimit }（关着就整块入口不显示） */
    normalizeStatus() {
      return request('/items/normalize/status', 'GET', {}, { silent: true })
    },
    /**
     * 洗一张
     * @param {string} itemId   已有衣物的 id；新增流程里还没保存，传空串
     * @param {string} imageUrl 要洗的原图（**必须是云端 https 地址**，本机照片要先传）
     */
    /** 洗白底（同步，15~20 秒）；force = 用户点「重新生成一张」→ 跳过缓存真重洗 */
  normalize(itemId, imageUrl, force) {
    return request('/items/normalize', 'POST',
      { itemId: itemId || '', imageUrl, force: !!force }, {})
  }
  },

  /**
   * 衣物 / 搭配 / 日历 数据同步（2026-09 二期第二步：数据上云）
   * 只有这一对接口：拉全量 + 批量推；都由 utils/cloud.js 调用，页面不用直接碰
   */
  clothes: {
    /** 拉全量：{ items, outfits, wears, deleted:{items,outfits} } */
    syncPull() {
      return request('/clothes/sync', 'GET', {}, { silent: true })
    },
    /** 批量推：{ items, outfits, wears, deleted } → { counts } */
    syncPush(payload) {
      return request('/clothes/sync', 'POST', payload, { silent: true })
    }
  },

  /**
   * 管理端（2026-09）：只有 is_admin 的账号能用，后端会拦（403「无管理权限」）
   * 入口在「我的」页，只有管理员才渲染那条菜单
   */
  /**
   * AI 试穿（2026-09 · P3）
   *  - 生成一次要 20~35 秒，所以是「提交 → 轮询」两步，不是一次性同步接口
   *  - 命中缓存（同一套/同一件 + 同一个虚拟模特）会秒回，data.cached = true
   *  - 业务码：4003 没权限（试穿的权限门）/ 4004 没照片或找不到 / 4005 品类不支持 / 4006 次数用完 / 4007 没开放 / 4008 生成失败
   */
  tryon: {
    /** 入口状态：{ enabled, memberOnly, isMember, leftToday, dailyLimit, modelKey } */
    quota() {
      return request('/tryon/quota', 'GET', {}, { silent: true })
    },
    /**
     * 提交一次试穿
     * @param {object} params 单件传 { itemId }；整套搭配传 { outfitId }
     */
    create(params, options) {
      return request('/tryon', 'POST', params, options || {})
    },
    /** 轮询任务（生成中每 3 秒问一次，静默问，不弹「加载中」） */
    get(id) {
      return request('/tryon/' + id, 'GET', {}, { silent: true })
    }
  },

  /** 赚衣架（「我的」页衣架卡右侧「获取更多」→ pages/reward） */
  hanger: {
    /**
     * 今日状态（进页面先问一次）
     * @return {Promise<{checkin:{amount,timesPerDay,doneToday,leftToday,canClaim}, share:{...}, hanger:{...}}>}
     */
    reward() {
      return request('/hanger/reward', 'GET', {}, { silent: true })
    },
    /** 每日签到（成功返回最新状态，含衣架余额；今天领过了后端回 4008） */
    checkin() {
      return request('/hanger/checkin', 'POST', {}, {})
    },
    /** 分享群或者好友（点一下转发按钮就算；后端 4008 = 今天领过了） */
    share() {
      // silent：分享面板正开着，别在背后弹「加载中」遮罩
      return request('/hanger/share', 'POST', {}, { silent: true })
    },
    /**
     * 新用户每月免费领取（每月 1 次，**点了才给**；
     * 后端 4008 = 本月已经领过了 / 4009 = 这个奖励没开）
     */
    newcomer() {
      return request('/hanger/newcomer', 'POST', {}, {})
    }
  },

  admin: {
    /** 统计卡片：{ groups:[{id,icon,title,type,filter,cards:[{label,value,sub,date_from}]}] } */
    stats() {
      return request('/admin/stats', 'GET')
    },
    /**
     * 用户名单（统计页点卡片跳过来）
     *
     * 每行：{ id, openid, name, nickname, avatarUrl, isAdmin, createdAt, lastLoginAt, lastActiveAt,
     *        itemCount, outfitCount, wearCount,
     *        hangerTotal, hangerTotalLimit }（衣架 = 可用 / 总数，口径同「我的」页那张卡）
     * @param {object} params keyword / is_admin / date_from / active_from / sort_by / sort_order / page / per_page
     */
    users(params = {}) {
      return request('/admin/users' + queryString(params), 'GET')
    },
    /**
     * 某个人录的衣物（点名单里那行的「N 件衣物」）
     * @param {number} userId
     * @param {object} params page / per_page
     * @return {Promise<{user,list,total,currentPage,lastPage}>}
     */
    userItems(userId, params = {}) {
      return request('/admin/users/' + userId + '/items' + queryString(params), 'GET')
    },
    /**
     * 某个人建的搭配（点名单里那行的「N 套搭配」）
     * @param {number} userId
     * @param {object} params page / per_page
     * @return {Promise<{user,list,total,currentPage,lastPage}>}
     */
    userOutfits(userId, params = {}) {
      return request('/admin/users/' + userId + '/outfits' + queryString(params), 'GET')
    }
  }
}
