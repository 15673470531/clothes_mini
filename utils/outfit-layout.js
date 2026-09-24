/**
 * 穿搭「位置表」：一套搭配最多 9 个位置，位置由用户在预览页**拖拽**决定
 *
 *   0 1 | 6      左列两栏：上身(0,1) / 下身(2,3) / 脚(4,5)
 *   2 3 | 7      右列一栏：配饰(6,7,8)
 *   4 5 | 8
 *
 * 搭配里存 `slots` = 长度 9 的数组（元素是衣物 id 或 null）。
 * 老数据（没有 slots）按品类自动落位：上装→0、外套→1、下装→2、裙装→3、鞋→4/5、配饰→6/7/8，
 * 偏好位置都占了就往空格里塞。之后用户拖过就是他说了算：**新增的衣物自动填空位，被删的衣物位置自动空出来**，
 * 归一化永远输出长度 9 的数组，页面/出图/列表缩略图都吃同一份，位置不会各处不一致。
 *
 * 注意：**不再有「每个位置该放什么品类」的提示**（2026-09 用户要求：空格不写品类，用户自己决定什么放哪儿），
 * PREFER 只在「新加进来的衣物落在哪一格」时当默认值用。
 */

const CELL_COUNT = 9

/** 自动落位时每个品类的偏好位置（按顺序取第一个空的） */
const PREFER = {
  top:    [0, 1],
  outer:  [1, 0],
  bottom: [2, 3],
  dress:  [3, 2],
  shoes:  [4, 5],
  acc:    [6, 7, 8]
}

/** 归一化后的位置表：长度 9 的 id 数组 */
function normalizeSlots(items, saved) {
  const out = new Array(CELL_COUNT).fill(null)
  const byId = {}
  ;(items || []).forEach(i => { byId[i.id] = i })

  // 1) 用户存过的位置优先（还存在的衣物才认；同一件只认第一个位置）
  ;(saved || []).forEach((id, idx) => {
    if (idx < CELL_COUNT && id && byId[id] && out.indexOf(id) < 0) out[idx] = id
  })

  // 2) 没位置的（新增的 / 老数据）按品类自动落位，偏好位置满了再找空格
  ;(items || []).forEach(item => {
    if (out.indexOf(item.id) >= 0) return
    const pref = PREFER[item.category] || []
    let at = -1
    for (let i = 0; i < pref.length; i++) { if (!out[pref[i]]) { at = pref[i]; break } }
    if (at < 0) { for (let i = 0; i < CELL_COUNT; i++) { if (!out[i]) { at = i; break } } }
    if (at >= 0) out[at] = item.id          // 位置满了（>9 件的老数据）：这件不占位，页面上仍会算进件数
  })

  return out
}

/** 按位置顺序把衣物排出来（列表缩略图取第一件、出图按这个顺序画） */
function orderedBySlots(items, slots) {
  const byId = {}
  ;(items || []).forEach(i => { byId[i.id] = i })
  return (slots || []).map(id => byId[id]).filter(Boolean)
}

/** 位置表里有几件（空位不算） */
function filledCount(slots) {
  return (slots || []).filter(Boolean).length
}

module.exports = { CELL_COUNT, PREFER, normalizeSlots, orderedBySlots, filledCount }
