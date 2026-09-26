const api = require('../../utils/api.js')
const store = require('../../utils/store.js')
const cloud = require('../../utils/cloud.js')
const request = (path='', method='GET', data={}) => api.request('/personal-tryon'+path,method,data,{silent:true})
Page({
 data: { loggedIn:false, loading:true, allowed:false, enabled:false, portraits:[], tasks:[], items:[], portraitId:0, itemId:'', selectedItem:null, busy:false, error:'', result:null, showOriginal:false, consent:false, leftToday:0 },
 onLoad(options) { this._options=options||{} },
 onShow() { this._visible=true; this._needsSync=true; this.reload() },
 onHide() { this._visible=false; clearTimeout(this._timer) },
 onUnload() { this._visible=false; clearTimeout(this._timer) },
 onLogin() { wx.switchTab({url:'/pages/mine/mine'}) },
 async reload() {
  clearTimeout(this._timer)
  if (!api.isLoggedIn()) { this.setData({loggedIn:false,loading:false,portraits:[],tasks:[],result:null,items:[],selectedItem:null,portraitId:0,itemId:''}); return }
  this.setData({loggedIn:true,error:''})
  const token=wx.getStorageSync('token')
  try {
   const d=await request()
   if (token!==wx.getStorageSync('token')) return
   this.setData({allowed:!!d.allowed,enabled:!!d.enabled,loading:false})
   if (!d.allowed) return
   if(this._needsSync){this._needsSync=false;await cloud.ready()}
   if (token!==wx.getStorageSync('token')) return
   let items=store.getItems().filter(i=>i.category==='top')
   const outfitId=this._options.outfitId
   if(outfitId){const o=store.getOutfit(outfitId);const ids=o?(o.itemIds||[]):[];items=items.filter(i=>ids.includes(i.id))}
   items=items.map(i=>({id:i.id,name:i.name||'上衣',image:i.image||i.imageUrl||'',ready:!!i.imageUrl}))
   const itemId=this.data.itemId || this._options.itemId || (items[0]&&items[0].id)||''
   const portraits=d.portraits||[], tasks=(d.tasks||[]).map(t=>Object.assign({},t,{statusText:({pending:'排队中',running:'生成中',done:'已完成',failed:'未成功'})[t.status]||t.status}))
   const portraitId=portraits.some(p=>p.id===this.data.portraitId)?this.data.portraitId:(portraits[0]&&portraits[0].id)||0
   const selectedItem=items.find(i=>i.id===itemId)||null
   let result=this.data.result ? tasks.find(t=>t.id===this.data.result.id)||null:null
   if(this._activeTask) result=tasks.find(t=>t.id===this._activeTask)||result
   this.setData({portraits,tasks,items,portraitId,itemId:selectedItem?itemId:'',selectedItem,leftToday:d.leftToday,result})
   if(this._visible && tasks.some(t=>t.status==='pending'||t.status==='running')) this._timer=setTimeout(()=>this.reload(),5000)
  } catch(e) { this.setData({loading:false,error:e.msg||e.message||'暂时加载不了，请重试'}) }
 },
 onConsent(e) { this.setData({consent:e.detail.value.includes('yes')}) },
 onChoosePortrait(e) { this.setData({portraitId:Number(e.currentTarget.dataset.id)}) },
 onChooseItem(e) { const itemId=e.currentTarget.dataset.id;this.setData({itemId,selectedItem:this.data.items.find(i=>i.id===itemId)}) },
 onUpload() {
  if(this.data.busy)return
  wx.showModal({title:'上传个人照片',content:'请仅上传你本人或已获得授权的照片。照片保存在私有空间；点击生成时，将交给阿里云试穿服务处理。删除照片会同时删除相关试穿记录。',confirmText:'选择照片',success:r=>{if(!r.confirm)return;wx.chooseMedia({count:1,mediaType:['image'],sourceType:['album','camera'],sizeType:['compressed'],success:r=>this.upload(r.tempFiles[0].tempFilePath)})}})
 },
 upload(path) {
  this.setData({busy:true,error:''})
  wx.uploadFile({url:getApp().globalData.baseUrl+'/personal-tryon/portraits',filePath:path,name:'photo',header:{Authorization:'Bearer '+wx.getStorageSync('token'),Accept:'application/json'},
   success:r=>{try{const d=JSON.parse(r.data);if(r.statusCode<200||r.statusCode>=300||d.code!==0)throw new Error(d.msg||d.message||'上传失败，请使用10MB以内的 JPG/PNG');this.setData({portraitId:d.data.id});this.reload()}catch(e){this.setData({error:e.message})}},
   fail:()=>this.setData({error:'照片上传失败，请重试'}),complete:()=>this.setData({busy:false})})
 },
 async onGenerate() {
  if(this.data.busy)return
  if(!this.data.enabled){this.setData({error:'试穿服务尚未开启'});return}
  if(!this.data.portraitId||!this.data.selectedItem){this.setData({error:'请先选择个人照片和一件上衣'});return}
  if(!this.data.selectedItem.ready){this.setData({error:'衣物照片还没上传完成，请稍后刷新'});return}
  if(!this.data.consent){this.setData({error:'请先确认照片使用说明'});return}
  this.setData({busy:true,error:''})
  try{const d=await request('/tasks','POST',{portraitId:this.data.portraitId,itemId:this.data.itemId});this._activeTask=d.task.id;this.setData({result:d.task,showOriginal:false});await this.reload()}
  catch(e){this.setData({error:e.msg||e.message||'提交失败，请稍后重试'})}
  finally{this.setData({busy:false})}
 },
 onViewTask(e){this._activeTask=Number(e.currentTarget.dataset.id);this.setData({result:this.data.tasks.find(t=>t.id===this._activeTask),showOriginal:false})},
 onCompare(){this.setData({showOriginal:!this.data.showOriginal})},
 onPreview(){const t=this.data.result;if(!t)return;const url=this.data.showOriginal?t.portraitUrl:t.resultUrl;if(url)wx.previewImage({urls:[url]})},
 onDelete(e){if(this.data.busy)return;const {kind,id}=e.currentTarget.dataset;wx.showModal({title:kind==='portrait'?'删除个人照片？':'删除试穿记录？',content:kind==='portrait'?'相关试穿结果也会一起删除，已开始的生成将不再保存结果。':'删除后无法恢复，已完成生成的次数不会返还。',success:async r=>{if(!r.confirm)return;this.setData({busy:true});try{await request('/'+kind+'/'+id,'DELETE');await this.reload()}catch(e){this.setData({error:e.msg||e.message||'删除失败'})}finally{this.setData({busy:false})}}})},
 onGoWardrobe(){wx.switchTab({url:'/pages/wardrobe/wardrobe'})},
 onSave(){const t=this.data.result;if(!t||!t.resultUrl||this.data.busy)return;this.setData({busy:true});wx.downloadFile({url:t.resultUrl,success:r=>{if(r.statusCode!==200){this.setData({busy:false,error:'图片链接可能已过期，请刷新后再保存'});return}wx.saveImageToPhotosAlbum({filePath:r.tempFilePath,success:()=>wx.showToast({title:'已保存'}),fail:e=>{if(/auth|deny/i.test(e.errMsg||''))wx.showModal({title:'需要相册权限',content:'请在设置中允许保存到相册',success:r=>{if(r.confirm)wx.openSetting()}});else this.setData({error:'保存失败，请重试'})},complete:()=>this.setData({busy:false})})},fail:()=>this.setData({busy:false,error:'图片下载失败，请刷新重试'})})}
})
