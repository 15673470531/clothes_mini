/**
 * 出图工具：把一套搭配画成图，两种用途、同一套排版
 *
 * 排版规则（2026-09 用户定版：**互相不遮挡**）
 *  - **大件**（上装/外套/下装/裙装）按位置表的 (行, 列) 落 2 列网格，空格收掉、空行压缩
 *    （位置关系跟预览页一致：上装/外套并排一行 → 下装一行…）。
 *  - **鞋 0.62 倍，放在「下装」正下方**（同列居中、留 8 的间距），不压任何衣物。
 *  - **配饰 0.50 倍，围绕「上装」放**：在上装那一行的右侧、与上装垂直居中（多个就上下排一列），
 *    同样**不覆盖**别的衣物；那一列被占了就往右再让一列。
 *  - 用户原话：「鞋子和配饰不要把上衣和下装挡住了吧，鞋子放下装下面，配饰围绕上装放，不要覆盖」。
 *    所以 OVERLAP 那套贴压做法已删除 —— **任何两件都不许相交**（buildSpots 里有碰撞检查兜底）。
 *
 * 用途：
 *  1) kind='cover' 列表封面 —— 方图（375×375），方形对上列表方格，**零裁切**（contain）
 *  2) kind='album' 相册大图 —— 同一套排版，宽度固定 375、高度按内容算（竖长图）
 *     点「保存图片」时才画，不落盘
 *
 * 尺寸权重是常量，改 WEIGHT 就能整体调手感。
 * 截图/导出走 canvas 2d，dpr=2。任何一步失败都不抛异常：调用方拿到空路径就当没生成
 * （列表退回实时位图、相册提示失败）。
 */

const { CELL_COUNT } = require('./outfit-layout.js')

/** 画布宽度（逻辑像素）与排版常量 */
const BOX = 375
const PAD = 10
const DPR = 2

/** 品类尺寸权重：主体 1.0、鞋 0.62、配饰 0.50（小件别占那么大） */
const WEIGHT = { top: 1, outer: 1, bottom: 1, dress: 1, shoes: 0.62, acc: 0.5 }

/** 位置表 9 格 → (行, 列)：列 0/1 = 左列两栏，列 2 = 右列配饰栏 */
const CELL_RC = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [0, 2], [1, 2], [2, 2]]

/** 排版内部用的「大件格子边长」基准（最后会按画布缩放，随便取） */
const B = 100
const GAP = B * 0.025          // 件与件之间的间距

/** 是不是小件（要缩小并贴靠的） */
function isSmall(cat) {
  return cat === 'shoes' || cat === 'acc'
}

/**
 * 衣物 + 位置表 → 带 (行, 列) 的清单
 * slots 正常（长度 9）就按它定位；老数据/长度不对就按顺序铺
 */
function entriesOf(items, slots) {
  const byId = {}
  ;(items || []).forEach(i => { byId[i.id] = i })
  const out = []
  if (slots && slots.length === CELL_COUNT) {
    slots.forEach((id, idx) => {
      const it = id ? byId[id] : null
      if (it) out.push({ item: it, row: CELL_RC[idx][0], col: CELL_RC[idx][1] })
    })
  } else {
    ;(items || []).forEach((it, i) => {
      const rc = CELL_RC[i] || [2, 2]
      out.push({ item: it, row: rc[0], col: rc[1] })
    })
  }
  return out
}

/**
 * 核心：把清单排成 { spots, bw, bh }
 * spots = [{ item, x, y, w, h }]，坐标以内容左上角为原点（外面再整体居中）
 */
function buildSpots(entries) {
  const bigs = []
  const shoes = []
  const accs = []
  ;(entries || []).forEach(e => {
    const cat = (e.item && e.item.category) || ''
    if (cat === 'shoes') shoes.push(e)
    else if (cat === 'acc') accs.push(e)
    else bigs.push(e)
  })

  const spots = []
  const size = (cat) => {
    const w = WEIGHT[cat]
    return B * (w == null ? 1 : w)
  }

  // ---- 1) 大件：按位置表的 (行, 列) 落位；空行压缩，整列空的话列也压掉 ----
  // 位置关系跟预览页一致（上装/外套并排一行 → 下装一行…）；空格收掉不留白。
  const byRow = {}
  bigs.forEach(e => { (byRow[e.row] = byRow[e.row] || []).push(e) })
  const usedRows = [0, 1, 2].filter(r => byRow[r] && byRow[r].length)
  // 图片按真实宽高占位，避免长裤等窄图仍占用整个正方形。
  const dimensions = (item, side) => {
    const ratio = item.imageWidth > 0 && item.imageHeight > 0 ? item.imageWidth / item.imageHeight : 1
    return { w: ratio < 1 ? side * ratio : side, h: ratio < 1 ? side : side / ratio }
  }
  const usedCols = [...new Set(bigs.map(e => e.col))].sort((a, b) => a - b)
  const colWidths = {}
  const rowHeights = {}
  bigs.forEach(e => {
    const d = dimensions(e.item, B)
    colWidths[e.col] = Math.max(colWidths[e.col] || 0, d.w)
    rowHeights[e.row] = Math.max(rowHeights[e.row] || 0, d.h)
  })
  const placed = {}
  const anchorOf = {}
  let y = 0
  usedRows.forEach(r => {
    byRow[r].forEach(e => {
      const d = dimensions(e.item, B)
      const x = usedCols.slice(0, usedCols.indexOf(e.col)).reduce((sum, col) => sum + colWidths[col] + GAP, 0)
      const sp = { item: e.item, x: x + (colWidths[e.col] - d.w) / 2, y, w: d.w, h: d.h }
      spots.push(sp)
      placed[e.item.id] = sp
      anchorOf[e.item.id] = r
    })
    y += rowHeights[r] + GAP
  })

  // 只有小件、一件大件都没有：小件退回普通网格（但保持各自权重）
  if (!bigs.length) {
    shoes.concat(accs).forEach((e, i) => {
      const s = size((e.item && e.item.category) || '')
      const col = i % 2
      const row = Math.floor(i / 2)
      spots.push({ item: e.item, x: col * (B + GAP), y: row * (B + GAP), w: s, h: s })
    })
    return finish(spots)
  }

  // ---- 2) 贴靠的锚点：优先「下装 / 裙装」，没有就取最下面那件大件 ----
  let anchorEntry = null
  bigs.forEach(e => {
    const cat = (e.item && e.item.category) || ''
    if (cat === 'bottom' || cat === 'dress') {
      if (!anchorEntry || anchorOf[e.item.id] >= anchorOf[anchorEntry.item.id]) anchorEntry = e
    }
  })
  if (!anchorEntry) {
    bigs.forEach(e => {
      if (!anchorEntry || anchorOf[e.item.id] >= anchorOf[anchorEntry.item.id]) anchorEntry = e
    })
  }
  const anchor = placed[anchorEntry.item.id]

  // ---- 2) 鞋：放在「下装」正下方（同列居中、留 GAP），不压任何衣物 ----
  // 多只鞋并排：整组宽度不超下装宽（超了就按上限反算再缩一点），保证整齐地待在裤子下面
  let sw = size('shoes')
  const sgK = 0.04
  if (shoes.length) {
    const need = shoes.length * sw + (shoes.length - 1) * sw * sgK
    if (need > anchor.w) sw = anchor.w / (shoes.length + (shoes.length - 1) * sgK)
  }
  const sg = sw * sgK
  const shoesW = shoes.length ? shoes.length * sw + (shoes.length - 1) * sg : 0
  let shoesX = anchor.x + (anchor.w - shoesW) / 2
  let shoesY = anchor.y + anchor.h + GAP
  let guard = 0
  while (hitsAny(shoesX, shoesY, shoesW, sw, spots) && guard++ < 4) shoesY += B + GAP   // 兜底：被占了就往下让一行
  shoes.forEach((e, i) => {
    spots.push({ item: e.item, x: shoesX + i * (sw + sg), y: shoesY, w: sw, h: sw })
  })

  // ---- 3) 配饰：围绕「上装」放 —— 上装那一行的右侧、与上装垂直居中（多个上下排一列），不覆盖 ----
  const aw = size('acc')
  const ag = aw * 0.06
  const accsH = accs.length ? accs.length * aw + (accs.length - 1) * ag : 0
  // 上装优先；没有上装就用外套、再没有就用第一件大件
  let topEntry = null
  ;['top', 'outer'].forEach(cat => {
    if (topEntry) return
    bigs.forEach(e => { if (!topEntry && (e.item && e.item.category) === cat) topEntry = e })
  })
  if (!topEntry) topEntry = bigs[0]
  const topSp = placed[topEntry.item.id]
  // 上装那一行有哪些大件 → 配饰列放在它们右边
  const rowBigs = bigs.filter(e => placed[e.item.id] && Math.abs(placed[e.item.id].y - topSp.y) < 0.01)
  let accsX = Math.max.apply(null, rowBigs.map(e => placed[e.item.id].x + placed[e.item.id].w)) + GAP
  let accsY = topSp.y + (topSp.h - accsH) / 2
  guard = 0
  while (hitsAny(accsX, accsY, aw, accsH, spots) && guard++ < 4) accsX += B + GAP       // 那一列被占了就往右让
  accs.forEach((e, i) => {
    spots.push({ item: e.item, x: accsX, y: accsY + i * (aw + ag), w: aw, h: aw })
  })

  return finish(spots)
}

/** 两个矩形是否相交（留 0.5 容差，避免浮点噪声误判） */
function overlapRect(a, b) {
  return a.x + a.w > b.x + 0.5 && b.x + b.w > a.x + 0.5 &&
         a.y + a.h > b.y + 0.5 && b.y + b.h > a.y + 0.5
}

/** 候选矩形跟已排好的所有格子是否相交 */
function hitsAny(x, y, w, h, spots) {
  const cand = { x, y, w, h }
  for (let i = 0; i < spots.length; i++) {
    if (overlapRect(cand, spots[i])) return true
  }
  return false
}

/** 归一化到内容左上角（0,0）并给出内容宽高 */
function finish(spots) {
  if (!spots.length) return { spots: [], bw: 0, bh: 0 }
  // 鞋与配饰也按实际图片比例占位，不再在正方形中上下居中留空。
  spots.forEach(s => {
    const t = s.item
    if (!(t.imageWidth > 0 && t.imageHeight > 0)) return
    const k = Math.min(s.w / t.imageWidth, s.h / t.imageHeight)
    const w = t.imageWidth * k
    const h = t.imageHeight * k
    s.x += (s.w - w) / 2
    s.w = w
    s.h = h
  })
  // 逐列向上收紧：只需避让横向有交集的衣物，不被相邻列的高衣物撑出空行。
  const ordered = spots.slice().sort((a, b) => a.y - b.y || a.x - b.x)
  const packed = []
  ordered.forEach(s => {
    let top = 0
    packed.forEach(prev => {
      if (s.x < prev.x + prev.w && prev.x < s.x + s.w) {
        top = Math.max(top, prev.y + prev.h + GAP)
      }
    })
    s.y = top
    packed.push(s)
  })
  const x0 = Math.min.apply(null, spots.map(s => s.x))
  const y0 = Math.min.apply(null, spots.map(s => s.y))
  const x1 = Math.max.apply(null, spots.map(s => s.x + s.w))
  const y1 = Math.max.apply(null, spots.map(s => s.y + s.h))
  spots.forEach(s => { s.x -= x0; s.y -= y0 })
  return { spots, bw: x1 - x0, bh: y1 - y0 }
}

/**
 * 出图排版：cover 方图（内容等比放进方框，整块居中）；album 竖长（宽定、高按内容）
 */
function planFor(entries, kind) {
  const { spots, bw, bh } = buildSpots(entries)
  if (!spots.length) return { w: BOX, h: BOX, spots: [] }
  const inner = BOX - 2 * PAD
  const k = kind === 'album' ? inner / bw : inner / Math.max(bw, bh)
  const w = BOX
  const h = kind === 'album' ? Math.ceil(2 * PAD + bh * k) : BOX
  const dx = (w - bw * k) / 2
  const dy = (h - bh * k) / 2
  return {
    w,
    h,
    spots: spots.map(s => ({ item: s.item, x: dx + s.x * k, y: dy + s.y * k, w: s.w * k, h: s.h * k }))
  }
}

/** 圆角矩形路径 */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** 色块（没照片时的兜底）：底色 + 品类图标 */
function drawBlock(ctx, t, s) {
  const r = Math.max(10, Math.round(Math.min(s.w, s.h) * 0.11))
  ctx.fillStyle = t.color || '#F0ECE7'
  roundRect(ctx, s.x, s.y, s.w, s.h, r)
  ctx.fill()
  if (t.light) {                              // 浅色块描边，避免跟白底糊在一起
    ctx.strokeStyle = '#EFE9E2'
    ctx.lineWidth = Math.max(1, Math.round(Math.min(s.w, s.h) * 0.014))
    ctx.stroke()
  }
  ctx.font = Math.round(Math.min(s.w, s.h) * 0.42) + 'px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#221E2A'
  ctx.fillText(t.emoji || '', s.x + s.w / 2, s.y + s.h / 2 + Math.round(s.h * 0.01))
}

/**
 * 画一个格子：有照片画照片（contain，**不裁切** —— 用户明确不能截断），没有就画色块
 * @param {Function} done 这个格子画完（含图片加载失败兜底）后回调
 */
function drawTile(canvas, ctx, t, s, done) {
  const r = Math.max(10, Math.round(Math.min(s.w, s.h) * 0.11))
  const fallback = () => { drawBlock(ctx, t, s); done() }

  if (!t.image) return fallback()

  let img = null
  try { img = canvas.createImage() } catch (e) { return fallback() }
  if (!img) return fallback()

  img.onload = () => {
    // 有照片时直接绘制，透出整张画布的白底，不铺色块或品类图标。
    ctx.save()
    const scale = Math.min(s.w / img.width, s.h / img.height)   // 整件装进去，不裁
    const w = img.width * scale
    const h = img.height * scale
    ctx.drawImage(img, s.x + (s.w - w) / 2, s.y + (s.h - h) / 2, w, h)
    ctx.restore()
    done()
  }
  img.onerror = fallback
  img.src = t.image
}

/**
 * 把 plan.spots 里的衣物画到 canvas 上（现在互不重叠，顺序只影响极端兜底场景）
 */
function drawDiagram(canvas, ctx, plan, done) {
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, plan.w, plan.h)
  const spots = plan.spots || []
  if (!spots.length) return done()

  let left = spots.length
  const one = () => { left--; if (left <= 0) done() }
  spots.forEach(sp => drawTile(canvas, ctx, sp.item, sp, one))
}

/**
 * 出图：画 → 转临时文件 →（要给路径时）存到本机用户目录
 * @param {Object} page 页面实例（用于 createSelectorQuery）
 * @param {Object} opts {items, slots, kind: 'cover'|'album', destPath: 存盘路径或空串}
 * @param {Function} done (path) => void 成功给路径（存盘路径或临时路径），失败给空串
 */
function shoot(page, opts, done) {
  const o = opts || {}
  const kind = o.kind || 'cover'
  const destPath = o.destPath || ''
  const entries = entriesOf(o.items, o.slots)
  // 只读取尺寸，不改原图；读取失败按原来的方形占位兜底。
  Promise.all(entries.map(e => new Promise(resolve => {
    if (!e.item.image) return resolve(e)
    wx.getImageInfo({
      src: e.item.image,
      success: info => resolve(Object.assign({}, e, { item: Object.assign({}, e.item, {
        image: info.path || e.item.image, imageWidth: info.width, imageHeight: info.height
      }) })),
      fail: () => resolve(e)
    })
  }))).then(measured => {
  const plan = planFor(measured, kind)
  wx.createSelectorQuery()
    .in(page)
    .select('#shot-canvas')
    .fields({ node: true, size: true })
    .exec((res) => {
      const node = res && res[0] && res[0].node
      if (!node) return done('')

      node.width = plan.w * DPR
      node.height = plan.h * DPR
      const ctx = node.getContext('2d')
      ctx.scale(DPR, DPR)

      drawDiagram(node, ctx, plan, () => {
        wx.canvasToTempFilePath({
          canvas: node,
          destWidth: plan.w * DPR,
          destHeight: plan.h * DPR,
          fileType: 'png',
          success: (r) => {
            if (!destPath) return done(r.tempFilePath)     // 相册用：临时文件直接给系统相册
            const fm = wx.getFileSystemManager()
            // 同名文件已存在时 saveFile 会失败，先删掉旧的
            try { fm.unlinkSync(destPath) } catch (e) { /* 不存在就算了 */ }
            fm.saveFile({
              tempFilePath: r.tempFilePath,
              filePath: destPath,
              success: () => done(destPath),
              fail: () => done('')
            })
          },
          fail: () => done('')
        })
      })
    })
  })
}

module.exports = { BOX, PAD, DPR, WEIGHT, CELL_RC, entriesOf, buildSpots, planFor, shoot, overlapRect }
