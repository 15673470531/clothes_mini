/**
 * 记录衣物 / 编辑衣物
 *
 * 录入流程（用户要求）：点「＋」先选照片来源（拍照 / 相册）→ 拿到照片 → 再填其他信息。
 * 所以本页照片区块在最上面；**新增时照片和品类都是必填**，颜色至少选一个；
 * 编辑已有衣物时照片可换可不换。
 *
 * 二级类目（细分）：选完一级品类才出现，**可不选**（跟颜色一样不拦人）；
 * 换一级品类时二级整组替换，已选的细分作废。
 *
 * 其余字段全是点选，名称可不填。
 *
 * 注意：wx.chooseMedia 给的临时路径重启后会失效，必须 saveFile 落盘。
 *
 * 照片有两个「地址」（二期图片上云后新增，别混）：
 *  - `image`    本地落盘路径（wx.env.USER_DATA_PATH 下），本机显示最快，也是补传的来源
 *  - `imageUrl` 上传到后端/OSS 之后的远程地址
 * 显示时用「本地优先」（数据源的 `image || imageUrl`），但**写回时**要看用户有没有动过照片：
 * 没动 → 远程地址原样带上（saveItem 是整体替换，不带就洗掉了，等本地文件被清就彻底没图）；
 * 动了（换/删）→ 旧远程地址作废，否则补传模块会认为「已经有远程地址」而跳过新照片。
 * 这就是本页要维护 `photoSrc`（显示用）/ `origPhoto`（进来时的显示源，用来判断动没动）的原因。
 *
 * 洗白底（归一化 · 2026-09）：底部多一个入口，把这张照片洗成「白底商品图」（去杂物）。
 *  - 洗完弹对比层（左原图 / 右白底图），**由用户决定要不要拿白底图当封面**（image_url）
 *  - 原图永远留着（后端 original_image_url），随时能切回来
 *  - 显示用 `photoShow`：选了白底图当封面就显示白底图；但 photoSrc/origPhoto 不动，
 *    否则"照片动过没有"的判断会被带偏 → 保存时把 imageUrl 洗成空
 *  - 本机照片要洗得先传云端（接口只吃公网 https）；传上去的地址记在 `origUrl` + `origUrlFor`，
 *    保存时直接复用，避免二次上传产生新 key（那样"白底图对应哪张原图"就对不上了）
 */

const store = require('../../utils/store.js')
const mock = require('../../utils/mock.js')
const cloud = require('../../utils/cloud.js')
const photo = require('../../utils/photo.js')
const api = require('../../utils/api.js')
const T = require('../../utils/texts.js')

Page({
  data: {
    isEdit: false,
    isAdd: true,
    id: '',
    name: '',
    cats: [],            // [{ key, name, on }]
    subs: [],            // 二级类目 [{ key, name, on }]；没选一级品类时为空 → 不显示
    colors: [],          // [{ key, name, hex, on }]
    seasons: [],         // [{ value, on }]
    occasions: [],       // [{ value, on }]
    image: '',           // **临时图片**：刚拍/刚选的本地文件，保存时传上 OSS 后就删掉
    photoSrc: '',        // 照片显示源 = 临时文件 || 云端地址
    photoShow: '',       // **界面上显示的那张**：默认 = photoSrc，选了白底图当封面就换成白底图
    origPhoto: '',       // 进页面时的显示源，保存时用来判断「这张照片用户动过没有」

    // ===== 洗白底（归一化 · 2026-09）=====
    normalizeOn: false,     // 后端开关（关着整块入口不显示）
    normalizeLeft: 0,       // 今天还能洗几次
    normalizeUnlimited: false,  // 管理员：不限次数（后端下发，前端不再拦人）
    whiteUrl: '',           // 这件衣物的白底图（云端地址）
    origUrl: '',            // 原图的云端地址（对比和切回都靠它）
    origUrlFor: '',         // 上面这个地址对应的是哪张照片（本机路径 / 云端地址）
    coverChoice: '',        // 封面选哪张：'white' | 'orig' | ''（还没洗过）
    compareOpen: false,     // 对比弹层
    compareLeft: '',
    compareRight: '',
    compareTitle: '',
    compareHint: '',
    labelOrig: '',
    labelWhite: '',
    btnKeep: '',
    btnUse: '',
    normEntryTitle: '',
    normEntrySub: '',
    normLeftText: '',

    moreOpen: false,     // 「更多属性」（颜色 / 场合）默认折叠
    moreSummary: '',     // 折叠时右侧显示已选摘要，不用展开也能看到

    // ===== 一次选多张时的批量录入（2026-09）=====
    // 整批照片都放这儿并排显示：点哪张填哪张。每张自带一份表单快照（切来切去不丢填过的内容）
    photos: [],          // [{ path, done, form }]
    cur: 0,              // 当前在填第几张
    queueText: '',       // 「已录 2 / 9 张，点缩略图切换」（只有一批多于一张才显示）
    restCount: 0,        // 这一批里其它还没录的张数（「剩下 N 张都用这套属性」用）
    batchSame: false     // 「剩下几张都用这套属性」
  },

  onLoad(options) {
    const editId = options && options.id
    const item = editId ? store.getItem(editId) : null

    const cats = mock.CATEGORIES
      .filter(c => c.key !== 'all')
      .map(c => ({ key: c.key, name: c.name, on: item ? item.category === c.key : false }))

    const colors = mock.COLORS.map(c => ({
      key: c.key, name: c.name, hex: c.hex,
      on: item ? (item.colors || []).indexOf(c.key) >= 0 : false
    }))

    // 新增时只给「季节」预置默认值（按当前月份，9 月即秋），省得用户为不关心的字段做决定
    // 「场合」默认都不选（用户要求：场合不做任何预置），颜色同理不预置
    const presetSeason = item ? '' : this.seasonByMonth()
    const seasons = mock.SEASONS.map(v => ({
      value: v,
      on: item ? (item.seasons || []).indexOf(v) >= 0 : v === presetSeason
    }))
    const occasions = mock.OCCASIONS.map(v => ({
      value: v,
      on: item ? (item.occasions || []).indexOf(v) >= 0 : false
    }))

    // 新增流程：照片在「＋」那一步已经选好并落盘 —— 可能一次选了好几张。
    // 整批都读进来并排显示（**队列不清空**：只有真正录完一张才把它从队列里摘掉），
    // 默认停在第一张，想先填哪张就点哪张。
    const photos = item ? [] : store.pendingPhotos().map(p => ({ path: p, done: false, form: null }))
    const pending = item ? '' : (photos.length ? photos[0].path : '')
    const localImage = item ? (item.image || '') : pending
    // 显示源：本地文件在就显示本地（快、断网也能看），本地没了才回退远程地址
    const photoSrc = item ? (item.image || item.imageUrl || '') : pending

    this.setData({
      isEdit: !!item,
      isAdd: !item,
      id: item ? item.id : '',
      name: item ? (item.name || '') : '',
      cats,
      // 编辑已有衣物时按其一级品类展开二级；新增时先空着（选完品类再出）
      subs: item ? this.buildSubs(item.category, item.sub) : [],
      colors, seasons, occasions,
      image: localImage,
      photoSrc,
      photoShow: photoSrc,
      origPhoto: photoSrc,
      // 洗白底：编辑已有衣物时记录里就带着原图 / 白底图（老记录是空串）
      whiteUrl: item ? (item.normalizedUrl || '') : '',
      origUrl: item ? (item.originalImageUrl || (item.isWhite ? '' : item.imageUrl) || '') : '',
      origUrlFor: item ? (item.imageUrl || '') : '',
      coverChoice: item && item.normalizedUrl ? (item.isWhite ? 'white' : 'orig') : '',
      photos,
      cur: 0,
      batchSame: false,
      // 编辑已有衣物且里面填过颜色/场合时，默认展开，省得用户以为丢了
      moreOpen: !!item && ((item.colors || []).length > 0 || (item.occasions || []).length > 0)
    })

    this.updateSummary()
    this.syncQueueText()
    this.buildWashLabels()
    this.loadNormalize()
    wx.setNavigationBarTitle({ title: item ? '编辑衣物' : '记录衣物' })
  },

  /**
   * 「更多属性」折叠行右侧的摘要：把已选的颜色/场合写出来
   * （颜色多于 2 个折叠成「黑/白等3色」）
   */
  updateSummary() {
    const colors = this.data.colors.filter(c => c.on).map(c => c.name)
    const occ = this.data.occasions.filter(o => o.on).map(o => o.value)
    const parts = []
    if (colors.length) {
      parts.push(colors.slice(0, 2).join('/') + (colors.length > 2 ? '等' + colors.length + '色' : ''))
    }
    if (occ.length) parts.push(occ.join('/'))
    this.setData({ moreSummary: parts.length ? parts.join(' · ') : '未填' })
  },

  onToggleMore() {
    this.setData({ moreOpen: !this.data.moreOpen })
  },

  /**
   * 按当前月份给默认季节：3-5 春 / 6-8 夏 / 9-11 秋 / 12-2 冬
   */
  seasonByMonth() {
    const m = new Date().getMonth() + 1
    if (m >= 3 && m <= 5) return '春'
    if (m >= 6 && m <= 8) return '夏'
    if (m >= 9 && m <= 11) return '秋'
    return '冬'
  },

  /**
   * 删除这件衣物：二次确认；被搭配用着的话先把「是哪几套」说清楚
   * （以前在衣橱列表的菜单里，2026-09 用户要求「点格子直接进编辑页」→ 删除挪到这里 + 列表长按）
   */
  onDelete() {
    const id = this.data.id
    if (!id) return
    const back = () => {
      cloud.commit(
        () => store.deleteItem(id),          // 先改缓存（返回衣橱时它已经不在了）
        () => cloud.removeItem(id)
      ).catch((err) => {
        // 失败：云端数据会由 commit 拉回来，回到衣橱还能看到这件
        wx.showModal({ title: T.t('itemEdit.delete_fail_title'), content: (err && err.msg) || T.t('common.retry_later'), showCancel: false })
      })
      wx.navigateBack()
    }
    const used = store.outfitsUsingItem(id)

    if (used.length === 0) {
      wx.showModal({
        title: T.t('itemEdit.delete_title'),
        content: T.t('itemEdit.delete_content'),
        confirmText: T.t('itemEdit.delete_ok'),
        success: (r) => { if (r.confirm) back() }
      })
      return
    }

    const names = used.map(o => o.name || '未命名搭配').slice(0, 3).join('、')
    wx.showModal({
      title: T.t('itemEdit.in_outfit_title'),
      content: T.t('itemEdit.in_outfit_content', {
        names: names,
        more: used.length > 3 ? T.t('itemEdit.in_outfit_more', { n: used.length }) : ''
      }),
      confirmText: T.t('itemEdit.in_outfit_ok'),
      success: (r) => { if (r.confirm) back() }
    })
  },

  onInputName(e) {
    this.setData({ name: e.detail.value })
  },

  onPickCat(e) {
    const key = e.currentTarget.dataset.key
    this.setData({
      cats: this.data.cats.map(c => Object.assign({}, c, { on: c.key === key })),
      // 换了一级品类 → 二级整组换成新的，之前选的细分作废
      subs: this.buildSubs(key, '')
    })
  },

  /**
   * 二级类目列表（一级品类决定）。onKey 为已选项，没有就都不选
   */
  buildSubs(catKey, onKey) {
    return mock.subsOf(catKey).map(s => ({ key: s.key, name: s.name, on: s.key === onKey }))
  },

  /**
   * 二级类目：可不选，所以再点一次就是取消（单选）
   */
  onPickSub(e) {
    const key = e.currentTarget.dataset.key
    const cur = this.data.subs.find(s => s.key === key)
    const nextOn = !(cur && cur.on)
    this.setData({ subs: this.data.subs.map(s => Object.assign({}, s, { on: s.key === key ? nextOn : false })) })
  },

  onToggleColor(e) {
    const key = e.currentTarget.dataset.key
    this.setData(
      { colors: this.data.colors.map(c => c.key === key ? Object.assign({}, c, { on: !c.on }) : c) },
      () => this.updateSummary()
    )
  },

  onToggleSeason(e) {
    const value = e.currentTarget.dataset.value
    this.setData({ seasons: this.data.seasons.map(s => s.value === value ? { value, on: !s.on } : s) })
  },

  onToggleOccasion(e) {
    const value = e.currentTarget.dataset.value
    this.setData(
      { occasions: this.data.occasions.map(o => o.value === value ? { value, on: !o.on } : o) },
      () => this.updateSummary()
    )
  },

  // ===== 照片 =====

  onPickCamera() {
    this.pickPhoto(['camera'])
  },

  onPickAlbum() {
    this.pickPhoto(['album'])
  },

  /**
   * 底部弹层让用户选来源（「再记一件」时复用）
   */
  onPickSource() {
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: (res) => {
        this.pickPhoto(res.tapIndex === 0 ? ['camera'] : ['album'])
      }
    })
  },

  pickPhoto(sourceType) {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType,
      sizeType: ['compressed'],
      success: (res) => {
        const temp = res.tempFiles[0].tempFilePath
        // 微信的 compressed 只是轻压，再压一道质量（体积小一截，上传更快；压不动就用原图）
        photo.compress(temp).then((src) => {
          wx.getFileSystemManager().saveFile({
            tempFilePath: src,
            success: (r) => this.putPhoto(r.savedFilePath),
            fail: () => wx.showToast({ title: T.t('itemEdit.photo_save_fail'), icon: 'none' })
          })
        })
      },
      fail: () => {}
    })
  },

  /**
   * 把「刚选/刚换」的照片放到当前这一格
   *  - 一批里换：只换当前位置的路径（队列里那张、本机旧文件一起换掉，别留下「已经不要了的照片」）
   *  - 没有批次（编辑已有衣物后重选）：这一格就是全部
   */
  putPhoto(path) {
    const photos = this.data.photos
    const cur = this.data.cur

    if (this.data.isAdd && photos.length) {
      const old = photos[cur] && photos[cur].path
      if (old && old !== path) {
        store.replacePendingPhoto(old, path)
        try { wx.getFileSystemManager().unlinkSync(old) } catch (e) { /* 删不掉就算了 */ }
      }
      photos[cur] = Object.assign({}, photos[cur], { path, done: false, form: this.snapshotForm() })
      this.setData({ photos, image: path, photoSrc: path, photoShow: path, origPhoto: path })
      this.resetWash()   // 换照片了：上一张洗出来的白底图不能再用（后端按原图指纹判断，前端也别留着）
      return
    }

    this.setData({
      photos: [{ path, done: false, form: null }],
      cur: 0,
      image: path,
      photoSrc: path,
      photoShow: path,
      origPhoto: path
    })
    this.resetWash()
  },

  /**
   * 删掉当前这张照片
   *  - 新增 + 在一批里：这一张从这批里去掉了（队列和本机文件一起清），切到别的继续
   *  - 其它情况（编辑已有衣物）：只清掉显示，等用户重选
   */
  onRemoveImage() {
    const photos = this.data.photos
    const cur = this.data.cur
    const p = photos[cur]

    this.resetWash()   // 照片都没了，白底图也就无从谈起了

    if (this.data.isAdd && photos.length && p) {
      store.removePendingPhoto(p.path)
      try { wx.getFileSystemManager().unlinkSync(p.path) } catch (e) { /* 删不掉就算了 */ }

      const left = photos.filter((x, i) => i !== cur)
      if (!left.length) {
        this.setData({ photos: [], cur: 0, image: '', photoSrc: '', photoShow: '', origPhoto: '', queueText: '' })
        return
      }
      const nextIdx = left.findIndex(x => !x.done)
      if (nextIdx < 0) {
        // 剩下的都录完了：编辑位清空（等用户重新选照片），条上留着已录的做参考
        this.setData(Object.assign({
          photos: left,
          cur: 0,
          id: '',
          isEdit: false,
          isAdd: true,
          image: '',
          photoSrc: '',
          photoShow: '',
          origPhoto: ''
        }, this.blankForm()))
        this.syncQueueText()
        return
      }
      const target = left[nextIdx]
      // 直接切过去（当前这张已经删了，不存它的表单）
      this.setData(Object.assign({
        photos: left,
        cur: nextIdx,
        id: '',
        isEdit: false,
        isAdd: true,
        image: target.path,
        photoSrc: target.path,
        photoShow: target.path,
        origPhoto: target.path
      }, target.form || this.blankForm()))
      this.syncQueueText()
      return
    }

    this.setData({ image: '', photoSrc: '', photoShow: '' })
  },

  // ===== 保存 =====

  /**
   * 校验：只拦两项——新增时照片必选、品类必选
   * 颜色/季节/场合/名称都是默认值或可跳过，不拦人（颜色为空时列表用中性灰块）
   */
  validate() {
    if (this.data.isAdd && !this.data.image) {
      wx.showToast({ title: T.t('itemEdit.no_photo'), icon: 'none' })
      return null
    }
    const cat = this.data.cats.find(c => c.on)
    if (!cat) {
      wx.showToast({ title: T.t('itemEdit.no_category'), icon: 'none' })
      return null
    }
    const sub = this.data.subs.find(s => s.on)
    return {
      id: this.data.id,
      name: (this.data.name || '').trim(),
      category: cat.key,
      sub: sub ? sub.key : '',   // 细分可不选，空串表示没细分
      colors: this.data.colors.filter(c => c.on).map(c => c.key),
      seasons: this.data.seasons.filter(s => s.on).map(s => s.value),
      occasions: this.data.occasions.filter(o => o.on).map(o => o.value),
      image: this.data.image
    }
  },

  /**
   * 保存 = **记录立刻提交，照片后台传**（2026-09 图片改异步上传）
   *
   * 以前是「先传照片、再提交记录」，弱网下点了保存要盯着 loading 等好几秒；
   * 现在只等记录提交（几十毫秒），照片由 cloud.flushUploads() 在后台传到 OSS，
   * 本机照片路径留在记录里，衣橱列表照常显示（格子右下角会有「待上传」小角标）。
   * 记录本身提交失败照旧弹提示、留在本页（刚填的内容一个都不丢），再点一次保存就行。
   */
  onSave() {
    const payload = this.validate()
    if (!payload) return
    this.applyImageUrl(payload)

    // 勾了「剩下几张都用这套属性」：当前这件 + 剩下没录的，一次生成 N 条（一个请求）
    const rest = this.data.isAdd ? this.data.photos.filter((p, i) => !p.done && i !== this.data.cur).length : 0
    if (this.data.batchSame && rest > 0) {
      this.saveBatch(payload)
      return
    }

    const step = (msg) => wx.showLoading({ title: msg, mask: true })
    step(T.t('itemEdit.saving'))
    cloud.saveItem(payload, step).then(() => {
      wx.hideLoading()
      if (this.afterSaved(payload.image)) return   // 还有没录的 → 自动跳过去
      wx.showToast({ title: T.t('itemEdit.saved'), icon: 'none' })
      setTimeout(() => wx.navigateBack(), 400)
    }).catch((err) => {
      wx.hideLoading()
      // 额度用完（后端 4001 总额度 / 4002 今天录满）：不是网络问题，别让人一遍遍点保存
      if (err && (err.code === cloud.ITEM_LIMIT_CODE || err.code === cloud.DAILY_LIMIT_CODE)) {
        this.showQuotaFull(err)
        return
      }
      wx.showModal({
        title: T.t('itemEdit.save_fail_title'),
        content: T.t('itemEdit.save_fail_content', { msg: (err && err.msg) || T.t('common.retry_later') }),
        showCancel: false
      })
    })
  },

  /**
   * 一件录完后的收尾：标成已录、从待录入队列里摘掉，并自动跳到**下一张没录的**
   * @param {string} path 刚存完的那张照片路径
   * @return {boolean} 有没有跳到下一张（false = 这一批全录完了，调用方回衣橱）
   */
  afterSaved(path) {
    const photos = this.data.photos
    if (!photos.length) return false              // 编辑已有衣物 / 不在批量里
    const i = photos.findIndex(p => p.path === path)
    if (i < 0) return false
    photos[i].done = true
    if (path) store.removePendingPhoto(path)      // 队列里摘掉这一张（其它张继续留着）
    const next = photos.findIndex(p => !p.done)
    this.setData({ photos })
    this.syncQueueText()
    if (next < 0) return false
    this.usePhoto(next)
    wx.showToast({ title: T.t('itemEdit.saved_next'), icon: 'none' })
    return true
  },

  /** 顶部进度文案 + 「剩下几张都用这套属性」的计数（都在这里统一算，别各算一份） */
  syncQueueText() {
    const photos = this.data.photos
    const cur = this.data.cur
    // 其它还没录的（不含当前这张）：勾了「套用这套属性」时一起生成
    const restCount = photos.filter((p, i) => !p.done && i !== cur).length

    if (photos.length < 2) {
      this.setData({ queueText: '', restCount })
      return
    }
    const done = photos.filter(p => p.done).length
    this.setData({
      queueText: '已录 ' + done + ' / ' + photos.length + ' 张，点缩略图切换',
      restCount
    })
  },

  /** 当前表单快照（切到别的照片时先把它存起来，切回来还在） */
  snapshotForm() {
    const d = this.data
    return {
      name: d.name,
      cats: d.cats,
      subs: d.subs,
      colors: d.colors,
      seasons: d.seasons,
      occasions: d.occasions,
      moreOpen: d.moreOpen,
      moreSummary: d.moreSummary,
      batchSame: d.batchSame
    }
  },

  /** 一张空白表单（新照片的默认值：季节按当前月份预选，其余都不选） */
  blankForm() {
    const presetSeason = this.seasonByMonth()
    return {
      name: '',
      cats: this.data.cats.map(c => Object.assign({}, c, { on: false })),
      subs: [],
      colors: this.data.colors.map(c => Object.assign({}, c, { on: false })),
      seasons: this.data.seasons.map(s => ({ value: s.value, on: s.value === presetSeason })),
      occasions: this.data.occasions.map(o => ({ value: o.value, on: false })),
      moreOpen: false,
      moreSummary: '未填',
      batchSame: false
    }
  },

  /** 切到第 i 张（把当前表单存回它自己那份，再取出目标那张的） */
  usePhoto(i) {
    const photos = this.data.photos
    const target = photos[i]
    if (!target) return
    if (photos[this.data.cur]) photos[this.data.cur].form = this.snapshotForm()

    this.setData(Object.assign({
      photos,
      cur: i,
      id: '',
      isEdit: false,
      isAdd: true,
      image: target.path,
      photoSrc: target.path,
      origPhoto: target.path
    }, target.form || this.blankForm()))
    this.syncQueueText()
  },

  /** 点缩略图切换：已录的置灰不可点（点了提示一下） */
  onPickThumb(e) {
    const i = Number(e.currentTarget.dataset.i)
    const p = this.data.photos[i]
    if (!p) return
    if (p.done) {
      wx.showToast({ title: T.t('itemEdit.already_saved'), icon: 'none' })
      return
    }
    if (i === this.data.cur) return
    this.usePhoto(i)
  },

  /**
   * 「剩下 N 张都用这套属性」：当前这件 + 这一批里其它没录的，一次提交成多条记录
   *
   * 名称：填过名称就从第 2 件起加序号（白T 2 / 白T 3），没填就都留空（列表显示品类名）。
   * createdAt / id 时间戳按序号错开 1ms：同一毫秒会让衣橱列表顺序变得不确定。
   */
  /**
   * 衣架不够：给一个能直接去处理的入口，别只弹个错误（2026-09 第三版：额度＝衣架）
   *
   * 两种分开口径：
   *   4001 总衣架不够 → 文案固定为「衣架用完了，想继续挂可以联系客服。」
   *                     ⚠️ 例外：这次要挂的比剩的多（后端会明说「衣架不够了：还剩 N 个，这次要挂 M 个」）时，
   *                     照后端的话显示 —— 那时候衣架并没真的用完，说「用完了」是错的
   *                     （也可以删掉不想要的腾出衣架，后端那句里就带着这个出路）
   *   4002 今日衣架不够 → 明天再来 + 联系客服
   * 两种都给「联系客服」当主按钮，别让人看完提示不知道下一步点哪
   */
  showQuotaFull(err) {
    const daily = err && err.code === cloud.DAILY_LIMIT_CODE
    const msg = (err && err.msg) || ''
    const shortOfThisTime = msg.indexOf('还剩') >= 0   // 不是真的用完，是这次要挂太多

    wx.showModal({
      title: T.t(daily ? 'itemEdit.quota_daily_title' : 'itemEdit.quota_total_title'),
      content: daily
        ? (msg || T.t('itemEdit.quota_daily_fallback')) + '\n' + T.t('itemEdit.quota_daily_tail')
        : (shortOfThisTime ? msg : T.t('itemEdit.quota_total_fallback')),
      confirmText: T.t('common.service_ok'),
      cancelText: T.t(daily ? 'common.know' : 'common.go_wardrobe'),
      success: (r) => {
        if (r.confirm) {
          wx.navigateTo({ url: '/pages/service/service' })   // 那页有「进入客服会话」
          return
        }
        if (!daily && r.cancel) wx.navigateBack()   // 4001：回衣橱（长按格子可以删）
      }
    })
  },

  saveBatch(payload) {
    const photos = this.data.photos
    const cur = this.data.cur
    // 当前这张 + 其它还没录的（按缩略图顺序）
    const paths = [this.data.image].concat(
      photos.filter((p, i) => !p.done && i !== cur).map(p => p.path)
    ).filter(Boolean)

    const items = []
    const now = Date.now()
    paths.forEach((path, i) => {
      const p = Object.assign({}, payload, { image: path })
      p.id = 'i' + (now + i)
      p.createdAt = now + i
      if (payload.name) p.name = payload.name + (i === 0 ? '' : ' ' + (i + 1))
      items.push(p)
    })
    if (!items.length) return

    const step = (msg) => wx.showLoading({ title: msg, mask: true })
    step(T.t('itemEdit.saving'))
    cloud.saveItems(items, step).then(() => {
      // 这批全标成已录，并从待录入队列里逐张摘掉
      const used = items.map(it => it.image)
      const next = this.data.photos.map(p => (used.indexOf(p.path) >= 0
        ? Object.assign({}, p, { done: true })
        : p))
      used.forEach(p => store.removePendingPhoto(p))
      this.setData({ photos: next, batchSame: false })
      this.syncQueueText()
      wx.hideLoading()
      wx.showToast({ title: T.t('itemEdit.saved_many', { n: items.length }), icon: 'none' })
      setTimeout(() => wx.navigateBack(), 400)
    }).catch((err) => {
      wx.hideLoading()
      if (err && (err.code === cloud.ITEM_LIMIT_CODE || err.code === cloud.DAILY_LIMIT_CODE)) {
        this.showQuotaFull(err)   // 同上：额度满了，不是网络问题
        return
      }
      wx.showModal({
        title: T.t('itemEdit.save_fail_title'),
        content: T.t('itemEdit.save_fail_content', { msg: (err && err.msg) || T.t('common.retry_later') }),
        showCancel: false
      })
    })
  },

  /** 勾选「剩下几张都用这套属性」 */
  onToggleBatch() {
    this.setData({ batchSame: !this.data.batchSame })
  },

  /**
   * 照片的远程地址（imageUrl）口径：
   *  - 没动照片 → 把记录里原来的 imageUrl 带上（否则提交时会把云端那条的图洗掉）
   *  - 换了 / 删了照片 → 置空，让这次传的新图成为唯一的那张（后端会把旧对象删掉）
   */
  applyImageUrl(payload) {
    const untouched = !!this.data.origPhoto && this.data.photoSrc === this.data.origPhoto
    const old = payload.id ? (store.getItem(payload.id) || {}) : {}
    payload.imageUrl = untouched ? (old.imageUrl || '') : ''

    // 洗白底那两列（2026-09）：照片动过就一起清掉（旧白底图对应的是旧原图，留着会串）；
    // 没动就带上当前状态（后端按"请求里有没有这个键"决定改不改，带上才是最新真相）
    if (untouched) {
      payload.originalImageUrl = this.data.origUrl || old.originalImageUrl || ''
      payload.normalizedUrl = this.data.whiteUrl || old.normalizedUrl || ''
    } else {
      payload.originalImageUrl = ''
      payload.normalizedUrl = ''
    }

    // 洗白底时已经把这张本机照片传上去了 → 直接用它当 imageUrl，别再传一遍
    // （二次上传会生成另一个 key，"白底图对应哪张原图"的指纹就对不上，下次还得重洗花钱）
    if (!payload.imageUrl && this.data.origUrl && this.data.origUrlFor === this.data.photoSrc) {
      payload.imageUrl = this.data.origUrl
    }

    // 封面选的是哪张：用户点了「用白底图」/「切回原图」都体现在这里
    if (this.data.whiteUrl) {
      if (this.data.coverChoice === 'white') {
        payload.originalImageUrl = payload.originalImageUrl || this.data.origUrl || payload.imageUrl
        payload.imageUrl = this.data.whiteUrl
      } else if (this.data.coverChoice === 'orig' && this.data.origUrl
        && this.data.origUrlFor === this.data.photoSrc && payload.imageUrl !== this.data.origUrl) {
        payload.imageUrl = this.data.origUrl
      }
    }

    return payload
  },

  // ===== 洗白底（归一化 · 2026-09）=====

  /**
   * 问一次后端：这个功能开着吗、今天还能洗几次
   * 关着就整块入口不显示（跟 AI 试穿那个入口一个套路）；没登录 / 问失败就静默不显示
   */
  loadNormalize() {
    if (!api.isLoggedIn()) {
      console.log('[wash] 入口不显示：还没登录')
      return
    }

    api.items.normalizeStatus().then((d) => {
      this.setData({
        normalizeOn: !!(d && d.enabled),
        normalizeLeft: (d && typeof d.leftToday === 'number') ? d.leftToday : 0,
        normalizeUnlimited: !!(d && d.unlimited)
      })
      this.buildWashLabels()
      if (!(d && d.enabled)) console.log('[wash] 入口不显示：后端开关关着（NORMALIZE_ENABLED）')
    }).catch((err) => {
      // 拿不到就不显示（不打扰用户），但要留原因：多半是 baseUrl 指着还没发版的后端
      console.log('[wash] 入口不显示：状态接口没通 —— ' + ((err && (err.msg || err.code)) || '网络失败') +
        '（检查 app.js 的 baseUrl：本地后端才有这个功能）')
    })
  },

  /** 入口那行的文案（标题 + 说明 + 今天还剩几次） */
  buildWashLabels() {
    const left = this.data.normalizeLeft
    this.setData({
      normEntryTitle: T.t('itemEdit.normalize_entry'),
      normEntrySub: this.data.whiteUrl ? T.t('itemEdit.normalize_done_sub') : T.t('itemEdit.normalize_sub'),
      // 管理员不限次数：不显示"还剩几次"，也不用"用完了"那句
      normLeftText: this.data.normalizeUnlimited
        ? T.t('itemEdit.normalize_unlimited')
        : (left > 0 ? T.t('itemEdit.normalize_left', { n: left }) : T.t('itemEdit.normalize_none_left'))
    })
  },

  /**
   * 点入口：洗一张（或已经有就开对比层）
   *
   * 走「先上传 → 再洗」：接口只吃公网 https 地址，而本机照片这会儿还没上云。
   * 洗一次 15~20 秒，所以给整屏 loading（同步接口，不走队列）。
   */
  onNormalize() {
    if (!this.data.photoSrc) {
      wx.showToast({ title: T.t('itemEdit.no_photo'), icon: 'none' })
      return
    }

    // 已经有白底图、而且照片没换过 → 直接开对比层，不用再请求（省钱也省时）
    if (this.data.whiteUrl && this.data.origUrlFor && this.data.origUrlFor === this.data.photoSrc) {
      this.openCompare()
      return
    }

    if (!this.data.normalizeUnlimited && this.data.normalizeLeft <= 0) {
      wx.showModal({
        title: T.t('itemEdit.normalize_fail_title'),
        content: T.t('itemEdit.normalize_none_left'),
        showCancel: false
      })
      return
    }

    this.ensureCloudPhoto().then((url) => {
      if (!url) return

      wx.showLoading({ title: T.t('itemEdit.normalize_working'), mask: true })
      api.items.normalize(this.data.isEdit ? this.data.id : '', url).then((d) => {
        wx.hideLoading()
        this.setData({
          whiteUrl: (d && d.normalizedUrl) || '',
          origUrl: (d && d.sourceUrl) || url,
          origUrlFor: this.data.photoSrc,          // 这张白底图对应的是当前这张照片
          normalizeLeft: (d && typeof d.leftToday === 'number') ? d.leftToday : this.data.normalizeLeft,
          normalizeUnlimited: !!(d && d.unlimited) || this.data.normalizeUnlimited,
          coverChoice: 'orig'                      // 洗完默认还是原图当封面，用户点了才换
        })
        this.buildWashLabels()
        this.openCompare()
      }).catch((err) => {
        wx.hideLoading()
        wx.showModal({
          title: T.t('itemEdit.normalize_fail_title'),
          content: (err && err.msg) || T.t('common.retry_later'),
          showCancel: false
        })
      })
    })
  },

  /**
   * 拿到这张照片的**云端地址**（洗白底必须先有公网 https 地址）
   *  - 编辑已有衣物：显示源本来就是云端地址，直接用
   *  - 新增：本机文件先传 OSS（跟保存时用的是同一个接口）
   */
  ensureCloudPhoto() {
    const local = this.data.image
    if (!local) return Promise.resolve(this.data.photoSrc || this.data.origUrl || '')

    wx.showLoading({ title: T.t('itemEdit.normalize_uploading'), mask: true })
    return api.uploadImage(local, 'clothes', { silent: true }).then((out) => {
      wx.hideLoading()
      return (out && out.url) ? out.url : ''
    }).catch((err) => {
      wx.hideLoading()
      wx.showModal({
        title: T.t('itemEdit.normalize_fail_title'),
        content: (err && err.msg) || T.t('common.retry_later'),
        showCancel: false
      })
      return ''
    })
  },

  /** 打开对比层：左原图 / 右白底图 + 「保持原图」「用这张当封面」 */
  openCompare() {
    this.setData({
      compareOpen: true,
      compareLeft: this.data.origUrl || this.data.photoSrc,
      compareRight: this.data.whiteUrl,
      compareTitle: T.t('itemEdit.normalize_title'),
      compareHint: this.data.coverChoice === 'white'
        ? T.t('itemEdit.normalize_using_white')
        : T.t('itemEdit.normalize_using_orig'),
      labelOrig: T.t('itemEdit.normalize_label_orig'),
      labelWhite: T.t('itemEdit.normalize_label_white'),
      btnKeep: T.t('itemEdit.normalize_keep_orig'),
      btnUse: T.t('itemEdit.normalize_use_white')
    })
  },

  onCompareClose() {
    this.setData({ compareOpen: false })
  },

  /** 「用这张当封面」：展示图（衣橱/搭配/试穿都用它）换成白底图，原图仍然留着 */
  onUseWhite() {
    this.setData({
      compareOpen: false,
      coverChoice: 'white',
      photoShow: this.data.whiteUrl,
      compareHint: T.t('itemEdit.normalize_using_white')
    })
    this.buildWashLabels()
    wx.showToast({ title: T.t('itemEdit.normalize_switched'), icon: 'none' })
  },

  /** 「保持原图」/「切回原图」：展示图回到原图（白底图继续留着，随时能再切） */
  onKeepOriginal() {
    this.setData({
      compareOpen: false,
      coverChoice: 'orig',
      photoShow: this.data.origUrl || this.data.photoSrc
    })
    this.buildWashLabels()
    wx.showToast({ title: T.t('itemEdit.normalize_restored'), icon: 'none' })
  },

  /** 换照片 / 删照片后把洗白底的状态清干净（旧白底图对应的是旧原图，不能再用） */
  resetWash() {
    this.setData({
      whiteUrl: '',
      origUrl: '',
      origUrlFor: '',
      coverChoice: '',
      compareOpen: false,
      photoShow: this.data.photoSrc
    })
    this.buildWashLabels()
  },

  /** 弹层里用来吃掉点击，别让点内容区把弹层关了 */
  noop() {
  },

  /**
   * 再记一件：清照片/品类/细分/颜色/名称，季节回到默认值，场合回到「都不选」，
   * 然后立刻让选下一件的照片（一批一起录的衣服往往季节相同，少点两下）
   *
   * 一批里（一次选了好几张）时这个按钮是不显示的：保存会自动跳到下一张没录的。
   */
  onSaveAndNext() {
    const payload = this.validate()
    if (!payload) return
    this.applyImageUrl(payload)

    const step = (msg) => wx.showLoading({ title: msg, mask: true })
    step(T.t('itemEdit.saving'))
    cloud.saveItem(payload, step).then(() => {
      wx.hideLoading()
      if (this.afterSaved(payload.image)) return
      this.resetForNext()
      wx.showToast({ title: T.t('itemEdit.saved_next'), icon: 'none' })
      this.onPickSource()
    }).catch((err) => {
      wx.hideLoading()
      wx.showModal({
        title: T.t('itemEdit.save_fail_title'),
        content: T.t('itemEdit.save_fail_content', { msg: (err && err.msg) || T.t('common.retry_later') }),
        showCancel: false
      })
    })
  },

  /** 「再记一件」：表单只留季节默认值，其余清空 */
  resetForNext() {
    const presetSeason = this.seasonByMonth()
    this.setData({
      id: '',
      isEdit: false,
      isAdd: true,
      name: '',
      image: '',
      photoSrc: '',
      origPhoto: '',
      moreOpen: false,
      cats: this.data.cats.map(c => Object.assign({}, c, { on: false })),
      subs: [],   // 一级清空 → 二级条一并收起
      colors: this.data.colors.map(c => Object.assign({}, c, { on: false })),
      seasons: this.data.seasons.map(s => ({ value: s.value, on: s.value === presetSeason })),
      occasions: this.data.occasions.map(o => ({ value: o.value, on: false }))
    })
    this.updateSummary()
  }
})
