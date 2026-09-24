/**
 * 文件内容指纹（2026-09）
 *
 * 用途：判断"这次挑的头像跟上一次上传的是不是同一张"。
 *
 * 为什么需要它：`open-type="chooseAvatar"` 每次给回来的是**新临时文件路径**，
 * 哪怕用户选的还是同一张图，路径也不同 —— 光看路径会当成新头像，白传一次流量。
 *
 * 为什么不用 md5：project.config.json 里 nodeModules:false，不引 npm；
 * 这里用两个 32 位哈希（FNV-1a + djb2）叠在一起，两个都对上才算"没变"。
 * 单个哈希碰撞概率约 1/40 亿，两个一起撞可以忽略。
 *
 * 读不出文件（极少见）返回空串 —— 调用方按"变了"处理，宁可多传一次，也不能不更新头像。
 */

/**
 * @param {string} filePath 本机文件路径
 * @return {string} "长度-h1-h2"，读不出来返回 ''
 */
function ofFile(filePath) {
  if (!filePath) return ''

  try {
    const buf = wx.getFileSystemManager().readFileSync(filePath)
    const u8 = new Uint8Array(buf)

    let h1 = 2166136261          // FNV-1a 32
    let h2 = 5381                // djb2
    for (let i = 0; i < u8.length; i++) {
      // Math.imul：32 位乘法，避免 JS 大数乘法丢精度导致哈希不稳定
      h1 = Math.imul(h1 ^ u8[i], 16777619) >>> 0
      h2 = (Math.imul(h2, 33) ^ u8[i]) >>> 0
    }

    return u8.length + '-' + h1.toString(16) + '-' + h2.toString(16)
  } catch (e) {
    return ''
  }
}

module.exports = { ofFile }
