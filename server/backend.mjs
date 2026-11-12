import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './schema.mjs';

export class Backend {
  constructor({base=process.env.MUSE_BACKEND_URL||'http://127.0.0.1:18610', keyFile=process.env.MUSE_KEY_FILE||path.join(process.env.LOCALAPPDATA||'', 'Muse AI Studio','data_general','muse2api_key.txt'), key=process.env.MUSE_API_KEY}={}) {
    const u=new URL(base); if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw new Error('Muse backend phải chạy trên loopback.');
    this.base=u.origin;this.keyFile=keyFile;this.key=key;
  }
  async request(route,{method='GET',body,timeout=20000}={}) {
    let key=this.key;
    if(!key) {try{key=(await readFile(this.keyFile,'utf8')).trim();}catch{throw new AppError('Chưa tìm thấy API key của Muse. Mở Muse AI Studio hoặc đặt MUSE_KEY_FILE.',503,'BACKEND_KEY_MISSING');}}
    let r;
    try {r=await fetch(this.base+route,{method,redirect:'error',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeout)});}catch{throw new AppError('Không nhận được phản hồi từ Muse. Kiểm tra app Muse và kết nối backend.',503,method==='POST'?'SUBMISSION_UNKNOWN':'BACKEND_OFFLINE');}
    const d=await r.json().catch(()=>({}));
    if(!r.ok) {const msg=typeof d.detail==='string'?d.detail:typeof d.error==='string'?d.error:`Muse HTTP ${r.status}`;throw new AppError(msg.replaceAll(key,'[hidden]'),r.status>=500?502:r.status,method==='POST'&&r.status>=500?'SUBMISSION_UNKNOWN':'BACKEND_ERROR');}
    return d;
  }
  async status() {
    try {const d=await this.request('/admin/status');return {connected:true,base:this.base,browserRunning:d.browser_running,accounts:d.stats||{},mediaCount:d.media_count,capacity:d.config?.gen_slots,active:d.config?.gen_active};}
    catch(e){return {connected:false,base:this.base,error:e.message,code:e.code};}
  }
  route(kind,id='') {return (kind==='image'?'/v1/images/tasks':'/v1/videos')+(id?`/${encodeURIComponent(id)}`:'');}
  mediaRoute(raw) {
    const u=new URL(raw,this.base);
    if(u.origin!==this.base||!/^\/v1\/media\/[^/]+$/.test(u.pathname)||decodeURIComponent(u.pathname).includes('..'))throw new AppError('Đường dẫn media từ Muse không hợp lệ.',502);
    return u.pathname;
  }
  async media(raw,range) {
    const route=this.mediaRoute(raw); const r=await fetch(this.base+route,{redirect:'error',headers:{...(this.key?{Authorization:`Bearer ${this.key}`} :{}),...(range?{Range:range}:{})},signal:AbortSignal.timeout(120000)});
    if(!r.ok)throw new AppError(`Không đọc được media (${r.status}).`,502);
    return r;
  }
}
