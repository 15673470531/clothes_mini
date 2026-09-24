App({
  globalData: {
    version: '0.1.0',

    // 后端地址：按环境切换（改这一行就行）
    //  - 开发者工具：勾上「详情 → 本地设置 → 不校验合法域名」，用 localhost
    //  - 手机真机预览/调试：换成电脑的局域网 IP（如 http://192.168.0.100:8090/api）
    //  - 上线：换成 https 正式域名，并到小程序后台配好 request 合法域名
    // baseUrl: 'http://192.168.0.100:8090/api',
    // baseUrl: 'http://localhost:8090/api',
    baseUrl: 'https://clothes.guozeshui.top/api',
  },

  onLaunch() {
    // 文案表：启动拉一次（拉到就用后端下发的，拉不到就用 utils/texts.js 里的本地默认）
    // 用户 2026-09 定：前端提示语都由后端下发，改文案不用发小程序版本
    require('./utils/texts.js').load()

    // 一期这里会自动「填演示数据」（12 件假衣服 + 3 套假搭配）给人看静态稿。
    // 2026-09 用户要求整个删掉：没登录却看到一堆假数据、删了小程序重进又填一遍，很容易误会。
    // 已装老版本的本机缓存里那批留给 cloud.ready() 里的 purgeDemoData() 清（本机 + 云端一起清）。
  }
})
