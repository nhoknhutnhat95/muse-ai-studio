import { isIP } from 'node:net';
import { AppError } from './schema.mjs';
import { quotaAvailability } from './account-quota.mjs';

const SIZES = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const SORTS = ['newest', 'oldest', 'name', 'largest', 'smallest'];
const KINDS = ['all', 'video', 'image'];
const DEFAULTS = {defaults:{size:'16:9',duration:10,concurrency:2},library:{sort:'newest',kind:'all',pageSize:48},queue:{maxParallel:8,taskTimeoutSeconds:600}};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const num = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = (value,max=200) => typeof value === 'string' ? value.slice(0,max) : '';
const bool = value => typeof value === 'boolean' ? value : null;
const field = (value,name,max=200,{empty=false}={}) => {
  if(typeof value!=='string'||value.length>max||(!empty&&!value.trim())||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new AppError(`${name} không hợp lệ.`);
  return value.trim();
};
const id = value => {
  if(typeof value!=='string'||!value||value.length>200||/[\s/\\?#%\x00-\x1f]/.test(value)||['.','..'].includes(value)) throw new AppError('ID không hợp lệ.');
  return encodeURIComponent(value);
};
function fields(input,allowed) {
  if(!object(input)||Object.keys(input).some(key=>!allowed.includes(key))) throw new AppError('Có trường không được hỗ trợ.');
  return input;
}
function page(input={}) {
  const offset=Number(input.offset??0),limit=Number(input.limit??100);
  if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>500)throw new AppError('offset phải ≥ 0; limit phải từ 1 đến 500.');
  return {offset,limit};
}
function choice(value,allowed,label) {
  if(!allowed.includes(value))throw new AppError(`${label} không hợp lệ.`);
  return value;
}
function int(value,min,max,label) {
  if(!Number.isInteger(value)||value<min||value>max)throw new AppError(`${label} phải từ ${min} đến ${max}.`);
  return value;
}

// Whitelists deliberately omit raw quota, cookie expiry maps, notes and error messages.
export function sanitizeQuota(raw) {
  if(!object(raw))return null;
  return {found:raw.found===true,plan:text(raw.plan,80),weekly_reset:text(raw.weekly_reset,120),weekly_used_pct:num(raw.weekly_used_pct),extra_used_pct:num(raw.extra_used_pct),extra_left:text(raw.extra_left,80),extra_expires:text(raw.extra_expires,120),checked_at:num(raw.checked_at)};
}
export function sanitizeAccount(raw) {
  if(!object(raw)||typeof raw.id!=='string')return null;
  const now=Date.now()/1000, expires=num(raw.expires_at);
  return {
    id:text(raw.id),label:text(raw.label),enabled:raw.enabled===true,ok:bool(raw.ok),
    state:raw.enabled===false?'disabled':expires&&expires<now?'expired':raw.ok===true?'healthy':raw.ok===false?'error':'unchecked',
    proxy_id:typeof raw.proxy_id==='string'?text(raw.proxy_id):null,login_type:text(raw.login_type,80),
    expires_at:expires,expires_estimated:raw.expires_estimated===true,created_at:num(raw.created_at),last_used:num(raw.last_used),last_keepalive:num(raw.last_keepalive),checked_at:num(raw.checked_at),synced_at:num(raw.synced_at),
    use_count:num(raw.use_count),cookie_count:num(raw.cookie_count),essential_ok:bool(raw.essential_ok),
    video_24h_count:Array.isArray(raw.video_24h)?raw.video_24h.filter(v=>typeof v==='number'&&v>now-86400).length:0,
    video_fail_streak:num(raw.video_fail_streak),video_cooldown_until:num(raw.video_cooldown_until),
    has_error:!!(raw.dead_reason||raw.video_last_error||raw.ok===false),quota:sanitizeQuota(raw.quota),quotaAvailability:quotaAvailability(sanitizeQuota(raw.quota),now)
  };
}
function proxyAddress(raw) {
  let source=typeof raw.proxy==='string'?raw.proxy:typeof raw.url==='string'?raw.url:'';
  let scheme=['http','https','socks5'].includes(raw.scheme)?raw.scheme:'http';
  let host='',port=null,hasCredentials=!!(raw.has_auth||raw.username||raw.password);
  try {
    if(source.includes('://')) {
      const url=new URL(source);scheme=url.protocol.slice(0,-1);host=url.hostname;port=Number(url.port)||null;hasCredentials||=!!(url.username||url.password);
    } else if(source) {
      const match=source.match(/^(\[[\da-f:]+\]|[a-z\d.-]+):(\d+)(?::([^:]*):(.*))?$/i);
      if(match){host=match[1];port=Number(match[2]);hasCredentials||=match[3]!==undefined;}
    } else {host=text(raw.host,253);port=num(raw.port);}
  } catch { /* A malformed address is never reflected to the client. */ }
  if(!/^(?:[a-z\d.-]+|\[[\da-f:]+\])$/i.test(host)&&!isIP(host))host='';
  if(isIP(host)===6)host=`[${host}]`;
  if(!['http','https','socks5'].includes(scheme))scheme='';
  if(!Number.isInteger(port)||port<1||port>65535)port=null;
  return {scheme,host,port,hasCredentials};
}
export function sanitizeProxy(raw) {
  if(!object(raw)||typeof raw.id!=='string')return null;
  const address=proxyAddress(raw);
  return {id:text(raw.id),name:text(raw.name),...address,display:address.host?`${address.host}${address.port?`:${address.port}`:''}`:'',usage:num(raw.usage),created_at:num(raw.created_at),updated_at:num(raw.updated_at)};
}
function cookieBody(input,{update=false}={}) {
  fields(input,update?['cookie_header']:['label','cookies','cookie_header','batch','expires','login_type','otp_url','proxy_id']);
  const result={};
  for(const key of ['label','login_type','otp_url','proxy_id']) if(input[key]!==undefined) result[key]=input[key]===null&&key!=='label'?null:field(input[key],key,key==='otp_url'?2048:200,{empty:key==='label'||key==='proxy_id'});
  for(const key of ['cookie_header','batch'])if(input[key]!==undefined&&input[key]!==null) result[key]=field(input[key],key,1000000);
  if(input.cookies!==undefined) {
    if(!object(input.cookies)||!Object.keys(input.cookies).length||Object.keys(input.cookies).length>1000||Object.entries(input.cookies).some(([k,v])=>!k||k.length>500||typeof v!=='string'||v.length>20000))throw new AppError('cookies phải là bản đồ tên và giá trị chuỗi.');
    result.cookies=input.cookies;
  }
  if(input.expires!==undefined) {
    if(!object(input.expires)||Object.values(input.expires).some(v=>!Number.isInteger(v)))throw new AppError('expires phải chứa thời điểm dạng số nguyên.');
    result.expires=input.expires;
  }
  if(['cookie_header','batch','cookies'].filter(key=>result[key]!==undefined).length!==1)throw new AppError('Chỉ nhập một trong cookie_header, cookies hoặc batch.');
  return result;
}
function proxyBody(input,{patch=false}={}) {
  fields(input,['name','proxy','scheme']);
  const result={};
  if(input.name!==undefined)result.name=field(input.name,'Tên proxy',40);
  if(input.proxy!==undefined&&input.proxy!=='')result.proxy=field(input.proxy,'Địa chỉ proxy',2048);
  if(input.scheme!==undefined)result.scheme=choice(input.scheme,['http','https','socks5'],'Loại proxy');
  if(!patch&&!result.proxy)throw new AppError('Cần địa chỉ proxy.');
  if(patch&&!Object.keys(result).length)throw new AppError('Chưa có thay đổi proxy.');
  return result;
}
function accountPatch(input) {
  fields(input,['label','enabled','proxy_id']);
  const result={};
  if(input.label!==undefined)result.label=field(input.label,'Tên tài khoản',200,{empty:true});
  if(input.enabled!==undefined){if(typeof input.enabled!=='boolean')throw new AppError('enabled phải là true hoặc false.');result.enabled=input.enabled;}
  if(input.proxy_id!==undefined)result.proxy_id=input.proxy_id===null?null:field(input.proxy_id,'Proxy ID',200,{empty:true});
  if(!Object.keys(result).length)throw new AppError('Chưa có thay đổi tài khoản.');
  return result;
}
function mediaName(name) {
  if(typeof name!=='string'||!name||name.length>255||name==='.'||name==='..'||/[\\/:?*"<>|\x00-\x1f]/.test(name)||/[. ]$/.test(name))throw new AppError('Tên media không hợp lệ.');
  return name;
}
function acknowledgement(raw) {
  return {ok:raw?.ok!==false,added:num(raw?.added),count:num(raw?.count),removed:num(raw?.removed),cookie_count:num(raw?.cookie_count),warning:!!raw?.warning};
}
function proxyTest(raw) {
  return {ok:raw?.ok===true,ip:typeof raw?.ip==='string'&&isIP(raw.ip)?raw.ip:null,ms:num(raw?.ms),error:raw?.error?'Không kết nối được proxy. Kiểm tra địa chỉ và thông tin đăng nhập.':null};
}

/** Every mutation is explicit; construction/listing never tests or modifies Muse accounts. */
export function createAdminService({store,backend,dataDir}={}) {
  if(!store?.db||!backend?.request)throw new TypeError('createAdminService requires store.db and backend.request.');
  store.db.exec('CREATE TABLE IF NOT EXISTS studio_settings (id INTEGER PRIMARY KEY CHECK(id=1), document TEXT NOT NULL)');
  async function request(route,options) {
    try{return await backend.request(route,options);}
    catch(error){
      const status=[400,404,409,422,429,503,504].includes(error?.status)?error.status:502;
      throw new AppError(options?.method&&options.method!=='GET'?'Muse chưa xác nhận thao tác. Hãy tải lại trạng thái trước khi thử lại.':'Không đọc được dữ liệu quản trị Muse.',status,'ADMIN_BACKEND_ERROR');
    }
  }
  const service={
    async accounts(options={}) {
      const {offset,limit}=page(options),search=field(options.search??'','Tìm kiếm',200,{empty:true}).toLocaleLowerCase();
      const state=choice(options.state??'all',['all','healthy','error','disabled','expired','unchecked'],'Trạng thái');
      const quotaState=choice(options.quota??'all',['all','remaining','available','extra_only','exhausted','weekly_exhausted','unknown','stale'],'Hạn mức');
      const sort=choice(options.sort??'remaining',['remaining','exhausted','name','oldest_quota'],'Sắp xếp tài khoản');
      const raw=await request('/admin/accounts');
      const all=(Array.isArray(raw?.accounts)?raw.accounts:[]).map(sanitizeAccount).filter(Boolean);
      const filtered=all.filter(a=>{const q=a.quotaAvailability;return (state==='all'||a.state===state)&&`${a.label} ${a.id}`.toLocaleLowerCase().includes(search)&&(quotaState==='all'||quotaState==='stale'&&q.stale||quotaState==='remaining'&&['available','extra_only'].includes(q.status)||quotaState==='unknown'&&['unknown','weekly_exhausted'].includes(q.status)||q.status===quotaState);});
      const ranks=sort==='exhausted'?{exhausted:0,weekly_exhausted:1,extra_only:2,unknown:3,available:4}:{available:0,extra_only:1,exhausted:2,weekly_exhausted:3,unknown:4};
      filtered.sort((a,b)=>sort==='name'?a.label.localeCompare(b.label):sort==='oldest_quota'?(a.quotaAvailability.checkedAt||0)-(b.quotaAvailability.checkedAt||0):ranks[a.quotaAvailability.status]-ranks[b.quotaAvailability.status]||(b.quotaAvailability.weeklyRemainingPct??-1)-(a.quotaAvailability.weeklyRemainingPct??-1)||a.label.localeCompare(b.label));
      const stats={total:all.length,enabled:all.filter(a=>a.enabled).length,disabled:all.filter(a=>!a.enabled).length,healthy:all.filter(a=>a.state==='healthy').length,error:all.filter(a=>a.state==='error').length,expired:all.filter(a=>a.state==='expired').length,expiring:all.filter(a=>a.expires_at&&a.expires_at>Date.now()/1000&&a.expires_at<Date.now()/1000+43200).length};
      stats.quota={available:0,extra_only:0,exhausted:0,unknown:0,stale:0,weeklyExhausted:0};for(const a of all){const q=a.quotaAvailability;stats.quota[['unknown','weekly_exhausted'].includes(q.status)?'unknown':q.status]++;if(q.stale)stats.quota.stale++;if(q.weeklyRemainingPct===0)stats.quota.weeklyExhausted++;}
      return {accounts:filtered.slice(offset,offset+limit),stats,total:filtered.length,offset,limit};
    },
    async account(aid) {
      id(aid);const raw=await request('/admin/accounts');const account=(raw?.accounts??[]).find(a=>a.id===aid);
      if(!account)throw new AppError('Không tìm thấy tài khoản.',404,'NOT_FOUND');
      return sanitizeAccount(account);
    },
    async addAccount(input){return acknowledgement(await request('/admin/accounts',{method:'POST',body:cookieBody(input)}));},
    async updateAccount(aid,input){return acknowledgement(await request(`/admin/accounts/${id(aid)}`,{method:'PATCH',body:accountPatch(input)}));},
    async updateCookies(aid,input){return acknowledgement(await request(`/admin/accounts/${id(aid)}/cookies`,{method:'POST',body:cookieBody(input,{update:true})}));},
    async deleteAccount(aid){return acknowledgement(await request(`/admin/accounts/${id(aid)}`,{method:'DELETE'}));},
    async testAccount(aid){const r=await request(`/admin/accounts/${id(aid)}/test`,{method:'POST',timeout:180000});return {ok:r?.ok===true,quota:sanitizeQuota(r?.quota),quota_error:!!r?.quota_error};},
    async quota(aid){const r=await request(`/admin/accounts/${id(aid)}/quota`,{method:'POST',timeout:180000});return sanitizeQuota(r?.quota??r);},
    async keepaliveAccount(aid){const r=await request(`/admin/accounts/${id(aid)}/keepalive`,{method:'POST',timeout:180000});return {ok:r?.ok===true,error:!!r?.error};},
    async keepaliveAll(){const r=await request('/admin/accounts/keepalive?force=true',{method:'POST',timeout:180000});return {ok:r?.ok!==false,status:r?.status==='busy'?'busy':'complete',refreshed_count:num(r?.refreshed_count),skipped_count:num(r?.skipped_count)};},
    async proxies(){const r=await request('/admin/proxies');return {proxies:(Array.isArray(r?.proxies)?r.proxies:[]).map(sanitizeProxy).filter(Boolean)};},
    async addProxy(input){return acknowledgement(await request('/admin/proxies',{method:'POST',body:proxyBody(input)}));},
    async updateProxy(pid,input){return acknowledgement(await request(`/admin/proxies/${id(pid)}`,{method:'PATCH',body:proxyBody(input,{patch:true})}));},
    async deleteProxy(pid){return acknowledgement(await request(`/admin/proxies/${id(pid)}`,{method:'DELETE'}));},
    async testProxy(pid){return proxyTest(await request(`/admin/proxies/${id(pid)}/test`,{method:'POST',timeout:30000}));},
    async testProxyDraft(input){return proxyTest(await request('/admin/proxies/test',{method:'POST',body:proxyBody(input),timeout:30000}));},
    settings(){
      const record=store.db.prepare('SELECT document FROM studio_settings WHERE id=1').get();
      const saved=record?JSON.parse(record.document):{};
      return Object.fromEntries(Object.entries(DEFAULTS).map(([key,value])=>[key,{...value,...(object(saved[key])?saved[key]:{})}]));
    },
    updateSettings(input){
      fields(input,['defaults','library','queue']);const next=service.settings();
      if(input.defaults!==undefined){fields(input.defaults,['size','duration','concurrency']);const d=input.defaults;if(d.size!==undefined)next.defaults.size=choice(d.size,SIZES,'Tỷ lệ');if(d.duration!==undefined)next.defaults.duration=int(d.duration,1,30,'Thời lượng');if(d.concurrency!==undefined)next.defaults.concurrency=int(d.concurrency,1,8,'Số tác vụ song song');}
      if(input.library!==undefined){fields(input.library,['sort','kind','pageSize']);const p=input.library;if(p.sort!==undefined)next.library.sort=choice(p.sort,SORTS,'Thứ tự');if(p.kind!==undefined)next.library.kind=choice(p.kind,KINDS,'Loại media');if(p.pageSize!==undefined)next.library.pageSize=int(p.pageSize,1,500,'Số media mỗi trang');}
      if(input.queue!==undefined){fields(input.queue,['maxParallel','taskTimeoutSeconds']);const q=input.queue;if(q.maxParallel!==undefined)next.queue.maxParallel=int(q.maxParallel,1,8,'Tổng tác vụ song song của web');if(q.taskTimeoutSeconds!==undefined)next.queue.taskTimeoutSeconds=int(q.taskTimeoutSeconds,60,1800,'Thời gian chờ tác vụ');}
      store.db.prepare('INSERT INTO studio_settings(id,document) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document').run(JSON.stringify(next));return next;
    },
    async library(options={}){
      const prefs=service.settings().library;
      const {offset,limit}=page({...options,limit:options.limit??prefs.pageSize});
      const search=field(options.search??'','Tìm kiếm',200,{empty:true}).toLocaleLowerCase();
      const kind=choice(options.kind??prefs.kind,KINDS,'Loại media'),sort=choice(options.sort??prefs.sort,SORTS,'Thứ tự');
      const raw=await request('/admin/media');
      const all=(Array.isArray(raw?.media)?raw.media:[]).flatMap(m=>{
        try{mediaName(m.name);}catch{return [];}
        const type=m.kind==='video'||m.kind==='image'?m.kind:/\.(mp4|webm|mov)$/i.test(m.name)?'video':'image';
        return [{name:m.name,kind:type,bytes:num(m.bytes)??0,mtime:num(m.mtime)??0,url:`/v1/media/${encodeURIComponent(m.name)}`}];
      });
      const items=all.filter(m=>(kind==='all'||kind===m.kind)&&m.name.toLocaleLowerCase().includes(search));
      items.sort((a,b)=>sort==='oldest'?a.mtime-b.mtime||a.name.localeCompare(b.name):sort==='name'?a.name.localeCompare(b.name):sort==='largest'?b.bytes-a.bytes||b.mtime-a.mtime:sort==='smallest'?a.bytes-b.bytes||b.mtime-a.mtime:b.mtime-a.mtime||a.name.localeCompare(b.name));
      return {media:items.slice(offset,offset+limit),count:items.length,total:all.length,offset,limit,sort,kind,bytes:items.reduce((sum,m)=>sum+m.bytes,0)};
    },
    async deleteMedia(names){
      if(!Array.isArray(names)||!names.length||names.length>500)throw new AppError('Chọn từ 1 đến 500 media để xóa.');
      const selected=[...new Set(names.map(mediaName))];const raw=await request('/admin/media/delete',{method:'POST',body:{names:selected}});
      return {ok:raw?.ok!==false,removed:num(raw?.removed)};
    }
  };
  return service;
}
