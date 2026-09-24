/**
 * 本地数据层（一期纯本地，无后端）
 *
 * 存储键：clothes_items / clothes_outfits / clothes_wear / clothes_pending_items / clothes_pending_photos
 * 二期接后端时，只需要把这里的读写换成接口调用，页面不用改。
 *
 * 衣物对象：{ id, name, category, colors[], seasons[], occasions[], image, createdAt }
 * 搭配对象：{ id, name, occasions[], itemIds[], slots[], photo, photoFor, createdAt }
 *   slots = 长度 9 的位置表（衣物 id 或 null），用户在预览页拖拽决定；老数据没有这个字段（读取时自动落位）
 */

const mock = require('./mock.js')
const layout = require('./outfit-layout.js')

const K_ITEMS = 'clothes_items'
const K_OUTFITS = 'clothes_outfits'
const K_WEAR = 'clothes_wear'          // 日历：{'YYYY-MM-DD': 搭配 id}
const K_PENDING = 'clothes_pending_items'  // 编辑搭配时「挑了但还没点完成」的衣物：{ 搭配id: [衣物id] }

function read(key, fallback) {
  const v = wx.getStorageSync(key)
  return v || fallback
}

function write(key, value) {
  wx.setStorageSync(key, value)
}

// ===== 衣物 =====

function getItems() {
  return read(K_ITEMS, [])
}

function getItem(id) {
  return getItems().find(i => i.id === id) || null
}

/**
 * 新增或更新衣物（无 id 视为新增）
 */
function saveItem(item) {
  const list = getItems()
  if (!item.id) {
    item.id = 'i' + Date.now()
    item.createdAt = Date.now()
    list.unshift(item)
  } else {
    const idx = list.findIndex(i => i.id === item.id)
    if (idx >= 0) list[idx] = item
    else list.unshift(item)
 }
 write(K_ITEMS, list)
 return item
 }

function deleteItem(id) {
  write(K_ITEMS, getItems().filter(i => i.id !== id))
}

/**
 * 这件衣服被哪些搭配引用（删衣服前用它提示，避免静默产生悬挂引用）
 */
function outfitsUsingItem(id) {
  return getOutfits().filter(o => (o.itemIds || []).indexOf(id) >= 0)
}

// ===== 搭配 =====

function getOutfits() {
  return read(K_OUTFITS, [])
}

function getOutfit(id) {
  return getOutfits().find(o => o.id === id) || null
}

function saveOutfit(outfit) {
  const list = getOutfits()
  if (!outfit.id) {
    outfit.id = 'o' + Date.now()
    outfit.createdAt = Date.now()
    list.unshift(outfit)
  } else {
    const idx = list.findIndex(o => o.id === outfit.id)
    if (idx >= 0) list[idx] = outfit
    else list.unshift(outfit)
  }
  write(K_OUTFITS, list)
  return outfit
}

function deleteOutfit(id) {
  const o = getOutfit(id)
  // 顺手把生成的穿搭图片删掉，别在本机堆垃圾图片
  if (o && o.photo) {
    try { wx.getFileSystemManager().unlinkSync(o.photo) } catch (e) { /* 文件不在了就算了 */ }
  }
  write(K_OUTFITS, getOutfits().filter(i => i.id !== id))
}

// ===== 新建搭配的「草稿」（2026-09 用户定的口径）=====
/**
 * 「新建搭配」页只负责**挑衣物**（按钮叫「选择搭配」）；点预览页的「完成」才算真正保存。
 * 做法：草稿也是一条 outfits 记录（`draft: true`）——
 *  - 预览页照旧按 id 读写（拖拽换位、改名/改场合即时存盘都不用改）
 *  - **列表 / 日历 / 搭配数量只认非草稿**（`outfitCards()` 过滤）→ 用户看不到半成品
 *  - 点「完成」= `commitDraft`（摘掉标记，从此出现在列表里）
 *  - 从预览页直接返回 = `dropDrafts`（丢掉草稿，等于没建过）
 */
function createDraft(payload) {
  dropDrafts()                                    // 上一次没走完的草稿不留
  const o = Object.assign({ name: '', occasions: [], itemIds: [] }, payload || {})
  o.draft = true
  o.id = 'o' + Date.now()
  o.createdAt = Date.now()
  const list = getOutfits()
  list.unshift(o)
  write(K_OUTFITS, list)
  return o
}

/** 点「完成」：草稿转正（id 不变，位置/封面都写在它身上了） */
function commitDraft(id) {
  const list = getOutfits()
  const o = list.find(x => x.id === id)
  if (!o) return null
  delete o.draft
  write(K_OUTFITS, list)
  return o
}

/** 丢掉所有草稿（进「新建搭配」时清旧的 + 从预览页返回时清当前的），返回丢了几条 */
function dropDrafts() {
  const list = getOutfits()
  const keep = list.filter(o => !o.draft)
  if (keep.length !== list.length) write(K_OUTFITS, keep)
  return list.length - keep.length
}

// ===== 「编辑搭配」里挑了但还没确认的衣物（跟新建搭配同一套口径：点「完成」才算保存）=====
/**
 * 编辑搭配时，挑选页把这次选的衣物挂在这里（**不动搭配本身的 itemIds**），
 * 预览页打开时取一次（`takePendingItems`）→ 按它渲染 9 格 → 点「完成」才写回搭配；
 * 用户不点完成直接返回，这次改动就等于没发生（数据从没被改过，所以绝对安全）。
 */
function setPendingItems(outfitId, itemIds) {
  if (!outfitId) return
  const m = read(K_PENDING, {})
  m[outfitId] = itemIds || []
  write(K_PENDING, m)
}

/** 取一次就清掉（预览页 onShow 里调；没有待确认的返回 null） */
function takePendingItems(outfitId) {
  const m = read(K_PENDING, {})
  const v = m[outfitId]
  if (v) {
    delete m[outfitId]
    write(K_PENDING, m)
  }
  return v || null
}

/** 丢掉某个搭配待确认的选择（不用调也行：没写进搭配就等于没保存） */
function clearPendingItems(outfitId) {
  const m = read(K_PENDING, {})
  if (m[outfitId]) {
    delete m[outfitId]
    write(K_PENDING, m)
  }
}

/**
 * 用云端数据覆盖本机缓存（2026-09 口径：**MySQL 是真相，本机只是渲染用的镜像**）
 *  - 草稿（新建搭配还没点「完成」）和待确认衣物是本机专属，保留
 *  - 照片/封面的**本机专属字段只在「云端还没有地址」时保留**（2026-09 图片改异步上传后新增）：
 *      imageUrl 有值 → 本机路径可以弃（显示走 OSS）
 *      imageUrl 为空 → 说明这条的照片还在后台补传，必须留住本机路径，
 *                      否则下一次 pull 就把路径洗掉，列表上照片凭空变色块（本机文件其实还在）
 *  - 断网/接口失败时不会走到这里（调用方拿不到数据，界面继续用旧缓存）
 *
 * @param {object} data 接口回包 { items, outfits, wears }
 * @return {object} { changed, items, outfits, wears }
 */
function replaceCache(data) {
  const d = data || {}
  const before = JSON.stringify([getItems(), getOutfits(), wearMap()])

  // 合并要用的本机旧记录（按 id 找，判断有没有「还没上云的本机图」）
  const oldItems = {}
  getItems().forEach(i => { oldItems[i.id] = i })
  const oldOutfits = {}
  getOutfits().forEach(o => { oldOutfits[o.id] = o })

  const items = (d.items || []).map(ci => {
    const old = oldItems[ci.id] || {}
    return {
      id: ci.id,
      name: ci.name || '',
      category: ci.category || '',
      sub: ci.sub || '',
      colors: ci.colors || [],
      seasons: ci.seasons || [],
      occasions: ci.occasions || [],
      imageUrl: ci.imageUrl || '',
      // 照片存在哪（后端算好的：oss / local）—— 衣橱格子挂牌用；老版本后端不返回就是空串
      imageStorage: ci.imageStorage || '',
      // 洗白底（2026-09）：原图 / 白底图 / 当前封面是不是白底图（记录衣物页靠这三个判断状态）
      originalImageUrl: ci.originalImageUrl || '',
      normalizedUrl: ci.normalizedUrl || '',
      isWhite: !!ci.isWhite,
      // 云端没地址 → 沿用本机那张（后台补传的源，也是列表当前的显示源）
      image: ci.imageUrl ? '' : (old.image || ''),
      createdAt: ci.createdAt || 0
    }
  }).sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0))

  const drafts = getOutfits().filter(o => o.draft)
  const outfits = (d.outfits || []).map(co => {
    const old = oldOutfits[co.id] || {}
    return {
      id: co.id,
      name: co.name || '',
      nameAuto: !!co.nameAuto,
      occasions: co.occasions || [],
      itemIds: co.itemIds || [],
      slots: co.slots || [],
      coverUrl: co.coverUrl || '',
      // 封面存在哪（后端算好的：oss / local）—— 穿搭列表挂牌用
      coverStorage: co.coverStorage || '',
      // 同上：封面还没上云时留住本机 canvas 那张
      photo: co.coverUrl ? '' : (old.photo || ''),
      photoFor: co.coverUrl ? '' : (old.photoFor || ''),
      createdAt: co.createdAt || 0
    }
  }).sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0))

  const wears = {}
  Object.keys(d.wears || {}).forEach(k => { if (d.wears[k]) wears[k] = d.wears[k] })

  const allOutfits = drafts.concat(outfits)
  const changed = before !== JSON.stringify([items, allOutfits, wears])

  write(K_ITEMS, items)
  write(K_OUTFITS, allOutfits)
  write(K_WEAR, wears)

  return {
    changed,
    items: items.length,
    outfits: outfits.length,
    wears: Object.keys(wears).length
  }
}

/** 按一组 itemIds 现算卡片数据：编辑搭配时预览「这次新选的衣物」（还没写进搭配）
 *  base 传搭配本身的记录 → 名字/场合/封面都还在，只换 itemIds/slots
 *  ⚠️ 不传 base 的话卡片里 occasions 会是空数组，页面上 persist() 跟着写回去就把场合洗掉了（踩过） */
function cardOfItems(itemIds, slots, base) {
  const src = Object.assign({}, base || {}, {
    id: (base && base.id) || '__pending__',
    itemIds: itemIds || [],
    slots: slots || []
  })
  return cardsFrom([src])[0]
}

/** 穿搭图片的排版版本：改了出图排版就改这里，让老图自动失效 */
const PHOTO_SIG_V = 'v3'

/**
 * 把搭配展开成可直接渲染的卡片数据：附上每件衣服的展示信息
 * （没有照片时给色块 + 品类图标，保证搭配页不依赖照片）
 * items 按「位置表」顺序排（用户拖过就是用户排的顺序）：列表缩略图取第一件、出图按这个顺序画
 */
function outfitCards() {
  // 草稿（新建搭配还没点「完成」）不进列表：列表/日历/数量都只认「真正保存过」的搭配
  return cardsFrom(getOutfits().filter(o => !o.draft))
}

/** 单条搭配的卡片数据：预览页要用（草稿也给它卡，不然新建流程一进预览页就显示「不在了」） */
function draftCard(id) {
  const o = getOutfit(id)
  return (o && o.draft) ? cardsFrom([o])[0] : null
}

/** 把一批搭配记录展开成卡片数据（outfitCards / draftCard 共用） */
function cardsFrom(outfits) {
  const items = getItems()
  const byId = {}
  items.forEach(i => { byId[i.id] = i })

  return outfits.map(o => {
    const ids = o.itemIds || []
    const picked = ids.map(id => byId[id]).filter(Boolean)
    const slots = layout.normalizeSlots(picked, o.slots)
    const ordered = layout.orderedBySlots(picked, slots)
    return {
      id: o.id,
      name: o.name || '未命名搭配',
      occasions: o.occasions || [],
      count: picked.length,
      // 已删除的衣服单独计数，卡片上提示，不静默忽略
      missing: ids.length - picked.length,
      slots,
      // 穿搭图片：直接用存的那张（**只有预览页点「完成」才会重出**，见 outfit-view.js）。
      // 以前是「签名对不上就不显示」，会出现「改了内容封面凭空消失」，用户改规则为：图只在点完成时变化
      // 封面：本机 canvas 那张优先（快、断网也能看），本机没了才用云端那张（换手机/清缓存）
      photo: o.photo || o.coverUrl || '',
      // 远程封面地址 + 它存在哪（oss / local）—— 穿搭列表挂牌要看这两个（photo 是「本机优先」的合并值，不能拿它判存储位置）
      coverUrl: o.coverUrl || '',
      coverStorage: o.coverStorage || '',
      items: ordered.map(i => {
        const b = mock.blockOf(i.colors)
        return {
          id: i.id,
          // 品类：自动落位（老数据/新增衣物）时用来决定默认放哪一格
          category: i.category,
          // 本地图优先（canvas 出图也用这个路径，本机最稳），本地没了才回退上传后的远程地址
          image: i.image || i.imageUrl || '',
          emoji: mock.categoryOf(i.category).emoji,
          color: b.hex,
          light: b.light,
          name: i.name || mock.categoryOf(i.category).name
        }
      })
    }
  })
}

/**
 * 这条搭配当前的「内容签名」（含 9 格位置）
 * 现在只用来记录「这张图是按什么内容出的」（photoFor），不再用它拦显示
 */
function outfitSig(id) {
  const o = getOutfit(id)
  if (!o) return ''
  const byId = {}
  getItems().forEach(i => { byId[i.id] = i })
  const picked = (o.itemIds || []).map(x => byId[x]).filter(Boolean)
  const slots = layout.normalizeSlots(picked, o.slots)
  return PHOTO_SIG_V + '|' + slots.map(x => x || '').join(',')
}

/**
 * 记录生成的穿搭图片
 * @param {string} id 搭配 id
 * @param {string} path 本机图片路径（wx.env.USER_DATA_PATH 下）
 * @param {string} sig 生成时的内容签名（outfitSig）
 */
function setOutfitPhoto(id, path, sig) {
  const o = getOutfit(id)
  if (!o) return
  o.photo = path
  o.photoFor = sig
  saveOutfit(o)
}

/**
 * 记录封面传上 OSS 之后的地址（换手机也能看到这套搭配长什么样）
 * 传过一次就不用重复传（跟衣物照片补传「有 imageUrl 就跳过」同一口径）
 */
function setOutfitCoverUrl(id, url) {
  const o = getOutfit(id)
  if (!o || !url || o.coverUrl === url) return
  o.coverUrl = url
  saveOutfit(o)
}

// ===== 穿搭日历（哪天穿了哪套）=====

/**
 * 日历记录：{ 'YYYY-MM-DD': 搭配 id }，**一天只记一套**（用户 2026-09 定）
 *
 * 只存搭配 id（不存快照）：搭配改名/换封面，日历跟着变；搭配被删了 id 还留着，
 * 日历上那天显示「这套已删除」（用户选的口径，不做图片副本、不占空间）
 */
function wearMap() {
  const m = read(K_WEAR, {})
  return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {}
}

/** 某天记的是哪套（没记返回空串） */
function wearOf(date) {
  return wearMap()[date] || ''
}

/**
 * 记/清某天的搭配
 * @param {string} date 'YYYY-MM-DD'
 * @param {string} outfitId 传空串 = 清除这天的记录
 */
function setWear(date, outfitId) {
  const m = wearMap()
  if (outfitId) m[date] = outfitId
  else delete m[date]
  write(K_WEAR, m)
  return m
}

/** 清除某天的记录 */
function clearWear(date) {
  return setWear(date, '')
}

/** 这个月记了几天（前缀 'YYYY-MM'） */
function wearDaysInMonth(prefix) {
  return Object.keys(wearMap()).filter(k => k.indexOf(prefix) === 0).length
}

// ===== 录入流程的临时照片（2026-09 改批量多选：单张 → 队列）=====

const K_PENDING_PHOTOS = 'clothes_pending_photos'   // 待录入照片的本机路径（数组，先进先出）

/**
 * 「＋」选完照片先落盘、进这个队列，再进录入页一张张填。
 *
 * 为什么放 storage 而不是模块变量：一次能选好几张，中途退出小程序不能让人白选 ——
 * 下次点「＋」时问「还有 N 张没录完，继续还是丢掉」。
 */
function pendingPhotos() {
  return read(K_PENDING_PHOTOS, []) || []
}

function pendingPhotoCount() {
  return pendingPhotos().length
}

/** 追加一批（多选时用），返回队列长度 */
function pushPendingPhotos(paths) {
  const list = pendingPhotos().concat((paths || []).filter(Boolean))
  write(K_PENDING_PHOTOS, list)
  return list.length
}

/** 取队首那张（取走即出队）；空队列返回 '' */
function takePendingPhoto() {
  const list = pendingPhotos()
  if (!list.length) return ''
  const first = list.shift()
  write(K_PENDING_PHOTOS, list)
  return first
}

/** 丢掉整个队列：还没录入的本机照片文件一起删掉，别在用户目录里堆垃圾 */
function dropPendingPhotos() {
  pendingPhotos().forEach(p => {
    try { wx.getFileSystemManager().unlinkSync(p) } catch (e) { /* 文件不在了就算了 */ }
  })
  wx.removeStorageSync(K_PENDING_PHOTOS)
}

/**
 * 录完某一张后把它从队列里去掉（按路径删，不是只删队首）
 *
 * 2026-09 支持「点缩略图挑哪张填哪张」之后，录入顺序不再固定，所以要能删中间任意一张。
 * 队列本身**一直保留整批**（进录入页也不清空），只有这条真正保存成功才摘掉它 ——
 * 中途切来切去、退出小程序都不会丢。
 */
function removePendingPhoto(path) {
  const list = pendingPhotos()
  const idx = list.indexOf(path)
  if (idx < 0) return list.length
  list.splice(idx, 1)
  write(K_PENDING_PHOTOS, list)
  return list.length
}

/** 换掉队列里的某一张（录入页点「换一张」）：位置不动，只把路径换掉 */
function replacePendingPhoto(oldPath, newPath) {
  if (!newPath) return pendingPhotos().length
  const list = pendingPhotos()
  const idx = oldPath ? list.indexOf(oldPath) : -1
  if (idx >= 0) list[idx] = newPath
  else list.push(newPath)
  write(K_PENDING_PHOTOS, list)
  return list.length
}

// ===== 清理一期遗留的演示数据 =====

/**
 * 清掉一期自动填充的演示数据（12 件「基础白T」那种 + 3 套搭配，id 形如 m01 / o01）
 *
 * 2026-09 用户要求：**演示数据整个不要了**（不看环境，正式测试都不要）。
 * 自动填充的逻辑已经删掉，但装过老版本的人本机缓存里还留着这批假数据 ——
 * 而且它会让用户误以为「我没登录怎么有数据」，所以启动时扫一遍按 id 形状清掉。
 *
 * 认 id 形状而不是认名字：用户自己录的 id 是 i<时间戳> / o<时间戳>，永远匹配不上 /^[mo]\d{2}$/。
 *
 * @return {{items: string[], outfits: string[]}} 清掉了哪些 id（云端可能也有一份，调用方负责同步删）
 */
function purgeDemoData() {
  const isDemo = (id) => /^[mo]\d{2}$/.test(String(id || ''))

  const items = getItems()
  const outfits = getOutfits()
  const goneItems = items.filter(i => isDemo(i.id)).map(i => i.id)
  const goneOutfits = outfits.filter(o => isDemo(o.id)).map(o => o.id)

  if (goneItems.length) write(K_ITEMS, items.filter(i => goneItems.indexOf(i.id) < 0))
  if (goneOutfits.length) write(K_OUTFITS, outfits.filter(o => goneOutfits.indexOf(o.id) < 0))

  return { items: goneItems, outfits: goneOutfits }
}

/**
 * 清空全部数据（本机缓存）
 */
function clearAll() {
  wx.removeStorageSync(K_ITEMS)
  wx.removeStorageSync(K_OUTFITS)
  wx.removeStorageSync(K_WEAR)
  wx.removeStorageSync(K_PENDING)
  wx.removeStorageSync(K_PENDING_PHOTOS)
}

module.exports = {
  getItems,
  getItem,
  saveItem,
  deleteItem,
  outfitsUsingItem,
  getOutfits,
  getOutfit,
  outfitSig,
  setOutfitPhoto,
  setOutfitCoverUrl,
  saveOutfit,
  deleteOutfit,
  createDraft,
  commitDraft,
  dropDrafts,
  setPendingItems,
  takePendingItems,
  clearPendingItems,
  cardOfItems,
  outfitCards,
  draftCard,
  wearMap,
  wearOf,
  setWear,
  clearWear,
  wearDaysInMonth,
  replaceCache,
  pendingPhotos,
  pendingPhotoCount,
  pushPendingPhotos,
  takePendingPhoto,
  removePendingPhoto,
  replacePendingPhoto,
  dropPendingPhotos,
  purgeDemoData,
  clearAll
}
