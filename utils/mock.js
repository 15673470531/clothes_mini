/**
 * 全局常量（品类 / 二级类目 / 颜色 / 季节 / 场合）
 *
 * 2026-09 起这里**只剩常量**：一期那批「自动填演示数据」的假衣物/假搭配已按用户要求删除
 * （见 utils/store.js 的 purgeDemoData —— 还会把老安装里遗留的那批清掉）。
 *
 * 衣物没有照片时，用「品类图标 + 颜色块」表示，不依赖图片资源。
 */

// ===== 品类（衣橱页的筛选 tab 也用它）=====
const CATEGORIES = [
  { key: 'all',    name: '全部', emoji: '👚' },
  { key: 'top',    name: '上装', emoji: '👕' },
  { key: 'bottom', name: '下装', emoji: '👖' },
  { key: 'outer',  name: '外套', emoji: '🧥' },
  { key: 'dress',  name: '裙装', emoji: '👗' },
  { key: 'shoes',  name: '鞋',   emoji: '👟' },
  { key: 'acc',    name: '配饰', emoji: '🧣' }
]

// ===== 二级类目（一级品类 → 细分）=====
// 每个一级类目给 3~4 个细分：3 或 4 个都能在「一行 flex:1 均分」里排满，不出现末行零头
// （用户明确反感同屏并列参差）；筛选条里会在这之上加一个「全部」
const SUBCATEGORIES = {
  top:    [{ key: 'tshirt', name: 'T恤' }, { key: 'shirt', name: '衬衫' }, { key: 'knit', name: '针织' }, { key: 'hoodie', name: '卫衣' }],
  bottom: [{ key: 'jeans', name: '牛仔裤' }, { key: 'slacks', name: '西裤' }, { key: 'casual', name: '休闲裤' }, { key: 'shorts', name: '短裤' }],
  outer:  [{ key: 'jacket', name: '夹克' }, { key: 'coat', name: '大衣' }, { key: 'down', name: '羽绒' }, { key: 'trench', name: '风衣' }],
  dress:  [{ key: 'onepiece', name: '连衣裙' }, { key: 'skirt', name: '半身裙' }, { key: 'overalls', name: '背带裙' }],
  shoes:  [{ key: 'sneaker', name: '运动鞋' }, { key: 'leather', name: '皮鞋' }, { key: 'boots', name: '靴子' }, { key: 'sandal', name: '凉鞋' }],
  acc:    [{ key: 'hat', name: '帽子' }, { key: 'scarf', name: '围巾' }, { key: 'bag', name: '包' }, { key: 'jewel', name: '首饰' }]
}

// ===== 颜色 =====
const COLORS = [
  { key: 'black',  name: '黑',   hex: '#1f2329' },
  { key: 'white',  name: '白',   hex: '#ffffff' },
  { key: 'gray',   name: '灰',   hex: '#9aa0a6' },
  { key: 'beige',  name: '米',   hex: '#d9c9a8' },
  { key: 'brown',  name: '棕',   hex: '#8b5e3c' },
  { key: 'navy',   name: '藏青', hex: '#22315c' },
  { key: 'blue',   name: '蓝',   hex: '#3b82f6' },
  { key: 'green',  name: '绿',   hex: '#2f9e68' },
  { key: 'red',    name: '红',   hex: '#d64545' },
  { key: 'pink',   name: '粉',   hex: '#e890a8' },
  { key: 'yellow', name: '黄',   hex: '#e8b93f' },
  { key: 'purple', name: '紫',   hex: '#7c5cbf' }
]

// ===== 季节 / 场合 =====
const SEASONS = ['春', '夏', '秋', '冬']
const OCCASIONS = ['通勤', '休闲', '运动', '正式', '居家']

/**
 * 按 key 取品类名 / 图标（页面里不要直接查表，统一走这里）
 */
function categoryOf(key) {
  return CATEGORIES.find(c => c.key === key) || CATEGORIES[0]
}

/**
 * 按 key 取颜色对象
 */
function colorOf(key) {
  return COLORS.find(c => c.key === key) || COLORS[0]
}

/**
 * 某个一级品类下的二级类目列表（没有就返回空数组 → 页面据此隐藏二级筛选条）
 */
function subsOf(catKey) {
  return SUBCATEGORIES[catKey] || []
}

/**
 * 二级类目名：取不到返回空串（页面用它做「没名字就显示品类名」的兜底）
 */
function subName(catKey, subKey) {
  const one = subsOf(catKey).find(s => s.key === subKey)
  return one ? one.name : ''
}

/** 没选颜色时用的中性色块（不能让空颜色被当成「黑」显示出来） */
const NEUTRAL_BLOCK = '#F0ECE7'

/**
 * 列表 / 搭配卡片缩略块的呈现：有颜色取第一个，没有就用中性灰
 * @return {{ hex: string, light: boolean }} light=true 表示浅色块，需要描边
 */
function blockOf(colors) {
  const key = (colors || [])[0]
  if (!key) return { hex: NEUTRAL_BLOCK, light: false }
  const c = colorOf(key)
  return { hex: c.hex, light: c.key === 'white' }
}

module.exports = {
  CATEGORIES,
  SUBCATEGORIES,
  COLORS,
  SEASONS,
  OCCASIONS,
  NEUTRAL_BLOCK,
  categoryOf,
  colorOf,
  subsOf,
  subName,
  blockOf
}
