const personalTryon = require('../../utils/personal-tryon.js')
/**
 * 搭配预览：保存搭配之后进这页，9 个位置按用户排的样子摆出来，位置可以拖
 *
 *   0 1 | 6      左列两栏：上身(0,1) / 下身(2,3) / 脚(4,5)
 *   2 3 | 7      右列一栏：配饰(6,7,8)
 *   4 5 | 8
 *
 * 位置的真相在 utils/outfit-layout.js：搭配里存 slots（长度 9 的 id 数组）。
 * 老数据/新增的衣物由 normalizeSlots 自动落位（上装→0、外套→1…），用户拖过之后就按他拖的来。
 *
 * 交互（2026-09 用户定版）：
 *  - **空格不写品类提示**（虚线框 + 极淡的 ＋），点一下去挑选页，挑回来的第一件放这一格
 *  - **长按 0.25 秒后拖拽**：跟一个半透明「幽灵」走，落点格高亮；落到有衣物的格子 = 两件交换；
 *    拖到格子外松手 = 放回原位（不做「拖出去即移除」，防误删）
 *  - **每件衣物格子右上角一个 ×**：点它把这件从这套搭配里移出（衣物还在衣橱，随时加回来）；
 *    只剩一件时不让移（跟挑选页「至少选一件」一致）
 *  - **出图只在点「完成」时发生**（用户明确要求：不要拖拽/返回就自动重出）。所以拖完、加完、移完，
 *    列表里的穿搭图片都还是上一次点「完成」生成的那张，直到再点一次「完成」
 *  - **「完成」= 真正保存**（2026-09 用户口径）：
 *    ① 新建搭配：挑选页点的是「选择搭配」，那时只是一条草稿（`draft:true`，列表/日历看不到），
 *       这页点「完成」才 `store.commitDraft` 转正 + 出封面；直接返回则草稿丢掉（`onUnload` → `dropDrafts`）
 *    ② 编辑搭配：挑选页刚挑的衣物只是「待确认」（`store.setPendingItems`，搭配本身没被改过），
 *       这页按它渲染 9 格，点「完成」才写回 `itemIds`；直接返回就等于没改（数据从没动过，绝对安全）
 *
 * 这页同时可以改名和改场合：改动**即时存盘**（点选即存、输入框失焦即存、「完成」再兜一次）。
 * 「完成」出**方图封面**存本机（kind='cover'，列表卡片当封面，方形铺方形零裁切；**文件名带唯一后缀**，
 * 否则同名路径会被图片缓存吃掉，真机上就是「改了图不更新」）；
 * 「保存图片」另画一张**自适应大图**（kind='album'，每件尽量大）直接存系统相册、不落盘。
 * 生成失败不拦人，列表会退回实时位图。
 *
 * 数据由 outfit-edit 保存后带着 id 跳进来（redirectTo，返回直接回穿搭列表）。
 */

const store = require('../../utils/store.js')
const mock = require('../../utils/mock.js')
const layout = require('../../utils/outfit-layout.js')
const { shoot } = require('../../utils/outfit-photo.js')
const cloud = require('../../utils/cloud.js')
const T = require('../../utils/texts.js')

const LONG_PRESS = 250        // 长按多久进入拖拽（毫秒）
const MOVE_TOLERANCE = 8      // 长按期间手指移动超过这个距离就当翻页/滚动，不拖拽
// 名称提示的宽度预算：单位 = 全角字，半角数字/字母算 0.5 个
// （输入框 241pt ÷ 32rpx 的全角字 16.64pt ≈ 14.5 个字；两种屏宽比例一样，所以这个数是稳的）
const PH_BUDGET = 14.4
/** 估算一段字占几个全角字宽（中文 1，ASCII 0.5） */
function phUnits(s) {
  let n = 0
  for (let i = 0; i < s.length; i++) n += s.charCodeAt(i) < 128 ? 0.5 : 1
  return n
}

Page({
  data: {
    personalTryonVisible: false,
    id: '',
    previewBusy: false,
    dropIndex: -1,
    dragHint: '',
    name: '',
    namePh: '可不填',       // 名称输入框的灰色提示（选了场合就换成自动描述，见 namePhOf）
    isDraft: false,         // 新建搭配还没点「完成」：这页只是预览，返回就放弃
    pendingItems: null,     // 编辑搭配里刚挑的衣物（还没点「完成」，搭配本身还没改）
    unsaved: false,         // 上面两种「还没真正保存」都算：页面上给一句提醒
    count: 0,
    occChips: [],           // [{ value, on }] 场合多选
    cells: [],              // 9 个格子 [{ k, idx, item|null }]
    main: [],               // 左列 3 行 × 2 格 [{ k, cells }]
    side: [],               // 右列配饰 3 格
    items: [],              // 有衣物的（按位置顺序，出图用）
    slots: [],              // 位置表（id 或 null）
    missing: 0,
    notFound: false,
    // 拖拽态
    dragging: false,
    dragItem: null,
    dragX: 0,
    dragY: 0,
    dragFrom: -1,
    dragHot: -1
  },

  onLoad(options) {
    this.setData({ id: (options && options.id) || '' })
    this.load()
  },

  /** 从挑选页返回时也要重读（搭配内容可能刚改过），所以 onShow 再读一次 */
  onPersonalTryon() { personalTryon.open('?outfitId=' + encodeURIComponent(this.data.id)) },

  onShow() {
    personalTryon.visibility(this)
    // 原生大图预览返回时保留正在编辑的内容，不重新拉取覆盖。
    if (this._returningPreview) { this._returningPreview = false; return }
    if (!this.data.id) return
    this.load()
    this.applyPendingCell()
    // 拉一次云端最新（本机只是渲染缓存）；草稿不上云，所以不会被拉没
    cloud.pull().then((r) => {
      if (r && r.changed) { this.load(); this.applyPendingCell() }
    })
  },

  /** 离开这页时清掉计时器；**还没点过「完成」的草稿就丢掉**（直接返回 = 这套搭配不保存）
   *  点过「完成」的已经转正（不带 draft 标记），这里不会动它 */
  onUnload() {
    this._unloaded = true
    clearTimeout(this._dropTimer)
    clearTimeout(this._pressTimer)
    clearTimeout(this._coverTimer)
    const o = store.getOutfit(this.data.id)
    if (o && o.draft) store.dropDrafts()
  },

  /** 读这条搭配 → 算 9 个格子 + 出图清单
   *  两种「还没真正保存」的情况：
   *   - 草稿（新建搭配点了「选择搭配」，还没点「完成」）：列表里看不到它，但这页要正常显示编辑
   *   - 待确认的衣物（编辑搭配里刚挑的，`store.takePendingItems`）：按新选的渲染 9 格，
   *     但**搭配本身还没改** —— 点「完成」才写回去，直接返回就等于没改
   *  注意 takePendingItems 是「取一次就清」：本页 onShow 拿到的就是挑选页刚挂上的那次选择 */
  load() {
    const o = store.getOutfit(this.data.id)
    const pend = store.takePendingItems(this.data.id)
    const pendingItems = pend || this.data.pendingItems || null
    const baseCard = store.outfitCards().filter(x => x.id === this.data.id)[0] || store.draftCard(this.data.id)
    // 有待确认的选择时，card 现算：**把搭配本身的记录当底**（名字/场合都在），只换 itemIds/slots
    const card = pendingItems ? store.cardOfItems(pendingItems, (o && o.slots) || [], o) : baseCard
    if (!o || !card) {
      this.setData({ notFound: true })
      return
    }
    // 标题：新建（草稿）流程 = 「新增搭配」；从列表点开已有搭配 = 「编辑搭配」（2026-09 用户指定）
    wx.setNavigationBarTitle({ title: o.draft ? '新增搭配' : '编辑搭配' })
    // 名字/场合一律以搭配记录为准（卡片可能是临时算出来的，别拿它的字段当真相）
    const occ = (o.occasions || []).slice()
    const slots = card.slots || []
    const occChips = mock.OCCASIONS.map(v => ({ value: v, on: occ.indexOf(v) >= 0 }))
    this.setData({
      notFound: false,
      isDraft: !!o.draft,
      pendingItems,
      unsaved: !!o.draft || !!pendingItems,
      // 输入框里只放「用户自己填的名字」；列表用的兜底名「未命名搭配」和自动生成的名字都不放进去，
      // 否则一改场合/换衣物，它就被当成手填的名字冻结住，不会再跟着变
      name: o.nameAuto ? '' : ((o.name || '') === '未命名搭配' ? '' : (o.name || '')),
      namePh: this.namePhOf(occChips, card.items, card.count),
      count: card.count,
      occChips,
      missing: card.missing || 0,
      items: card.items,
      slots
    }, () => this.render())

    // 归一化出来的位置跟存的不一样（新加的衣物自动落了位 / 老数据首次进这页）→ 落盘，
    // 以后自动落位规则就算变了也不会把用户的位置搞乱
    if (slots.join(',') !== (o.slots || []).join(',')) {
      o.slots = slots
      store.saveOutfit(o)
    }
  },

  /** 按 items + slots 算出 9 个格子（有衣物的格子放图，空格是虚线框） */
  render() {
    const byId = {}
    this.data.items.forEach(i => { byId[i.id] = i })
    const cells = []
    for (let i = 0; i < layout.CELL_COUNT; i++) {
      const id = this.data.slots[i]
      cells.push({ k: 'c' + i, idx: i, item: (id && byId[id]) || null })
    }
    this.setData({
      cells,
      main: [
        { k: 'r0', cells: [cells[0], cells[1]] },
        { k: 'r1', cells: [cells[2], cells[3]] },
        { k: 'r2', cells: [cells[4], cells[5]] }
      ],
      side: [cells[6], cells[7], cells[8]]
    })
  },

  // ===== 空格：点一下去挑一件放这一格 =====

  onCellTap(e) {
    if (Date.now() - (this._dragAt || 0) < 400) return      // 拖完紧接着来的 tap 挡掉
    const idx = Number(e.currentTarget.dataset.idx)
    const cell = this.data.cells[idx]
    if (!cell || cell.item) return                          // 有衣物的格子点了不动（拖它才行）
    this._pendingCell = idx
    this._idsBefore = this.data.cells.filter(c => c.item).map(c => c.item.id)
    this.persist()
    wx.navigateTo({ url: '/pages/outfit-edit/outfit-edit?id=' + this.data.id })
  },

  /**
   * 从挑选页回来：用户点的那个空格，用「这次新加的第一件」填上
   * （那格被别的操作占了、或者一件都没加 → 什么都不做，衣物由自动落位安排）
   *
   * 注意：这里只能用 this.data.items / this.data.slots（load 里同步更新的），
   * 不能用 this.data.cells —— 那个在 render 的 setData 回调里才刷新，此刻还是旧值
   */
  applyPendingCell() {
    const idx = this._pendingCell
    const idsBefore = this._idsBefore || []
    this._pendingCell = null
    this._idsBefore = null
    if (idx == null) return
    const items = this.data.items || []
    const slots = (this.data.slots || []).slice()
    if (!items.length || slots.length < layout.CELL_COUNT) return
    const added = items.map(i => i.id).filter(id => idsBefore.indexOf(id) < 0)
    if (!added.length) return
    const from = slots.indexOf(added[0])
    if (from < 0) return
    // 目标格有人：交换（跟拖拽落到已占格子的行为一致，不会把原来那件弄丢）
    slots[from] = slots[idx]
    slots[idx] = added[0]
    this.applySlots(slots)
  },

  /**
   * 点衣物格子右上角的 × → 把这件从这套搭配里移出（衣物还在衣橱，随时能再加回来）
   * 格子里的位置一起清掉 → 下次再加回来就是个空位，不会挤别人
   * 只有一件时不让移（跟挑选页「至少选一件」一致）
   * 不自动出图：封面等用户点「完成」时再重出（用户定的规则）
   */
  onRemoveItem(e) {
    if (Date.now() - (this._dragAt || 0) < 400) return      // 拖完紧接着来的 tap 挡掉，别误删
    const idx = Number(e.currentTarget.dataset.idx)
    const cell = this.data.cells[idx]
    if (!cell || !cell.item) return
    if (this.data.count <= 1) {
      wx.showToast({ title: T.t('outfitView.keep_one'), icon: 'none' })
      return
    }
    const id = cell.item.id
    const name = cell.item.name || '这件'

    // 编辑搭配挑来的衣物还挂着「待确认」：移出要从待确认的清单里去掉（搭配本身还没改，
    // 不从这儿删的话，load() 按待确认清单渲染，× 会看着没反应）
    if (this.data.pendingItems) {
      const pendingItems = this.data.pendingItems.filter(x => x !== id)
      const slots = (this.data.slots || []).map(x => x === id ? null : x)
      this.setData({ pendingItems, slots }, () => this.load())
      wx.showToast({ title: T.t('outfitView.removed', { name: name }), icon: 'none' })
      return
    }

    const o = store.getOutfit(this.data.id)
    if (!o) return
    o.itemIds = (o.itemIds || []).filter(x => x !== id)
    o.slots = (this.data.slots || []).map(x => x === id ? null : x)
    store.saveOutfit(o)
    this.setData({ slots: o.slots }, () => this.load())     // 重读：件数/清单/格子一起刷新
    wx.showToast({ title: T.t('outfitView.removed', { name: name }), icon: 'none' })
  },

  // ===== 长按拖拽换位置 =====

  onCellStart(e) {
    const idx = Number(e.currentTarget.dataset.idx)
    const cell = this.data.cells[idx]
    if (!cell || !cell.item) return                        // 空格不能拖
    const t = (e.touches && e.touches[0]) || {}
    this._from = idx
    this._start = { x: t.clientX, y: t.clientY }
    this._moved = false
    this.measure()                                          // 顺手量一遍 9 格，长按触发前肯定回来了
    clearTimeout(this._pressTimer)
    this._pressTimer = setTimeout(() => {
      if (this._moved) return
      this.startDrag(idx, t.clientX, t.clientY)
    }, LONG_PRESS)
  },

  onCellMove(e) {
    const t = (e.touches && e.touches[0]) || {}
    if (!this.data.dragging) {
      // 长按还没生效就动了手指 → 当成翻页/滚动，取消这次长按
      const s = this._start || { x: t.clientX, y: t.clientY }
      if (Math.abs(t.clientX - s.x) > MOVE_TOLERANCE || Math.abs(t.clientY - s.y) > MOVE_TOLERANCE) {
        this._moved = true
        clearTimeout(this._pressTimer)
      }
      return
    }
    const hot = this.hitCell(t.clientX, t.clientY)
    const target = this.data.cells[hot]
    this.setData({
      dragX: t.clientX, dragY: t.clientY, dragHot: hot,
      dragHint: hot < 0 ? '松手放回原位' : (hot === this.data.dragFrom ? '拖到其他格子调整位置' : (target && target.item ? '松手交换两件衣物' : '松手放到这里'))
    })
  },

  onCellEnd() {
    clearTimeout(this._pressTimer)
    if (!this.data.dragging) return
    const from = this.data.dragFrom
    const hot = this.data.dragHot
    this._dragAt = Date.now()
    this.setData({ dragging: false, dragItem: null, dragFrom: -1, dragHot: -1, dragHint: '' })
    if (hot < 0 || hot === from) return                     // 拖到格子外 / 原地松手 → 位置不变
    const slots = this.data.slots.slice()
    const a = slots[from]
    slots[from] = slots[hot]                                // 目标格有衣物 → 交换；空的 → 移过去
    slots[hot] = a
    this.applySlots(slots)
    this.setData({ dropIndex: hot })
    clearTimeout(this._dropTimer)
    this._dropTimer = setTimeout(() => this.setData({ dropIndex: -1 }), 450)
    try { wx.vibrateShort({ type: 'light' }) } catch (e) {}
  },

  // 系统打断手势时只取消，不把 touchcancel 当成一次放置。
  onCellCancel() {
    clearTimeout(this._pressTimer)
    if (this.data.dragging) this._dragAt = Date.now()
    this.setData({ dragging: false, dragItem: null, dragFrom: -1, dragHot: -1, dragHint: '' })
  },

  /** 进入拖拽态：震动一下 + 幽灵跟手 */
  startDrag(idx, x, y) {
    const cell = this.data.cells[idx]
    if (!cell || !cell.item) return
    this._dragAt = Date.now()
    try { wx.vibrateShort({ type: 'light' }) } catch (e) { /* 工具/部分机型不支持，忽略 */ }
    clearTimeout(this._dropTimer)
    this.setData({ dropIndex: -1, dragHint: '拖到其他格子调整位置', dragging: true, dragFrom: idx, dragItem: cell.item, dragX: x, dragY: y, dragHot: idx })
  },

  /** 量 9 个格子在屏幕上的位置（跟手指坐标同一套坐标系） */
  measure() {
    wx.createSelectorQuery()
      .in(this)
      .selectAll('.pos-slot')
      .boundingClientRect((rects) => {
        this._rects = (rects || []).map((r, i) => ({
          idx: (r.dataset && r.dataset.idx != null) ? Number(r.dataset.idx) : i,
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height
        }))
      })
      .exec()
  },

  /** 手指落在哪个格子（都不在 → -1，松手就当放回原位） */
  hitCell(x, y) {
    const rects = this._rects || []
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]
      if (x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height) return r.idx
    }
    return -1
  },

  /** 位置变了：存盘 + 重排视图（**不自动出图**，用户要求：只有点「完成」才出图/重出） */
  applySlots(slots) {
    const o = store.getOutfit(this.data.id)
    if (!o) return
    o.slots = slots
    store.saveOutfit(o)
    this.setData({ slots }, () => this.render())
  },

  // ===== 名称 / 场合：改完即时存盘 =====

  onInputName(e) {
    this.setData({ name: e.detail.value })
  },

  /** 输入框失焦就存（不然用户改完名直接返回会丢） */
  onBlurName() {
    this.persist()
  },

  onToggleOcc(e) {
    const value = e.currentTarget.dataset.value
    const occChips = this.data.occChips.map(c => c.value === value ? { value, on: !c.on } : c)
    // 场合一变，名称的自动描述提示跟着变（选了场合才有描述）
    this.setData({ occChips, namePh: this.namePhOf(occChips, this.data.items, this.data.count) }, () => this.persist())
  },

  /**
   * 名称的自动描述：**用户没填名称时就直接用它当名字**（列表/日历里都显示它）
   *  - 没选场合 → 空串（名字留空，列表照旧显示「未命名搭配」）
   *  - 选了场合 → 「场合 · 衣物名（N 件）」；3 件以上写「…等 N 件」
   *  - 多个场合都选了 → 用最靠前的那个（OCCASIONS 固定顺序），免得名字过长
   *
   * 输入框右边还有「N 件」，实际只有 ~14.4 个全角字宽（32rpx 字 / 241pt 宽），
   * 所以按宽度预算挑最长的可用写法：先试两个衣物名，装不下就一个，再装不下就只写「场合 · N 件」——
   * 这样提示（= 将要存的名字）永远不会被裁到贴着「N 件」。
   */
  autoNameOf(occChips, items, count) {
    const occ = (occChips || []).filter(c => c.on).map(c => c.value)
    if (!occ.length) return ''
    if (!count) return occ[0] + ' · 还没有衣物'
    const names = (items || []).map(i => i.name).filter(Boolean)
    const head = occ[0] + ' · '
    const tail = count > 2 ? ' 等 ' + count + ' 件' : '（' + count + ' 件）'
    const two = names.length >= 2 ? head + names[0] + '、' + names[1] + tail : ''
    if (two && phUnits(two) <= PH_BUDGET) return two
    const one = names.length ? head + names[0] + tail : ''
    if (one && phUnits(one) <= PH_BUDGET) return one
    return head + count + ' 件'
  },

  /** 输入框的灰色提示 = 自动描述；没选场合时还是「可不填」 */
  namePhOf(occChips, items, count) {
    return this.autoNameOf(occChips, items, count) || '可不填'
  },

  /** 把名称、场合与位置写回这条搭配
   *  名称留空时写自动描述（场合 · 衣物 · 件数），并用 nameAuto 记下「这是自动生成的」——
   *  用户一改场合/换衣物，名字跟着重算；用户自己填过就不动它了。 */
  persist() {
    const o = store.getOutfit(this.data.id)
    if (!o) return
    const typed = (this.data.name || '').trim()
    const auto = this.autoNameOf(this.data.occChips, this.data.items, this.data.count)
    o.name = typed || auto
    o.nameAuto = !typed && !!auto
    o.occasions = this.data.occChips.filter(c => c.on).map(c => c.value)
    if (this.data.slots.length) o.slots = this.data.slots
    store.saveOutfit(o)
  },

  // ===== 出图 =====

  /**
   * 出封面方图并存成这条搭配的封面（失败给空串，调用方别拦路）
   * 方形图铺进方形卡片 → 不裁切、任何件数表现一致
   */
  shootCover(done) {
    // 文件名带唯一后缀：**同名路径会被小程序的图片缓存吃掉**（文件内容换了但列表里还是旧图，真机尤其明显），
    // 换个路径才能保证列表/相册那边重新加载；出完把上一张删掉，不留垃圾
    const old = (store.getOutfit(this.data.id) || {}).photo || ''
    const dest = wx.env.USER_DATA_PATH + '/outfit_' + this.data.id + '_' + Date.now() + '.png'
    shoot(this, { items: this.data.items, slots: this.data.slots, kind: 'cover', destPath: dest }, (path) => {
      if (path) {
        // 只存本机（临时图）：真正的上传发生在 onDone 里 —— 先传封面再提交，一次写全
        store.setOutfitPhoto(this.data.id, path, store.outfitSig(this.data.id))
        if (old && old !== path) {
          try { wx.getFileSystemManager().unlinkSync(old) } catch (e) { /* 删不掉就算了 */ }
        }
      }
      done(path)
    })
  },

  /** 完成：存名字/场合/位置 → 草稿转正 → 出封面 → 回穿搭列表
   *  **这一步才是「真正保存」**：
   *   - 新建搭配：挑选页点的是「选择搭配」，那时只是一条草稿（列表里还看不到）
   *   - 编辑搭配：挑选页刚挑的衣物只是「待确认」，到这儿才写回搭配
   */
  onDone() {
    // 编辑搭配「待确认」的衣物：点「完成」才真正写进搭配（位置也一起存，新衣物已自动落位）
    if (this.data.pendingItems) {
      const o = store.getOutfit(this.data.id) || {}
      o.itemIds = this.data.pendingItems
      if (this.data.slots.length) o.slots = this.data.slots
      store.saveOutfit(o)
      this.setData({ pendingItems: null, unsaved: !!o.draft })
    }
    this.persist()
    clearTimeout(this._coverTimer)
    wx.showLoading({ title: T.t('outfitView.cover_generating'), mask: true })

    // 出封面（本机临时图）→ 传 OSS → 连同搭配一起提交；**提交成功才转正**
    // （失败的话搭配还是草稿状态、一个字没丢，再点一次「完成」就行）
    this.shootCover((path) => {
      wx.showLoading({ title: T.t('outfitView.saving'), mask: true })
      const o = store.getOutfit(this.data.id) || {}
      cloud.saveOutfit(o, path).then(() => {
        store.commitDraft(this.data.id)
        wx.hideLoading()
        wx.navigateBack()
      }).catch((err) => {
        wx.hideLoading()

        // 衣架不够（4001/4002）：2026-09 起**新增搭配也占一个衣架**，所以这条路要单独说
        // —— 它不是网络问题，再点多少次「完成」都不会成，得给出路（联系客服 / 删掉不想要的腾衣架）
        const code = err && err.code
        if (code === cloud.ITEM_LIMIT_CODE || code === cloud.DAILY_LIMIT_CODE) {
          const isDaily = code === cloud.DAILY_LIMIT_CODE
          wx.showModal({
            title: T.t(isDaily ? 'outfitView.quota_daily_title' : 'outfitView.quota_total_title'),
            content: isDaily
              ? ((err && err.msg) || T.t('outfitView.quota_daily_fallback')) + '\n' + T.t('outfitView.quota_daily_tail')
              : ((err && err.msg) || T.t('outfitView.quota_total_fallback')),
            confirmText: T.t('common.service_ok'),
            cancelText: T.t('common.know'),
            success: (r) => { if (r.confirm) wx.navigateTo({ url: '/pages/service/service' }) }
          })
          return
        }

        wx.showModal({
          title: T.t('outfitView.save_fail_title'),
          content: T.t('outfitView.save_fail_content', { msg: (err && err.msg) || T.t('common.retry_later') }),
          showCancel: false
        })
      })
    })
  },

  /** 只生成临时预览图，不写封面、不提交搭配、不扣衣架。 */
  onPreview() {
    if (this.data.previewBusy || this.data.dragging) return
    if (!this.data.items.length) {
      wx.showToast({ title: '先选择一件衣物再预览', icon: 'none' })
      return
    }
    this.setData({ previewBusy: true })
    wx.showLoading({ title: '正在生成预览', mask: true })
    // 与保存本地共用出图规则，预览内容就是当前编辑结果。
    shoot(this, { items: this.data.items, slots: this.data.slots, kind: 'album', destPath: '' }, (path) => {
      wx.hideLoading()
      if (this._unloaded) return
      this.setData({ previewBusy: false })
      if (!path) {
        wx.showToast({ title: '预览生成失败，请重试', icon: 'none' })
        return
      }
      this._returningPreview = true
      wx.previewImage({
        current: path,
        urls: [path],
        fail: () => {
          this._returningPreview = false
          wx.showToast({ title: '预览打开失败，请重试', icon: 'none' })
        }
      })
    })
  },

  /** 保存图片到相册：现画一张自适应大图（每件尽量大），直接调系统 API，不占本机空间 */
  onSaveAlbum() {
    this.persist()
    wx.showLoading({ title: T.t('outfitView.img_generating'), mask: true })
    shoot(this, { items: this.data.items, slots: this.data.slots, kind: 'album', destPath: '' }, (path) => {
      if (!path) {
        wx.hideLoading()
        wx.showToast({ title: T.t('outfitView.img_fail'), icon: 'none' })
        return
      }
      wx.saveImageToPhotosAlbum({
        filePath: path,
        success: () => { wx.hideLoading(); wx.showToast({ title: T.t('outfitView.saved_album'), icon: 'none' }) },
        fail: (err) => {
          wx.hideLoading()
          // 用户拒绝过相册权限：引导去设置里打开
          if (err && String(err.errMsg || '').indexOf('auth') >= 0) {
            wx.showModal({
              title: T.t('outfitView.album_auth_title'),
              content: T.t('outfitView.album_auth_content'),
              success: (r) => { if (r.confirm) wx.openSetting() }
            })
            return
          }
          wx.showToast({ title: T.t('outfitView.save_fail'), icon: 'none' })
        }
      })
    })
  }
})
