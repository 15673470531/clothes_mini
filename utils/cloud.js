/**
 * 数据上云网关（2026-09 二期第三步：改成「MySQL 为准」）
 *
 * 口径（用户拍板）：
 *  - **数据（衣物/搭配/日历）以 MySQL 为准**：每次增删改都等接口成功才算数
 *  - 本机 storage 只当**渲染缓存**（进页面秒出画面），不再接受离线修改
 *  - **照片是异步上传的**（2026-09 改）：记录先提交（=保存成功，可以走），
 *    本机照片路径留在记录里照常显示，flushUploads() 后台补传到 OSS →
 *    成功再把 imageUrl 提交一次。图没传上去不拦人，衣橱格子有「待上传」角标
 *  - 草稿（新建搭配没点「完成」）、待确认衣物、登录态：仍在本机（它们是「还没保存」的东西）
 *  - 断网/失败：**明确提示 + 界面不动**（不再静默排队重试）—— 这条只针对数据，
 *    照片失败是「留在本机下次再传」（它本来就不在云端，谈不上丢真相）
 *
 * 页面的用法：
 *   onShow  →  cloud.ready()                        拉最新数据刷缓存 + 补传没上云的照片
 *   写      →  cloud.commit(乐观改缓存, 发请求)      先变界面；失败自动拉回云端 + 抛错给调用方提示
 *   存衣物  →  cloud.saveItem(payload)              记录立刻提交，照片后台传
 */
const store = require('./store.js')
const api = require('./api.js')

const MIGRATED = 'clothes_migrated'   // 老版本本机数据是否已经搬上云端（只做一次）
let _pulling = false
let _pullAt = 0
let _flushPromise = null   // 正在跑的那一轮照片补传（同时在跑的调用跟着它一起等，不再起一轮）

/** 衣物 → 接口字段（记录里只留 OSS 地址，本机临时图路径不上云） */
function toCloudItem(it) {
  return {
    id: it.id,
    name: it.name || '',
    category: it.category || '',
    sub: it.sub || '',
    colors: it.colors || [],
    seasons: it.seasons || [],
    occasions: it.occasions || [],
    imageUrl: it.imageUrl || '',
    // 洗白底（2026-09）：原图 / 白底图。**每次推都要带上**——
    // 后端按"请求里有没有这个键"决定要不要改这两列，漏带不会清空，但带上才是最新真相
    originalImageUrl: it.originalImageUrl || '',
    normalizedUrl: it.normalizedUrl || '',
    createdAt: it.createdAt || 0
  }
}

function toCloudOutfit(o) {
  return {
    id: o.id,
    name: o.name || '',
    nameAuto: !!o.nameAuto,
    occasions: o.occasions || [],
    itemIds: o.itemIds || [],
    slots: o.slots || [],
    coverUrl: o.coverUrl || '',
    createdAt: o.createdAt || 0
  }
}

/** 一个写请求（批量推：{items|outfits|wears|deleted}） */
function push(payload) {
  return api.clothes.syncPush(payload)
}

// ===== 读 =====

/**
 * 拉云端全量 → 覆盖本机缓存（草稿/待确认是本机专属，保留）
 * @return {Promise<object>} { changed, items, outfits, wears }
 */
function pull() {
  if (!api.isLoggedIn()) return Promise.resolve({ skipped: 'not-logged-in' })
  if (_pulling && Date.now() - _pullAt < 5000) return Promise.resolve({ skipped: 'pulling' })

  _pulling = true
  _pullAt = Date.now()
  return api.clothes.syncPull()
    .then((data) => store.replaceCache(data))
    .catch((err) => {
      console.log('[cloud] 拉取失败（界面继续用本机缓存）：', (err && err.msg) || err)
      return { error: true, msg: (err && err.msg) || '网络异常' }
    })
    .then((r) => { _pulling = false; return r })
}

// ===== 写 =====

/**
 * 带「乐观更新」的写操作（用户 2026-09 拍板：点了界面立刻就变，失败了回滚 + 提示）
 *   1. 先改本机缓存（调用方给 applyLocal）
 *   2. 发请求；成功就完事
 *   3. 失败 → 重新拉一次云端把缓存还原成真相，再把错误抛给调用方（页面弹提示）
 *
 * @param {function} applyLocal 改本机缓存（同步函数，调用方顺手 refresh 界面）
 * @param {function} request    返回 Promise 的真请求
 */
function commit(applyLocal, request) {
  try { applyLocal() } catch (e) { console.log('[cloud] 乐观更新出错（继续发请求）：', e && e.message) }

  return request().catch((err) => {
    console.log('[cloud] 写失败，回滚界面：', (err && err.msg) || err)
    return pull().then(() => { throw err })
  })
}

/**
 * 上传这条衣物还没有远程地址的照片（临时图片 → OSS）
 * 传完清掉本机路径并删掉临时文件（记录里只留 OSS 地址）
 * @param {object} item 记录（会被就地修改）
 * @param {function} onStep 可选：上报进度文案（页面显示「上传照片…」）
 */
function ensurePhoto(item, onStep) {
  if (!item.image || item.imageUrl || !api.isLoggedIn()) return Promise.resolve(item)
  if (onStep) onStep('上传照片…')

  const local = item.image
  return api.uploadImage(local, 'clothes', { silent: true }).then((out) => {
    item.imageUrl = out.url
    item.imageStorage = out.driver || ''               // oss / local（挂牌用）
    item.image = ''                                  // 本机路径不再是真相，清掉（显示改走 OSS 地址）
    try { wx.getFileSystemManager().unlinkSync(local) } catch (e) { /* 删不掉就算了 */ }
    return item
  })
}

/**
 * 存一件衣物（新增或修改）：**先提交记录，照片放后台传**（2026-09 图片改异步上传）
 *
 * 为什么不等图：一张照片要「小程序 → 后端 → OSS」两跳，弱网下好几秒，
 * 而「再记一件」是连着录，每件都卡一次上传体验很差。
 * 做法：记录（不含 OSS 地址）先提交成功 = 保存成功，可以走；
 *       本机照片路径留在记录里（列表照常显示），flushUploads() 后台补传，
 *       传成功再把 imageUrl 提交一次、清掉本机文件。
 * 图没传上去不拦人（跟搭配封面一个口径）；衣橱格子上有「待上传」角标提示。
 * 真正的失败（记录本身没提交上）照旧抛给页面弹提示，口径不变。
 *
 * @param {object} payload 记录（无 id = 新增，函数会给它生成 id）
 * @param {function} onStep 可选：进度文案回调
 * @return {Promise<object>} 提交成功的记录（此时照片可能还在后台传）
 */
function saveItem(payload, onStep) {
  const item = Object.assign({}, payload)
  item.imageUrl = item.imageUrl || ''     // 统一口径：还没上云就是空串（缓存里也带这个字段）
  if (!item.id) {
    item.id = 'i' + Date.now()
    item.createdAt = Date.now()
  }

  if (onStep) onStep('保存中…')
  return push({ items: [toCloudItem(item)] }).then(() => {
    store.saveItem(item)      // 成功才写进缓存（真相在云端）；本机照片路径留着，等后台补传
    flushUploads()            // 不 await：后台把照片传上去
    return item
  })
}

/**
 * 批量存（「剩下几张都用这套属性」用）：**一次请求提交多条记录**，再各起一轮后台上传
 *
 * 为什么合并成一次：选 5 张套属性会一次生成 5 条，逐条发就是 5 个请求；
 * 接口本来就收数组（POST /clothes/sync 的 items），一次推完更省。
 * 失败口径跟单条一样：整批没提交成功就抛给调用方（页面弹提示，不做半个批次）。
 *
 * @param {Array} list 记录数组（每条要有 id；照片走 image 本机路径，后台补传）
 * @param {function} onStep 可选：进度文案回调
 * @return {Promise<Array>} 提交成功的记录
 */
function saveItems(list, onStep) {
  const items = (list || []).filter(Boolean).map(p => {
    const it = Object.assign({}, p)
    it.imageUrl = it.imageUrl || ''
    return it
  })
  if (!items.length) return Promise.resolve([])

  if (onStep) onStep('保存中…')
  return push({ items: items.map(toCloudItem) }).then(() => {
    items.forEach(it => store.saveItem(it))   // 成功才写缓存（真相在云端）
    flushUploads()                            // 不 await：照片后台一张张传
    return items
  })
}

/**
 * 删一件衣物（连带删 OSS 上的图由后端负责）
 * 还没上云的照片（本机路径 + 本机文件）：删成功后在页面侧顺手清掉，别在磁盘上留垃圾
 * （补传队列还没扫到它就被删了，队列不会知道有过这张图）
 */
function removeItem(id) {
  const old = store.getItem(id) || {}
  return push({ deleted: { items: [id] } }).then(() => {
    store.deleteItem(id)                // 成功才从缓存删（乐观更新由调用方先做）
    if (old.image) {
      try { wx.getFileSystemManager().unlinkSync(old.image) } catch (e) { /* 删不掉就算了 */ }
    }
    return true
  })
}

/**
 * 存一套搭配：先传封面（如有新出的图）→ 再提交
 * @param {object} outfit 记录
 * @param {string} coverLocal 可选：新出的封面本机路径（canvas 导出的）
 */
function saveOutfit(outfit, coverLocal) {
  const o = Object.assign({}, outfit)

  const uploadCover = () => {
    if (!coverLocal || !api.isLoggedIn()) return Promise.resolve(o)
    return api.uploadImage(coverLocal, 'outfit', { silent: true }).then((out) => {
      o.coverUrl = out.url
      o.coverStorage = out.driver || ''            // oss / local（穿搭列表挂牌用）
      return o
    }).catch((err) => {
      // 封面没传上去不拦人：搭配本身照样保存（下次点完成会重出封面再传）
      console.log('[cloud] 封面没传上去（不影响搭配保存）：', (err && err.msg) || err)
      return o
    })
  }

  return uploadCover().then(() => push({ outfits: [toCloudOutfit(o)] }).then(() => {
    store.saveOutfit(o)
    return o
  }))
}

function removeOutfit(id) {
  return push({ deleted: { outfits: [id] } }).then(() => {
    store.deleteOutfit(id)
    return true
  })
}

/**
 * 记/清某天的穿搭
 * @param {string} date 'YYYY-MM-DD'
 * @param {string} outfitId 空串 = 清除
 */
function setWear(date, outfitId) {
  const wears = {}
  wears[date] = outfitId || ''
  return push({ wears }).then(() => {
    store.setWear(date, outfitId)
    return true
  })
}

/**
 * 清空这个用户的全部数据（云端真删 + 本机缓存清掉）
 * 2026-09 口径：数据在 MySQL 里，只清本机缓存没意义（下次拉取又回来了）
 */
function clearAllData() {
  const items = store.getItems().map(i => i.id)
  const outfits = store.getOutfits().map(o => o.id)
  if (!items.length && !outfits.length) {
    store.clearAll()
    return Promise.resolve(true)
  }
  return push({ deleted: { items, outfits } }).then(() => {
    store.clearAll()
    return true
  })
}

/**
 * 后台补传：把「本机有照片、云端还没地址」的衣物照片传到 OSS（2026-09 图片改异步上传）
 *
 * 队列不落 storage —— 直接扫记录（`image` 有、`imageUrl` 空）就是待传清单：
 * 幂等、不用维护队列状态，中途挂了（退小程序/断网）下一次进来接着传。
 * 串行上传，别把弱网挤爆；单张失败只跳过它，本机文件留着下次再传。
 *
 * 顺序刻意是「先传图 → 再提交 imageUrl → 最后才清本机文件和路径」：
 * 提交失败时记录里还留着本机路径，下一轮能重传（代价是那次的 OSS 对象成孤儿，罕见可接受）。
 *
 * 两个并发口径：
 *  - 已经有一轮在跑时，调用方拿到的是同一个 Promise（不叠加请求；页面 .then 里照样能刷新界面）
 *  - 一趟里最多扫三遍：等着的时候又存了新照片（第一遍清单里没有它）也能在这一趟里传完
 *
 * @return {Promise<{uploaded:number, failed:number}>}
 */
// 衣架不够（2026-09 第三版：额度＝衣架，一件衣物 / 一套搭配 各占一个）
const ITEM_LIMIT_CODE = 4001   // 后端「总共的衣架不够了（含这次要挂的比剩的多）」
const DAILY_LIMIT_CODE = 4002  // 后端「今天的衣架不够了」

let quotaBlocked = false          // 本机这次运行里额度已用完（照片留着，明天/重开再传）
let quotaBlockedTold = false      // 提示只弹一次

function flushUploads() {
  if (_flushPromise) return _flushPromise
  if (!api.isLoggedIn()) return Promise.resolve({ uploaded: 0, failed: 0 })

  const attempted = {}      // 这一趟已经试过的（失败的当趟不重试，免得白跑网络）
  let ok = 0
  let bad = 0

  /** 扫一遍待传清单（跳过这趟已经试过的） */
  const round = () => {
    const todo = store.getItems().filter(i => i.image && !i.imageUrl && !attempted[i.id])
    if (!todo.length) return Promise.resolve()
    todo.forEach(i => { attempted[i.id] = true })

    const next = (n) => {
      if (n >= todo.length) return Promise.resolve()
      const it = todo[n]

      // 排队期间这条被删了：别把删掉的又推回云端，本机文件顺手清掉
      if (!store.getItem(it.id)) {
        try { wx.getFileSystemManager().unlinkSync(it.image) } catch (e) { /* 删不掉就算了 */ }
        return next(n + 1)
      }

      const local = it.image
      return api.uploadImage(local, 'clothes', { silent: true }).then((out) => {
        // 传完再读一次记录：等待期间用户可能又改过/删过（别拿老快照把新改动盖回去）
        const cur = store.getItem(it.id)
        if (!cur) return                       // 期间被删了：这次传的图作废（OSS 上留个孤儿，罕见）
        if (cur.image !== local) return         // 期间换了照片：这次传的作废，新图留给下一轮传

        const record = Object.assign({}, cur, { imageUrl: out.url })
        return push({ items: [toCloudItem(record)] }).then(() => {
          cur.imageUrl = out.url
          cur.imageStorage = out.driver || ''          // 上传回包里就带 driver（oss / local）
          cur.image = ''                                   // 本机路径不再是真相，清掉（显示改走 OSS 地址）
          try { wx.getFileSystemManager().unlinkSync(local) } catch (e) { /* 删不掉就算了 */ }
          store.saveItem(cur)
          ok++
        })
      }).catch((err) => {
        bad++
        console.log('[cloud] 照片补传失败，留着下次再传：', (err && err.msg) || err)
        // 今天的上传额度用完了（后端 code 4002）：这趟别再一张张白试了，
        // 照片留在本机，明天打开小程序会自动接着传。提示只弹一次。
      }).then(() => next(n + 1))
    }

    return next(0)
  }

  _flushPromise = round().then(round).then(round).then(() => {
    _flushPromise = null
    return { uploaded: ok, failed: bad }
  })
  return _flushPromise
}

// ===== 老数据迁移（一次性）=====

/**
 * 把升级前存在本机的衣物/搭配/日历搬上云端（只做一次，搬完打标记）
 * 之后本机就只是缓存了
 */
function migrateIfNeeded() {
  if (wx.getStorageSync(MIGRATED)) return Promise.resolve({ migrated: false, reason: 'done' })
  if (!api.isLoggedIn()) return Promise.resolve({ migrated: false, reason: 'not-logged-in' })

  const items = store.getItems()
  const outfits = store.getOutfits().filter(o => !o.draft)
  const wears = store.wearMap()
  if (!items.length && !outfits.length && !Object.keys(wears).length) {
    wx.setStorageSync(MIGRATED, true)
    return Promise.resolve({ migrated: false, reason: 'nothing-to-migrate' })
  }

  console.log('[cloud] 首次迁移：本机 ' + items.length + ' 件衣物 / ' + outfits.length + ' 套搭配 / ' +
    Object.keys(wears).length + ' 天日历 → 云端')

  // 逐张传图（串行，别把弱网挤爆），然后再整批提交
  const uploadAll = (list, i) => {
    if (i >= list.length) return Promise.resolve(list)
    const it = list[i]
    return ensurePhoto(it).then(() => uploadAll(list, i + 1))
  }

  return uploadAll(items, 0)
    .then((done) => push({
      items: done.map(toCloudItem),
      outfits: outfits.map(toCloudOutfit),
      wears: wears
    }))
    .then(() => {
      // 迁移完打标记；本机缓存紧接着会被 pull() 里的云端数据覆盖成「已经上云」的样子
      wx.setStorageSync(MIGRATED, true)
      console.log('[cloud] 迁移完成')
      return { migrated: true, items: items.length, outfits: outfits.length }
    })
    .catch((err) => {
      console.log('[cloud] 迁移失败，下次进入再试：', (err && err.msg) || err)
      return { migrated: false, error: true, msg: (err && err.msg) || '网络异常' }
    })
}

/**
 * 清掉一期遗留的演示数据（本机 + 云端）
 *
 * 本机那份由 store.purgeDemoData() 按 id 形状认出来删掉；如果登录了、而且云端也有一份
 * （带着演示数据登录过就会推上去），顺手把云端那几条也删掉，否则下次 pull 又给拉回来。
 *
 * @return {Promise<object|null>} 有没有清（清了的 id 列表，用于日志）
 */
function purgeDemoData() {
  const gone = store.purgeDemoData()
  if (!gone.items.length && !gone.outfits.length) return Promise.resolve(null)

  console.log('[cloud] 清掉演示数据：' + gone.items.length + ' 件衣物 / ' + gone.outfits.length + ' 套搭配')
  if (!api.isLoggedIn()) return Promise.resolve(gone)

  return push({ deleted: gone })
    .then(() => gone)
    .catch((err) => {
      console.log('[cloud] 演示数据的云端副本没删掉（下次进页面再试）：', (err && err.msg) || err)
      return gone
    })
}

/**
 * 照片/封面存哪了 → 角标文案（三态；不挂牌返回 null）
 *
 *   待上传：本机有照片、云端还没地址（后台上传还没成功）
 *   OSS   ：云端有地址、后端说是对象存储
 *   服务器：云端有地址、后端说是服务器本地盘（没配 OSS 时的兜底）
 *
 * driver 优先用后端给的字段；老版本后端不返回时按 URL 形状兜底（含 /storage/ 就是本地盘）。
 * 判定口径集中在这里，衣橱和穿搭两页都调它，别各写一份。
 */
function storageBadge(driver, url) {
  if (!url) return null
  const d = driver || (String(url).indexOf('/storage/') >= 0 ? 'local' : 'oss')
  return { kind: d == 'local' ? 'local' : 'oss' }
}

/** 衣物的照片角标 */
function photoBadge(it) {
  if (!it) return null
  // 本机有照片、云端还没地址 = 还在排队补传
  if (it.image && !it.imageUrl) return { kind: 'wait' }
  return storageBadge(it.imageStorage, it.imageUrl)
}

/** 搭配封面的角标（封面还没上云不挂牌：本机 canvas 那张照常显示，不用提醒） */
function coverBadge(o) {
  return storageBadge(o && o.coverStorage, o && o.coverUrl)
}

/**
 * 页面 onShow 的统一入口：先清演示数据，再补迁移，然后拉最新，最后补传没上云的照片
 * @return {Promise<object>} { changed, migrated, upload:{uploaded,failed} }
 */
function ready() {
  return purgeDemoData()
    .then(() => migrateIfNeeded())
    .then((m) => pull().then((r) => flushUploads().then((u) =>
      Object.assign({}, r, { migrated: m.migrated, upload: u }))))
}

module.exports = {
  ready,
  ITEM_LIMIT_CODE,          // 4001：总衣架不够（页面弹「联系客服 / 去衣橱」）
  DAILY_LIMIT_CODE,         // 4002：今天的衣架用完了（页面弹「联系客服 / 知道了」）
  pull,
  clearAllData,
  push,
  commit,
  saveItem,
  saveItems,
  removeItem,
  saveOutfit,
  removeOutfit,
  setWear,
  ensurePhoto,
  flushUploads,
  purgeDemoData,
  storageBadge,
  photoBadge,
  coverBadge,
  toCloudItem,
  toCloudOutfit
}
