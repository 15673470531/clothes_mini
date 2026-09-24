/**
 * 新建 / 编辑搭配（从衣橱多选衣物存成一套）
 *
 * 两种进入方式：
 *  1) 新建（衣橱「＋」/ 穿搭页「＋」）：什么都不带进来
 *  2) 编辑这套搭配（预览页点空格进来的，带 ?id=搭配id）：
 *     - 进来就把这套已有的衣物**预勾选**上（取消勾选=从这套里去掉）
 *     - **不再按格子预筛品类**（2026-09 用户要求：空格不预设放什么，挑回来由用户自己拖）
 *     - 保存 = 更新这套搭配并返回预览页（那页 onShow 会重读，新加的衣物自动落位）
 *
 * 挑衣物的体验（2026-09 用户要求，参考衣橱页）：
 *  - **名称 / 场合都不在这页**（2026-09 用户要求去掉：「反正预览页里可以选择和填写」），
 *    所以 onSave 只写 itemIds —— 编辑模式**千万别顺手覆盖已有的 name/occasions**
 *  - 顶部一级品类筛选（全部 + 6 个品类），选中具体品类只显示该类的衣物
 *  - 衣物是 3 列图片墙（跟衣橱页共用 app.wxss 的 .wall 系列），有照片显示照片
 *  - 勾选标记在格子右上角；跨筛选保留勾选（切品类/切「已选」都不丢）
 *  - 「已选 N/9」在标题行右侧，点了切到只看已勾选的
 *  - **一套最多 9 件**（预览页就 9 个格子，多选的放不下），选够再点就提示
 *  - 底部固定按钮（跟记录衣物页同一套 .bar）：**新建时叫「选择搭配」**（2026-09 用户口径：
 *    这页只挑衣物、**不算保存**）→ 落一条草稿（draft:true，列表/日历都看不到）→ redirectTo 预览页，
 *    在那儿点「完成」才真正保存（`store.commitDraft`）；从预览页直接返回则草稿丢掉。
 *    编辑已有搭配时按钮是「保存」（改完即存，然后回预览页）
 *
 * 选择项全部预计算成 {value, on} / {on} 结构——WXML 里不能调用 JS 方法，
 * 所以不能用 list.indexOf(x) >= 0 这种写法。
 */

const store = require('../../utils/store.js')
const mock = require('../../utils/mock.js')
const layout = require('../../utils/outfit-layout.js')
const T = require('../../utils/texts.js')

Page({
  data: {
    id: '',                 // 非空 = 编辑已有搭配
    cats: [],               // 一级品类（含「全部」）
    catKey: 'all',
    onlyPicked: false,      // 「已选 N」筛选：只看已勾选的
    all: [],                // 全量衣物（带 on 勾选标记），筛选从它派生
    list: [],               // 当前要渲染的衣物
    selectedCount: 0,
    max: layout.CELL_COUNT, // 一套最多几件（= 预览页的位置数）
    hasItems: true,
    emptyText: ''
  },

  onLoad(options) {
    const id = (options && options.id) || ''
    const outfit = id ? store.getOutfit(id) : null

    this.setData({ id, cats: mock.CATEGORIES })
    this.loadItems(outfit ? (outfit.itemIds || []) : [])
    wx.setNavigationBarTitle({ title: outfit ? '编辑搭配' : '新建搭配' })
  },

  /**
   * 读一次衣橱，组装成全量列表（pickedIds = 编辑模式下已在这套搭配里的衣物）
   */
  loadItems(pickedIds) {
    const picked = pickedIds || []
    const all = store.getItems().map(i => {
      const c = mock.colorOf((i.colors || [])[0])
      return {
        id: i.id,
        category: i.category,
        name: i.name || mock.subName(i.category, i.sub) || mock.categoryOf(i.category).name,
        emoji: mock.categoryOf(i.category).emoji,
        color: c.hex,
        light: c.key === 'white',
        image: i.image || i.imageUrl || '',   // 本地优先，回退上传后的远程地址
        on: picked.indexOf(i.id) >= 0
      }
    })

    this.setData({
      all,
      hasItems: all.length > 0,
      selectedCount: all.filter(i => i.on).length
    }, () => this.applyFilter())
  },

  /**
   * 按当前筛选条件算出要渲染的列表
   * 「已选」模式优先于品类筛选（跨品类看已勾选的）
   */
  applyFilter() {
    const { all, catKey, onlyPicked } = this.data
    const list = onlyPicked
      ? all.filter(i => i.on)
      : all.filter(i => catKey === 'all' || i.category === catKey)

    this.setData({
      list,
      emptyText: onlyPicked
        ? '还没有勾选衣物'
        : (this.data.all.length === 0 ? '衣橱还是空的，先去衣橱添加衣物' : '这个分类下还没有衣物')
    })
  },

  onCat(e) {
    this.setData({ catKey: e.currentTarget.dataset.key, onlyPicked: false }, () => this.applyFilter())
  },

  onOnlyPicked() {
    this.setData({ onlyPicked: !this.data.onlyPicked }, () => this.applyFilter())
  },

  /**
   * 点格子 = 切换勾选（会同步更新列表，所以「已选」模式下取消勾选会立刻消失）
   * 一套最多 max 件（预览页的位置数）：选够再点就提示，不让他白选
   */
  onToggleItem(e) {
    const id = e.currentTarget.dataset.id
    const target = this.data.all.filter(i => i.id === id)[0]
    if (target && !target.on && this.data.selectedCount >= this.data.max) {
      // 上限来自前端 layout.CELL_COUNT（预览页位置数）→ 用占位符，后端只知道自己的数字
      wx.showToast({ title: T.t('outfitEdit.max_items', { n: this.data.max }), icon: 'none' })
      return
    }
    const all = this.data.all.map(i => i.id === id ? Object.assign({}, i, { on: !i.on }) : i)
    this.setData({ all, selectedCount: all.filter(i => i.on).length }, () => this.applyFilter())
  },

  /**
   * 底部按钮：**新建和编辑都叫「选择搭配」**（2026-09 用户口径：
   * 这页只挑衣物、**不算保存**；到预览页点「完成」才真正保存）
   *  - 新建 → 落一条草稿（draft:true，列表/日历都看不到）→ redirectTo 预览页
   *  - 编辑 → 这次选的衣物挂成「待确认」（`store.setPendingItems`，**不动搭配本身的 itemIds**），
   *    回预览页按它渲染；点「完成」才写回搭配，直接返回就等于没改
   *
   * 名称/场合不在这页填（2026-09 用户要求去掉）——预览页里都能改，
   * 所以这里**绝不能顺手把 name/occasions 覆盖掉**（编辑模式尤其要注意）
   */
  onSave() {
    const picked = this.data.all.filter(i => i.on)
    if (picked.length === 0) {
      wx.showToast({ title: T.t('outfitEdit.need_one'), icon: 'none' })
      return
    }
    const itemIds = picked.map(i => i.id)

    // 编辑已有搭配：只挂「待确认」，回预览页（那页 onShow 会重读并取这次的选择）
    if (this.data.id) {
      store.setPendingItems(this.data.id, itemIds)
      wx.showToast({ title: T.t('outfitEdit.picked'), icon: 'none' })
      setTimeout(() => wx.navigateBack(), 500)
      return
    }

    // 新建：**先落一条草稿**（列表里看不到），去预览页摆位置/填名称场合，
    // 点「完成」才转正（store.commitDraft）；从预览页直接返回则草稿丢掉，等于没建过。
    // 用 redirectTo：预览页返回直接回穿搭列表，不会退回这张已经交过卷的表单
    const outfit = store.createDraft({ itemIds })
    wx.redirectTo({ url: '/pages/outfit-view/outfit-view?id=' + outfit.id })
  }
})
