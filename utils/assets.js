/**
 * 插画资源表（2026-09 用户要的：给小程序加宣传语和插画）
 *
 * 跟文案表（utils/texts.js）一个套路，只是内容是**图片 URL**：
 *   1 后端 GET /api/assets 下发（图放 OSS 上，换图不用发版）—— 小程序启动拉一次，存 storage
 *   2 拉不到（没网/接口挂了）用**上次存下来的**那份
 *   3 缓存也没有 → `url()` 返回空串，页面**不显示插画**（退回纯文字空态，绝不出现破图）
 *
 * 用法（页面里）：
 *   const assets = require('../../utils/assets.js')
 *   assets.ensure().then(() => this.setData({ emptyPic: assets.url('empty.wardrobe') }))
 *
 * 为什么不在页面里直接发请求：一屏里可能要用好几张图，ensure() 一次会话只请求一次。
 */
const api = require('./api.js')

/**
 * 包内的本地图（2026-09 真机踩坑后加的兜底层）
 *
 * 为什么必须有：开发者工具里勾了"不校验合法域名"、也不挑图片格式，本地看着都好；
 * 真机上会栽在两件事上 ——
 *   1 **iOS 的 image 组件不认 webp**（第一版图是 webp，真机白屏）
 *   2 网络图受"downloadFile 合法域名"限制（OSS 域名没进白名单 → 加载不出来）
 * 所以图片本体放进小程序包（PNG/JPG），一定能显示；后端下发的 URL 只是**可选覆盖**
 * （想"在服务器上换图、不发版"时把 URL 填进后端 assets 表即可）。
 */
const LOCAL = {
  'empty.wardrobe': '/images/art/empty-wardrobe-v2.png',
  'empty.outfit.v2': '/images/art/empty-outfit-v2.png',
  'empty.outfit':   '/images/art/empty-outfit.png',
  'empty.calendar': '/images/art/empty-calendar.png',
  'about.hero':     '/images/art/about-hero.jpg',
  // 衣橱页顶部「N 件衣物」那一栏右侧的小插画（2026-09 用户：这一栏太单一了）
  'wardrobe.header': '/images/art/wardrobe-header.png'
}

const STORE_KEY = 'assetUrls'     // 本地下次开小程序还在，避免每次启动都空一下
let mem = null                    // 本次会话的内存缓存
let inflight = null               // 正在拉的请求（并发调用只发一次）

/** 当前已知的 URL 表（内存 → 本地存储 → 空表） */
function current() {
  if (mem) return mem

  try {
    const local = wx.getStorageSync(STORE_KEY)
    mem = (local && typeof local === 'object') ? local : {}
  } catch (e) {
    mem = {}
  }
  return mem
}

/**
 * 保证拿到一份 URL 表（一次会话只请求一次；失败就用手上的缓存）
 * @return {Promise<object>} 可能为空表（表示"这次没图可用"）
 */
function ensure() {
  if (inflight) return inflight

  inflight = api.assets().then((d) => {
    const items = (d && d.items) || null
    if (items && typeof items === 'object') {
      mem = items
      try {
        wx.setStorageSync(STORE_KEY, items)
      } catch (e) {
        // 存储写不进去也不影响这次显示
      }
    }
    return current()
  }).catch(() => current())

  return inflight
}

/** 后端下发的 URL（没有/被后端关掉 → 空串） */
function url(name) {
  return current()[name] || ''
}

/**
 * 页面直接用这个：**有后端 URL 就用后端的，没有就用包内的本地图**
 * 远端图加载失败时，页面还可以调 fallback() 换回本地图（binderror 里用）
 */
function pick(name) {
  return url(name) || LOCAL[name] || ''
}

/** 这一张的包内本地图（远端加载失败时的退路；没有本地图就返回空串） */
function fallback(name) {
  return LOCAL[name] || ''
}

module.exports = { ensure, url, pick, fallback, LOCAL }
