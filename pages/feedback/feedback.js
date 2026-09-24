/**
 * 意见反馈（从「我的 → 意见反馈」进来，需要登录）
 *
 * 提交到后端 POST /api/feedback/submit（带 token，后端记 user_id），
 * 之后在 Filament 后台「意见反馈」里能看到。
 * 只收内容：**不要联系方式**（用户 2026-09 明确要求去掉）——后端 contact 字段留着但不填。
 */

const api = require('../../utils/api.js')
const T = require('../../utils/texts.js')

Page({
  data: {
    content: ''
  },

  onInput(e) {
    this.setData({ content: e.detail.value })
  },

  onSubmit() {
    const content = (this.data.content || '').trim()
    if (!content) {
      wx.showToast({ title: T.t('feedback.empty'), icon: 'none' })
      return
    }
    api.feedback.submit({ content }).then(() => {
      wx.showToast({ title: T.t('feedback.thanks'), icon: 'success' })
      setTimeout(() => wx.navigateBack(), 1500)
    }).catch((err) => {
      wx.showToast({ title: (err && err.msg) || T.t('feedback.fail'), icon: 'none' })
    })
  }
})
