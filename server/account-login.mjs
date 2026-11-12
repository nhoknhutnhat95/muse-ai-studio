import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { LoginError, parseLoginText, claimAccounts } from './account-login-input.mjs';
import { loginWithBrowser, loginCapabilities } from './account-login-browser.mjs';

const activeStates=['queued','running','cancelling'];
const terminalRows=['completed','failed','skipped','cancelled','unknown','interrupted'];
const safeId=/^[a-zA-Z0-9_-]{1,200}$/;
async function selectedProxy(backend,id) {
  if(!id)return undefined;
  try {
    const file=process.env.MUSE_PROXY_FILE||backend.proxyFile||path.join(path.dirname(backend.keyFile),'muse2api_data','proxies.json');
    const data=JSON.parse(await readFile(file,'utf8'));
    const list=Array.isArray(data)?data:Array.isArray(data.proxies)?data.proxies:Object.values(data.proxies||data);
    const record=list.find(p=>p?.id===id);if(!record)throw Error();
    let raw=record.proxy||record.url;
    if(!raw&&record.host&&record.port)raw=`${record.scheme||'http'}://${record.host}:${record.port}`;
    if(!raw)throw Error();
    if(!raw.includes('://')){const [host,port,user,pass]=raw.split(':');raw=`${record.scheme||'http'}://${user?encodeURIComponent(user)+':'+encodeURIComponent(pass||'')+'@':''}${host}:${port}`;}
    const u=new URL(raw);if(!['http:','https:','socks5:'].includes(u.protocol)||!u.port)throw Error();
    const username=decodeURIComponent(u.username)||record.username,password=decodeURIComponent(u.password)||record.password;
    if(u.protocol==='socks5:'&&(username||password))throw Error();
    return {server:`${u.protocol}//${u.hostname}:${u.port}`,...(username?{username,password:password||''}:{})};
  } catch {throw new LoginError('LOGIN_PROXY','Không đọc được proxy đã chọn hoặc loại xác thực chưa được hỗ trợ. Chọn proxy khác; hệ thống không tự chuyển sang kết nối trực tiếp.');}
}

export function createAccountLoginService({store,backend,admin,login=loginWithBrowser,claim=claimAccounts,capabilities=loginCapabilities,resolveProxy=id=>selectedProxy(backend,id)}) {
  const db=store.db;let active=null,closed=false;
  db.exec('CREATE TABLE IF NOT EXISTS account_login_jobs (id TEXT PRIMARY KEY, document TEXT NOT NULL)');
  const save=job=>{job.updated=Date.now();db.prepare('INSERT INTO account_login_jobs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document').run(job.id,JSON.stringify(job));};
  const snapshot=job=>JSON.parse(JSON.stringify(job));
  for(const record of db.prepare('SELECT document FROM account_login_jobs').all()) {
    const job=JSON.parse(record.document);if(!activeStates.includes(job.state))continue;
    job.state='interrupted';job.message='Web đã khởi động lại. Kiểm tra danh sách tài khoản trước khi đăng nhập lại.';
    for(const row of job.rows)if(!terminalRows.includes(row.state)){row.state=row.state==='saving'?'unknown':'interrupted';row.message=row.state==='unknown'?'Chưa xác định đã lưu hay chưa; tải lại danh sách tài khoản.':'Đã gián đoạn, không tự đăng nhập lại.';}
    save(job);
  }
  function get(id) {const row=db.prepare('SELECT document FROM account_login_jobs WHERE id=?').get(id);if(!row)throw new LoginError('LOGIN_NOT_FOUND','Không tìm thấy tiến trình đăng nhập.',404);return JSON.parse(row.document);}
  function list(){return db.prepare('SELECT document FROM account_login_jobs ORDER BY rowid DESC LIMIT 20').all().map(r=>JSON.parse(r.document));}
  function update(job,row,patch){Object.assign(row,patch);save(job);}
  async function known(label) {const result=await admin.accounts({search:label,limit:500});return result.accounts.find(a=>a.label.toLowerCase()===label.toLowerCase());}
  async function run(job,inputs,controller,proxyId) {
    const signal=controller.signal;
    try {
      const status=await backend.status();if(!status.connected)throw new LoginError('LOGIN_BACKEND','Backend chưa sẵn sàng. Xem mục Kết nối Muse và chạy lại launcher trước khi thêm tài khoản.',503);
      const proxy=await resolveProxy(proxyId);
      job.state='running';save(job);
      for(let index=0;index<inputs.length;index++) {
        const account=inputs[index],row=job.rows[index];
        if(signal.aborted)break;
        try {
          if(account.type==='CLAIM') {
            update(job,row,{state:'running',message:'Đang lấy tài khoản từ mã nhập…'});
            const expanded=await claim(account.code,{signal});
            if(signal.aborted)break;
            if(inputs.length-1+expanded.length>100)throw new LoginError('LOGIN_LIMIT','Tổng số tài khoản sau khi đổi mã vượt quá 100.');
            inputs.splice(index,1,...expanded);job.rows.splice(index,1,...expanded.map(a=>({label:a.email,type:a.type,state:'queued',message:'Chờ đăng nhập'})));save(job);index--;continue;
          }
          const existing=await known(row.label);
          if(existing){update(job,row,{state:'skipped',accountId:existing.id,message:'Tài khoản đã có trong Muse; giữ nguyên phiên hiện tại.'});inputs[index]=null;continue;}
          update(job,row,{state:'running',message:'Đang chuẩn bị đăng nhập…'});
          const session=await login(account,{mode:job.mode,signal,proxy,onProgress:message=>{if(!signal.aborted)update(job,row,{message});}});
          if(signal.aborted)break;
          // A second check covers accounts added through desktop while login was open.
          const duplicate=await known(row.label);
          if(duplicate){update(job,row,{state:'skipped',accountId:duplicate.id,message:'Tài khoản vừa được thêm từ nơi khác; giữ nguyên phiên đã có.'});inputs[index]=null;continue;}
          update(job,row,{state:'saving',message:'Đã đăng nhập, đang lưu vào Muse…'});
          // Persist the saving state before POST. A crash or ambiguous response must
          // never trigger an automatic repeat POST with the same credentials.
          try {
            const result=await admin.addAccount({label:row.label,cookies:session.cookies,expires:session.expires||{},login_type:account.type,proxy_id:proxyId||null});
            if(result.ok===false)throw Error();
            const saved=await known(row.label);if(!saved)throw Error();
            update(job,row,{state:'completed',accountId:saved.id,message:'Đã thêm tài khoản vào Muse.'});
          } catch {update(job,row,{state:'unknown',message:'Muse chưa xác nhận đã lưu. Tải lại danh sách và đối chiếu trước khi thử lại.'});job.state='attention';break;}
        } catch(error) {
          const cancelled=signal.aborted||error?.code==='LOGIN_CANCELLED';
          update(job,row,{state:cancelled?'cancelled':'failed',message:cancelled?'Đã dừng đăng nhập.':error instanceof LoginError?error.message:'Không hoàn tất đăng nhập. Kiểm tra dữ liệu hoặc dùng đăng nhập thủ công.',code:cancelled?'LOGIN_CANCELLED':error instanceof LoginError?error.code:'LOGIN_FAILED'});
        } finally {const position=inputs.indexOf(account);if(position>=0)inputs[position]=null;}
      }
      for(const row of job.rows)if(!terminalRows.includes(row.state))Object.assign(row,{state:'cancelled',message:job.state==='attention'?'Chưa thực hiện; cần đối chiếu tài khoản trước đó.':'Đã dừng trước khi lưu tài khoản.'});
      if(job.state!=='attention')job.state=signal.aborted?'cancelled':job.rows.some(r=>r.state==='failed')?'completed_with_errors':'completed';
    } catch(error) {
      job.state=signal.aborted?'cancelled':'failed';job.message=error instanceof LoginError?error.message:'Không bắt đầu được đăng nhập. Kiểm tra kết nối Muse.';
      for(const row of job.rows)if(!terminalRows.includes(row.state))Object.assign(row,{state:'cancelled',message:'Chưa thực hiện đăng nhập.'});
    } finally {inputs.fill(null);save(job);if(active?.job.id===job.id)active=null;}
  }
  return {
    capabilities,list,get,
    start(input) {
      if(closed)throw new LoginError('LOGIN_CLOSED','Web đang dừng.',503);
      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['mode','text','label','proxy_id','requestId'].includes(k)))throw new LoginError('LOGIN_FORMAT','Dữ liệu đăng nhập không hợp lệ.');
      const id=input.requestId||randomUUID();if(!/^[a-f0-9-]{36}$/i.test(id))throw new LoginError('LOGIN_FORMAT','requestId phải là UUID.');
      const previous=db.prepare('SELECT document FROM account_login_jobs WHERE id=?').get(id);if(previous)return JSON.parse(previous.document);
      if(active)throw new LoginError('LOGIN_BUSY','Đang có một lượt đăng nhập. Đợi hoàn tất hoặc dừng lượt hiện tại.',409);
      if(!capabilities().available)throw new LoginError('LOGIN_SETUP','Chưa sẵn sàng đăng nhập. Cài thành phần đi kèm và Chrome hoặc Edge trên máy chạy web.',503);
      if(!['manual','batch'].includes(input.mode))throw new LoginError('LOGIN_FORMAT','Chọn đăng nhập tự động hoặc thủ công.');
      if(input.proxy_id&&!safeId.test(input.proxy_id))throw new LoginError('LOGIN_PROXY','Proxy ID không hợp lệ.');
      const label=typeof input.label==='string'?input.label.trim():'';
      if(input.mode==='manual'&&(!label||label.length>200||/[\r\n|]/.test(label)))throw new LoginError('LOGIN_FORMAT','Đặt tên tài khoản thủ công (1–200 ký tự).');
      const inputs=input.mode==='manual'?[{type:'MANUAL',email:label}]:parseLoginText(input.text);
      const job={id,mode:input.mode,state:'queued',created:Date.now(),rows:inputs.map((a,i)=>({label:a.type==='CLAIM'?`Mã nhập ${i+1}`:a.email,type:a.type,state:'queued',message:'Chờ đăng nhập'}))};
      save(job);const controller=new AbortController();active={job,controller};active.done=run(job,inputs,controller,input.proxy_id||'');return snapshot(job);
    },
    cancel(id) {const job=get(id);if(active?.job.id===id){active.job.state='cancelling';active.controller.abort();save(active.job);return snapshot(active.job);}return job;},
    async close(){closed=true;if(active){const done=active.done;active.controller.abort();await done;}}
  };
}
