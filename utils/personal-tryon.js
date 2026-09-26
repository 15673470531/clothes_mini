const api = require('./api.js')
function dev() { try { return wx.getAccountInfoSync().miniProgram.envVersion === 'develop' } catch(e) { return false } }
function visibility(page) {
  page.setData({ personalTryonVisible: dev() })
  if (!api.isLoggedIn()) return
  const token = wx.getStorageSync('token')
  api.request('/personal-tryon', 'GET', { capability: 1 }, { silent: true }).then(d => {
    if (wx.getStorageSync('token') === token) page.setData({ personalTryonVisible: dev() || !!d.allowed })
  }).catch(() => {})
}
function open(query = '') { wx.navigateTo({ url: '/pages/personal-tryon/personal-tryon' + query }) }
module.exports = { visibility, open }
