/**
 * 联系客服（2026-09）
 *
 * 页面只有一段说明 + 微信官方客服会话按钮，没有别的功能：
 *  - 按钮是原生 <button open-type="contact">：点一下直接进客服会话，用户不用加好友，
 *    消息在微信「客服小助手」里回（⚠️ 要先去小程序后台「客服」里把自己加为客服人员，
 *    没加的话按钮不会有反应；开发者工具里也点不出效果，要真机/线上试）
 *  - 邮箱：**长按那一行**复制到剪贴板（小程序里文字默认不能选中，
 *    所以用 longpress + setClipboardData 做，最省事也最不容易出岔子）
 */
const T = require('../../utils/texts.js')

const CONTACT = {
  mail: '1174430282@qq.com'
}

Page({
  data: {
    mail: CONTACT.mail
  },

  /** 长按复制邮箱 */
  onCopyMail() {
    wx.setClipboardData({
      data: this.data.mail,
      success: () => wx.showToast({ title: T.t('service.email_copied'), icon: 'none' })
    })
  }
})
