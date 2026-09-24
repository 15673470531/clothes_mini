/**
 * 自定义底部导航：衣橱 / 穿搭 / 日历 / 我的
 * ⚠️ 这里的数组顺序就是 tab 索引：衣橱0 穿搭1 日历2 我的3；各 tab 页 onShow 里 setSelected 要对上
 *
 * 注意：app.json 里的 pagePath 不带前导斜杠，这里的路径要带；
 * 每个 tab 页的 onShow 里调 this.getTabBar().setSelected(<索引>) 同步高亮。
 */
Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/wardrobe/wardrobe', text: '衣橱', icon: 'wardrobe' },
      { pagePath: '/pages/outfit/outfit', text: '穿搭', icon: 'outfit' },
      { pagePath: '/pages/calendar/calendar', text: '日历', icon: 'cal' },
      { pagePath: '/pages/mine/mine', text: '我的', icon: 'user' }
    ]
  },

  methods: {
    /**
     * 同步高亮索引：各 tab 页的 onShow 里调 this.getTabBar().setSelected(n)
     *
     * 必须存在这个方法：页面 onShow 里那句调用一旦抛「不是函数」，
     * 会把后面的 refresh() 一起带崩（衣橱列表/件数就不刷新了）。
     * 注意 wxml 里用的是 selected === index 严格比较，这里统一转成数字。
     */
    setSelected(index) {
      const i = Number(index)
      if (this.data.selected !== i) this.setData({ selected: i })
    },

    onTab(e) {
      const { index, path } = e.currentTarget.dataset
      if (index === this.data.selected) return
      // tab 页只能用 switchTab，用 navigateTo 会静默失败
      wx.switchTab({ url: path })
    }
  }
})
