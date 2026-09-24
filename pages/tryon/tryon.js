/**
 * AI 试穿 —— 把这套搭配穿到虚拟模特身上（2026-09 · P3）
 *
 * 流程（用户选的 三1：整屏生成中弹层，不可关，出图自动进结果态）：
 *   进页面 → POST /api/tryon {outfitId} → 每 3 秒轮询 GET /api/tryon/{id} → 出图
 *   · 命中缓存（同一套 + 同一个虚拟模特试过）会直接带图回来，几毫秒
 *   · 第一次生成要 30~50 秒：两件衣服各洗一次白底图（各 15~20 秒）+ 试穿
 *
 * 两个按钮：
 *   保存到相册 —— 结果图在后端 OSS 上，先下载到本机再存相册
 *   设为这套的封面 —— 下载到本机 → 走**既有封面链路**（cloud.saveOutfit：传 OSS + 推云端），
 *     这样封面地址的归属跟平时「完成」出的封面完全一样，后端换封面时的清理逻辑不用为它开特例
 *
 * 试的是哪几件由后端决定（自动取这套里第一件上装 + 第一件下装），页面只说明，不给选择。
 * 鞋和配饰不参与（试衣接口只有上装/下装两个槽位，传进去会把鞋当上衣）。
 */

const api = require('../../utils/api.js')
const store = require('../../utils/store.js')
const cloud = require('../../utils/cloud.js')
const T = require('../../utils/texts.js')

const POLL_MS = 3000        // 轮询间隔
const MAX_WAIT = 150000     // 等图上限：实测 30~50 秒，给到 2 分半兜底（超了算超时，可重试）

Page({
  data: {
    outfitId: '',
    state: 'loading',       // loading | done | failed
    taskId: 0,
    resultUrl: '',
    hint: '',               // 结果下面那行小字（说明试了哪几件）
    failText: ''
  },

  onLoad(options) {
    const id = (options && options.id) || ''
    this.setData({ outfitId: id })
    wx.setNavigationBarTitle({ title: '上身效果' })

    if (!id) {
      this.setData({ state: 'failed', failText: '没找到这套搭配' })
      return
    }
    this.submit()
  },

  /** 离开页面就停掉轮询（后端任务照跑，下次进来命中缓存直接拿结果） */
  onUnload() {
    this.stopped = true
    clearTimeout(this._timer)
  },

  /** 提交一次生成；命中缓存直接进结果态 */
  submit() {
    this.stopped = false
    this.setData({ state: 'loading', resultUrl: '', failText: '' })

    api.tryon.create({ outfitId: this.data.outfitId }, { silent: true })
      .then((res) => {
        const t = (res && res.task) || {}
        if (res && res.cached && t.resultUrl) {
          this.showResult(t)
          return
        }
        this.setData({ taskId: t.id })
        this.poll(Date.now())
      })
      .catch((err) => this.fail(err))
  },

  /** 轮询任务状态（单次问失败不打断 —— 网络抖一下不该让用户重来） */
  poll(t0) {
    if (this.stopped) return

    if (Date.now() - t0 > MAX_WAIT) {
      this.setData({ state: 'failed', failText: '生成超时了，再试一次' })
      return
    }

    this._timer = setTimeout(() => {
      api.tryon.get(this.data.taskId)
        .then((res) => {
          const t = (res && res.task) || {}
          if (t.status === 'done') {
            this.showResult(t)
            return
          }
          if (t.status === 'failed') {
            this.setData({ state: 'failed', failText: t.error || '这次没生成成功，再试一次' })
            return
          }
          this.poll(t0)
        })
        .catch(() => this.poll(t0))
    }, POLL_MS)
  },

  showResult(t) {
    if (this.stopped) return

    const g = t.garments || {}
    const parts = []
    if (g.top) parts.push('上装')
    if (g.bottom) parts.push('下装')

    this.setData({
      state: 'done',
      resultUrl: t.resultUrl || '',
      hint: parts.length ? ('试的是这套的 ' + parts.join(' + ') + ' · 鞋和配饰不参与') : ''
    })
  },

  /** 失败态：后端给的 msg 已经是人话（「现在排队的人有点多」这类） */
  fail(err) {
    this.setData({
      state: 'failed',
      failText: (err && err.msg) || '这次没生成成功，再试一次'
    })
  },

  onRetry() {
    this.submit()
  },

  onPreview() {
    if (!this.data.resultUrl) return
    wx.previewImage({ urls: [this.data.resultUrl] })
  },

  /** 结果图下载到本机（存相册 / 设封面都要先有本机文件） */
  download(then) {
    wx.showLoading({ title: T.t('tryon.processing'), mask: true })
    wx.downloadFile({
      url: this.data.resultUrl,
      success: (r) => {
        if (r.statusCode !== 200) {
          wx.hideLoading()
          wx.showToast({ title: T.t('tryon.download_fail'), icon: 'none' })
          return
        }
        then(r.tempFilePath)
      },
      fail: () => {
        wx.hideLoading()
        // 域名没加进「downloadFile 合法域名」时也会走到这（见 docs）
        wx.showToast({ title: T.t('tryon.download_fail'), icon: 'none' })
      }
    })
  },

  onSaveAlbum() {
    if (!this.data.resultUrl) return
    this.download((path) => {
      wx.saveImageToPhotosAlbum({
        filePath: path,
        success: () => { wx.hideLoading(); wx.showToast({ title: T.t('tryon.saved_album'), icon: 'none' }) },
        fail: (err) => {
          wx.hideLoading()
          // 用户拒绝过相册权限：引导去设置里打开（跟搭配页「保存图片」同一套处理）
          if (err && String(err.errMsg || '').indexOf('auth') >= 0) {
            wx.showModal({
              title: T.t('tryon.album_auth_title'),
              content: T.t('tryon.album_auth_content'),
              success: (r) => { if (r.confirm) wx.openSetting() }
            })
            return
          }
          wx.showToast({ title: T.t('tryon.save_fail'), icon: 'none' })
        }
      })
    })
  },

  /** 设为这套搭配的封面：本机存一张 + 传 OSS + 推云端（复用既有封面链路） */
  onSetCover() {
    const id = this.data.outfitId
    if (!this.data.resultUrl || !id) return

    this.download((tempPath) => {
      const fs = wx.getFileSystemManager()
      // 文件名带唯一后缀：同名路径会被小程序的图片缓存吃掉（真机上就是「换了图不更新」）
      const dest = wx.env.USER_DATA_PATH + '/tryon_' + id + '_' + Date.now() + '.jpg'

      fs.saveFile({
        tempFilePath: tempPath,
        filePath: dest,
        success: () => {
          store.setOutfitPhoto(id, dest, store.outfitSig(id))
          const o = store.getOutfit(id) || {}
          cloud.saveOutfit(o, dest).then(() => {
            wx.hideLoading()
            wx.showToast({ title: T.t('tryon.set_cover_ok'), icon: 'none' })
          }).catch(() => {
            wx.hideLoading()
            wx.showToast({ title: T.t('tryon.set_cover_local'), icon: 'none' })
          })
        },
        fail: () => {
          wx.hideLoading()
          wx.showToast({ title: T.t('tryon.save_fail'), icon: 'none' })
        }
      })
    })
  }
})
