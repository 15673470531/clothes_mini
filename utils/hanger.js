/**
 * 衣架口径（2026-09 · 第五版：分母改成"账号总资产"）
 *
 * 一个衣架挂一样东西：新增一件衣物占 1 个、新增一套搭配占 1 个（共用一个架子）；
 * 删掉会还回总数；**编辑不占**（换衣物/重出封面/换照片都是"换一张"，旧图会被删掉，云端总数没变）。
 *
 * 界面口径（2026-09 用户定）：
 *  - **只显示总数**（还剩几个 / 一共几个），每日额度不再显示在任何页面上
 *  - 但"今天还能不能加"仍然由每日额度决定（后端拦），所以 full 还是两边都要够；
 *    撞上限时的解释在录入预检和说明页里，不靠界面上的数字
 *
 * 数字（**分母 / 每日上限**）**一律以后端下发为准**（config/quota.php → /api/user/quota），
 * 这里一个数字都不写死：后端没给分母就不显示分母。
 * 分母 = 余额 + 已占用（后端 Quota::occupied()）→ **加/删东西时只有左边那个数动**
 * （2026-09 用户改：上一版分母取 max(免费标准, 余额)，余额超过免费标准后显示成"162 / 162"，
 *  加一件变"161 / 161"，两个数一起减，看着像没有上限）。
 *
 * 文案口径（2026-09 第三版）：「我的」页头部是一张**整行小卡**，左边同时给"可用 / 总数"两个数字
 * （cardText = "衣架 97 / 162"），右边一个「获取更多 ›」按钮进 pages/reward（签到/分享/每月免费领取）。
 * 数字仍然只认后端：后端没给分母（老版本）就只显示可用数，绝不编一个。用完了不写文案，
 * 靠数字变红 + 卡片右侧按钮说话。
 */

const LOW_TOTAL = 20   // 总共剩 ≤20 个开始标黄

/** 剩多少 → 状态：ok / low / none（none = 用完） */
function state(left, lowLine) {
  if (left <= 0) return 'none'
  return left <= lowLine ? 'low' : 'ok'
}

/**
 * 把接口出参翻译成页面要的东西
 * @param {object} q /api/user/quota 的 data
 * @return {object|null} 拿不到数据时返回 null（页面就别显示，免得显示成 0 误导人）
 */
function ofQuota(q) {
  if (!q) return null

  const total = (q.hangerTotal != null) ? q.hangerTotal : (q.itemQuota || 0)
  const daily = (q.hangerDaily != null) ? q.hangerDaily : (q.dailyQuota || 0)
  // 上限（分母）只认后端；后端没给就当未知（0），界面不显示分母、也绝不编一个数
  const totalLimit = Number(q.hangerTotalLimit || 0)

  return {
    total: total,
    totalLimit: totalLimit,
    totalState: state(total, LOW_TOTAL),
    // 今天还能不能加：每日额度也要够（虽然界面上不显示这个数）
    full: (total <= 0 || daily <= 0),

    // 各页面要的文案，都在 JS 里拼好（WXML 不做拼接，项目一贯口径）
    // 我的页衣架卡：可用 / 总数 两个数字一起给（分母没给就只给可用数）
    cardText: totalLimit > 0 ? ('衣架 ' + total + ' / ' + totalLimit) : ('衣架 ' + total),
    heroText: totalLimit > 0 ? (total + ' / ' + totalLimit) : String(total),   // 说明页顶部大数字
    // 说明页「衣架从哪来」第一条：分母 = 账号总资产（免费额度 + 赚来的 + 客服加的），
    // 所以别说"新用户送 N 个"（那会写成"新用户送 162 个"，把赚来的也算进去了）
    freeName: totalLimit > 0 ? ('这个号一共 ' + totalLimit + ' 个') : '新用户免费送一批衣架'
  }
}

module.exports = { ofQuota, state, LOW_TOTAL }
