/**
 * 照片小工具（2026-09 图片改异步上传时加的）
 *
 * chooseMedia 的 sizeType:['compressed'] 只是微信轻压一道，手机原图常有 1600px+、好几 MB；
 * 这里再压一道**质量**（不缩尺寸，衣服照片要能看清花色），上传体积能小一截。
 *
 * 压不动就原样返回：压图失败不算错误，绝不能因为压缩把选照片这一步拦掉。
 */

/**
 * 再压一道照片（异步）
 * @param {string} tempPath chooseMedia 给的临时路径
 * @return {Promise<string>} 压好的临时路径（失败/不支持 = 原路径）
 */
function compress(tempPath) {
  return new Promise((resolve) => {
    if (!tempPath) return resolve(tempPath)
    if (typeof wx.compressImage !== 'function') return resolve(tempPath)   // 老基础库没有这个 API
    wx.compressImage({
      src: tempPath,
      quality: 75,
      success: (r) => resolve((r && r.tempFilePath) || tempPath),
      fail: () => resolve(tempPath)
    })
  })
}

module.exports = { compress }
