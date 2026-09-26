/**
 * 文案表（2026-09 用户定：前端所有提示都由后端下发，随时能改、不用发小程序版本）
 *
 * 三层，跟后端 app/Services/Texts.php 一套：
 *   1 这里的 DEFAULTS —— **本地兜底**。有几类提示根本等不到后端（网络异常、登录失效、
 *     请求失败：后端都没响应了，文案不可能来自后端），所以本地必须有一份
 *   2 后端 GET /api/texts 下发的文案 —— 小程序启动拉一次存 storage（key = texts），拉到就覆盖
 *   3 云端还能只改一条：后端 storage/app/texts.json 里写一条，其余自动用默认
 *
 * 用法：
 *   const t = require('../../utils/texts.js')
 *   wx.showToast({ title: t('mine.saved') })
 *   wx.showModal({ title: t('wardrobe.left_title', { n: left }) })
 *
 * 数字类文案：能后端拼的后端已经拼好了（比如签到的 toast 直接来自接口），
 * 只有前端才知道的（衣物名、剩余张数）用 {xxx} 占位符，调用时传进来替换。
 *
 * ⚠️ 这里的 DEFAULTS 必须跟后端 app/Services/Texts.php 的 DEFAULTS 一一对应
 *    （node /tmp/check-texts.js 会比对两边，跑一下就知道有没有漏）
 */

/** 本地兜底文案（key 跟后端一一对应） */
const DEFAULTS = {
  // ---- common ----
  'common.loading': '加载中...',
  'common.uploading': '上传中...',
  'common.avatar_uploading': '上传头像...',
  'common.network_fail': '网络异常，后端起了吗？',
  'common.request_fail': '请求失败',
  'common.retry_later': '网络异常，稍后再试',
  'common.fail': '操作没成功，稍后再试',
  'common.service_ok': '联系客服',
  'common.know': '知道了',
  'common.ok': '好',
  'common.go_wardrobe': '去衣橱',
  // ---- 宣传语（跟后端 slogan.* 一一对应；改后端文案表即全站生效）----
  'slogan.main': '衣服都在，搭配不用想',
  'slogan.wardrobe_empty': '拍一张，衣柜就搬进手机里',
  // ---- mine ----
  'mine.logging_in': '登录中...',
  'mine.login_ok': '登录成功',
  'mine.login_fail': '登录失败，稍后再试',
  'mine.cleanup_need_login': '先登录微信再来',
  'mine.avatar_fail': '没拿到头像，再试一次',
  'mine.name_empty': '昵称不能为空',
  'mine.saved': '已保存',
  'mine.save_fail': '保存失败',
  'mine.logout_title': '退出登录？',
  'mine.logout_content': '衣橱和搭配都还在本机，不会丢。',
  'mine.logged_out': '已退出',
  // ---- reward ----
  'reward.need_login': '先登录微信再来',
  'reward.checkin_ok': '签到成功 +{n} 个衣架',
  'reward.share_ok': '分享成功 +{n} 个衣架',
  // 衣架到总数上限（200）时：点得动但余额不再加，用这句替掉"+n 个衣架"
  'reward.capped': '衣架已经到上限 {max} 个了，这次的先不累加',
  // 新用户每月免费领取（2026-09 取代"每月系统赠送"：从自动到账改成点一下领）
  // 标题/说明/按钮/状态都由后端拼好下发，这几条只在"后端拿不到"时兜底
  'reward.newcomer_title': '新用户每月免费领取',
  'reward.newcomer_desc': '每月免费领 +{n} 个衣架，点一下就到账',
  'reward.newcomer_btn': '领取',
  'reward.newcomer_done': '本月已领取',
  'reward.newcomer_ok': '领取成功 +{n} 个衣架',
  // 衣架流水列表（赚衣架页下面那个列表）
  'reward.logs_title': '衣架流水',
  'reward.logs_empty': '还没有记录，签个到就有第一个衣架',
  'reward.logs_more': '只显示最近 {n} 条（共 {total} 条）',
  'reward.logs_total': '累计 +{n} 个',
  'reward.log_checkin': '每日签到',
  'reward.log_share': '分享群或者好友',
  'reward.log_newcomer': '新用户每月免费领取',
  'reward.log_monthly': '每月系统赠送',
  // 老口径的每月系统赠送那一行（后端配置默认 0，不显示）
  'reward.monthly_title': '每月系统赠送',
  'reward.monthly_desc': '每个月自动送 +{n} 个衣架，不用领',
  'reward.monthly_btn': '',
  'reward.monthly_done': '本月已到账',
  'reward.monthly_ok': '本月赠送 +{n} 个衣架已到账',
  // ---- itemEdit ----
  'itemEdit.saving': '保存中…',
  'itemEdit.saved': '已保存',
  'itemEdit.saved_many': '已保存 {n} 件',
  'itemEdit.saved_next': '已保存，继续下一件',
  'itemEdit.already_saved': '这件已经录好了',
  'itemEdit.save_fail_title': '没保存成功',
  'itemEdit.save_fail_content': '{msg}，刚填的都还在，再点一次保存就行',
  'itemEdit.no_photo': '先拍一张或从相册选一张',
  'itemEdit.no_category': '先选品类',
  'itemEdit.photo_save_fail': '照片保存失败，可能是本机存储已满',
  'itemEdit.normalize_entry': '洗成白底图（去杂物）',
  'itemEdit.normalize_sub': '去掉背景里的杂物，生成一张干净的白底商品图',
  'itemEdit.normalize_done_sub': '白底图已生成 · 点这里选封面用哪张',
  'itemEdit.normalize_uploading': '先把照片传到云端…',
  'itemEdit.normalize_working': '正在洗白底图…（大约 20 秒）',
  'itemEdit.normalize_title': '白底图洗好了',
  'itemEdit.normalize_hint': '原图会一直留着，随时能切回来',
  'itemEdit.normalize_use_white': '用这张当封面',
  'itemEdit.normalize_keep_orig': '保持原图',
  'itemEdit.normalize_switched': '封面已换成白底图',
  'itemEdit.normalize_restored': '已切回原图',
  'itemEdit.normalize_left': '今天还能洗 {n} 次',
  'itemEdit.normalize_none_left': '今天洗白底的次数用完了，明天再来',
  'itemEdit.normalize_unlimited': '管理员：不限次数',
  'itemEdit.normalize_fail_title': '没洗出来',
  'itemEdit.normalize_label_orig': '原图',
  'itemEdit.normalize_label_white': '白底图',
  'itemEdit.normalize_using_white': '封面现在用的是白底图，可以随时切回来',
  'itemEdit.normalize_using_orig': '封面现在用的是原图，可以换成白底图',
  'itemEdit.normalize_auto_title': '自动洗白底',
  'itemEdit.normalize_auto_on': '已开启 · 保存后自动生成',
  'itemEdit.normalize_auto_off': '已关闭 · 需要时在这里手动生成',
  'itemEdit.normalize_auto_note': '保存后自动生成白底图，好了自动换成封面；原图一直留着，随时能切回。每天最多 {n} 张，生成失败不扣次数。',
  'itemEdit.normalize_auto_note_short': '保存后自动生成白底图并换成封面，原图一直留着。',
  'itemEdit.normalize_state_queued': '白底图排队中，马上开始',
  'itemEdit.normalize_state_running': '白底图正在生成…',
  'itemEdit.normalize_state_done': '白底图已生成 · 点这里看/换封面',
  'itemEdit.normalize_state_failed': '白底图生成失败 · 点这里重试',
  'itemEdit.normalize_state_skipped': '今天的次数用完了 · 明天自动接着洗',
  'itemEdit.normalize_saved_tip': '白底图正在生成，好了会自动换上',
  'itemEdit.normalize_regen': '重新生成一张',
  'itemEdit.delete_title': '删除这件衣物？',
  'itemEdit.delete_content': '删除后无法恢复。',
  'itemEdit.delete_ok': '删除',
  'itemEdit.delete_fail_title': '没删掉',
  'itemEdit.in_outfit_title': '这件衣服被搭配用着',
  'itemEdit.in_outfit_content': '「{names}」{more}里都有它，删除后这些搭配里就没有它了。',
  'itemEdit.in_outfit_more': ' 等 {n} 个搭配',
  'itemEdit.in_outfit_ok': '仍要删除',
  'itemEdit.quota_daily_title': '今天的衣架用完了',
  'itemEdit.quota_total_title': '衣架不够了',
  'itemEdit.quota_daily_fallback': '今天的衣架用完了，明天再来。',
  'itemEdit.quota_total_fallback': '衣架用完了，想继续挂可以联系客服。',
  'itemEdit.quota_daily_tail': '想今天继续挂，可以联系客服。',
  // ---- wardrobe ----
  'wardrobe.pending_title': '还有 {n} 张没录完',
  'wardrobe.pending_content': '继续录入上次选的照片，还是丢掉这几张重新选？',
  'wardrobe.pending_ok': '继续录入',
  'wardrobe.pending_cancel': '丢掉',
  'wardrobe.quota_daily_title': '今天的衣架用完了',
  'wardrobe.quota_total_title': '衣架用完了',
  'wardrobe.quota_daily_fallback': '今天的衣架用完了，明天再来。',
  'wardrobe.quota_total_fallback': '衣架用完了，想继续挂可以联系客服。',
  'wardrobe.quota_daily_tail': '想今天继续挂，可以联系客服。',
  'wardrobe.left_title': '还有 {n} 个衣架',
  'wardrobe.left_content': '这次最多选 {n} 张（拍一次照仍是一张）。',
  'wardrobe.normalize_pending': '{n} 件白底图正在生成，好了会自动换上',
  'wardrobe.preparing': '准备照片 {i}/{n}',
  'wardrobe.photo_save_fail': '照片保存失败，可能是本机存储已满',
  'wardrobe.some_failed': '{n} 张没保存成功，先录这几张',
  'wardrobe.deleted': '已删除',
  'wardrobe.delete_fail_title': '没删掉',
  'wardrobe.delete_title': '删除这件衣物？',
  'wardrobe.delete_content': '删除后无法恢复。',
  'wardrobe.delete_ok': '删除',
  'wardrobe.in_outfit_title': '这件衣服被搭配用着',
  'wardrobe.in_outfit_content': '「{names}」{more}里都有它，删除后这些搭配里就没有它了。',
  'wardrobe.in_outfit_more': ' 等 {n} 个搭配',
  'wardrobe.in_outfit_ok': '仍要删除',
  // ---- outfit ----
  'outfit.delete_title': '删除「{name}」？',
  'outfit.delete_content': '只删搭配本身，里面的衣物还在衣橱里。',
  'outfit.delete_ok': '删除',
  'outfit.deleted': '已删除',
  'outfit.delete_fail_title': '没删掉',
  // ---- outfitEdit ----
  'outfitEdit.max_items': '一套最多 {n} 件',
  'outfitEdit.need_one': '至少选一件衣物',
  'outfitEdit.picked': '已选择',
  // ---- outfitView ----
  'outfitView.need_save_first': '先点「完成」保存这套搭配',
  'outfitView.keep_one': '至少留一件衣物',
  'outfitView.removed': '已移出「{name}」',
  'outfitView.cover_generating': '生成封面…',
  'outfitView.saving': '保存中…',
  'outfitView.save_fail_title': '没保存成功',
  'outfitView.save_fail_content': '{msg}，这套搭配还是「没保存」状态，再点一次「完成」就行',
  'outfitView.quota_daily_title': '今天的衣架用完了',
  'outfitView.quota_total_title': '衣架不够了',
  'outfitView.quota_daily_fallback': '今天的衣架用完了，明天再来。',
  'outfitView.quota_total_fallback': '衣架用完了，想继续挂可以联系客服。',
  'outfitView.quota_daily_tail': '想今天继续挂，可以联系客服。',
  'outfitView.img_generating': '生成图片…',
  'outfitView.img_fail': '图片生成失败，稍后再试',
  'outfitView.saved_album': '已保存到相册',
  'outfitView.save_fail': '保存失败',
  'outfitView.album_auth_title': '需要相册权限',
  'outfitView.album_auth_content': '保存图片需要允许「保存到相册」，去设置里打开一下？',
  // ---- tryon ----
  'tryon.processing': '处理中…',
  'tryon.download_fail': '图片下载失败',
  'tryon.saved_album': '已保存到相册',
  'tryon.save_fail': '保存失败',
  'tryon.album_auth_title': '需要相册权限',
  'tryon.album_auth_content': '保存图片需要允许「保存到相册」，去设置里打开一下？',
  'tryon.set_cover_ok': '已设为这套的封面',
  'tryon.set_cover_local': '本机已换封面，云端稍后同步',
  // ---- calendar ----
  'calendar.marked': '已记下{name}',
  'calendar.mark_fail_title': '没记上',
  'calendar.clear_title': '清除这天的记录？',
  'calendar.clear_content': '只清掉日历上的记录，搭配和衣物都还在。',
  'calendar.clear_ok': '清除',
  'calendar.cleared': '已清除',
  'calendar.clear_fail_title': '没清掉',
  // ---- feedback ----
  'feedback.empty': '写点内容再提交吧',
  'feedback.thanks': '谢谢你的反馈！',
  'feedback.fail': '提交失败，稍后再试',
  // ---- service ----
  'service.email_copied': '邮箱已复制',
  // ---- admin ----
  'admin.no_photo': '这件没有照片',
  'admin.no_cover': '这套还没出图',
  'admin.load_fail': '加载失败',
}

const KEY = 'texts'             // 存 storage 的 key
const VERSION_KEY = 'textsVer'  // 内容指纹：一样就不覆盖，省一次写

let cache = null

/** 当前生效的文案 = 本地默认 + 后端下发的覆盖 */
function all() {
  if (cache) return cache
  let remote = {}
  try {
    remote = wx.getStorageSync(KEY) || {}
  } catch (e) {
    remote = {}
  }
  cache = Object.assign({}, DEFAULTS, remote)
  return cache
}

/**
 * 取一条文案
 * @param {string} key  形如 'mine.saved'
 * @param {object} vars 占位符（把 {xxx} 换掉），可选
 * @return {string} 取不到返回空串（不返回 undefined，免得界面上出现 "undefined"）
 */
function t(key, vars) {
  let s = all()[key]
  if (typeof s !== 'string') s = DEFAULTS[key]
  if (typeof s !== 'string') return ''

  if (vars) {
    Object.keys(vars).forEach((k) => {
      s = s.split('{' + k + '}').join(String(vars[k] == null ? '' : vars[k]))
    })
  }

  return s
}

/**
 * 启动时拉一次文案（在 app.js 的 onLaunch 里调）
 *
 * 自己发请求、不依赖 utils/api.js —— 那边要用 t() 弹提示，互相 require 会成环。
 * 拉到存 storage：下次启动先用缓存，不怕网慢/没网。
 */
function load() {
  return new Promise((resolve) => {
    const app = getApp()
    const base = (app && app.globalData && app.globalData.baseUrl) || ''
    if (!base) return resolve(false)

    wx.request({
      url: base + '/texts',
      method: 'GET',
      header: { 'Accept': 'application/json' },
      success(res) {
        const d = res && res.data && res.data.data
        const texts = d && d.texts
        if (!texts || typeof texts !== 'object') return resolve(false)

        try {
          // 内容没变就不写（免得每次启动都写一遍）
          if (wx.getStorageSync(VERSION_KEY) !== d.version) {
            wx.setStorageSync(KEY, texts)
            wx.setStorageSync(VERSION_KEY, d.version)
          }
        } catch (e) {
          // 存储写失败不影响这次使用，内存里用就好
        }

        cache = Object.assign({}, DEFAULTS, texts)
        resolve(true)
      },
      fail() {
        // 没网/后端没起：用本地默认（这就是 DEFAULTS 存在的意义）
        resolve(false)
      }
    })
  })
}

/** 清掉缓存（调试用：想立刻看到后端改的新文案就调它） */
function clear() {
  cache = null
  try {
    wx.removeStorageSync(KEY)
    wx.removeStorageSync(VERSION_KEY)
  } catch (e) {}
}

module.exports = { t, all, load, clear, DEFAULTS }
