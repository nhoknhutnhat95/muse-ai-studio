import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createAccountLoginService } from '../server/account-login.mjs';
import { parseLoginLine,parseLoginText,totpCode,publicAddress,inboxRequest,inboxMessages,claimAccounts,LoginError } from '../server/account-login-input.mjs';
import { loginWithBrowser,museCookies } from '../server/account-login-browser.mjs';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/index.mjs';
import { handleExtended } from '../bin/extended.mjs';

const secret='not-a-real-password',otpSecret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',cookie='fixture-session-only';
function fixture(t,options={}) {
  const db=new DatabaseSync(':memory:'),accounts=[],saved=[];
  const dependencies={store:{db},backend:{status:async()=>({connected:true})},capabilities:()=>({available:true}),resolveProxy:async()=>undefined,
    admin:{accounts:async()=>({accounts}),addAccount:async body=>{saved.push(body);accounts.push({id:'acc_'+accounts.length,label:body.label});return {ok:true};}},
    login:async()=>({cookies:{hatch_sess:cookie,hatch_vml:cookie},expires:{hatch_vml:2000000000}}),...options};
  const service=createAccountLoginService(dependencies);
  t.after(async()=>{await service.close();db.close();});
  return {service,db,accounts,saved,dependencies};
}
async function finish(service,id) {for(let i=0;i<200;i++){const j=service.get(id);if(!['queued','running','cancelling'].includes(j.state))return j;await new Promise(r=>setTimeout(r,5));}throw Error('Login test timed out');}
test('login formats, claims, whitespace and TOTP parse without reflecting secrets',()=>{
  assert.equal(parseLoginLine('one@example.com|password').type,'PASSWORD');
  assert.equal(parseLoginLine(`one@example.com|${secret}|${otpSecret}`).type,'TOTP');
  assert.equal(parseLoginLine('one@example.com|https://mail.example.com/mail/?email=one%40example.com').type,'EMAIL_OTP');
  assert.equal(parseLoginLine('one@example.com').inboxUrl,'https://example.com/mail/?email=one%40example.com');
  assert.equal(parseLoginText('Mã nhập Muse Studio: ORD1234ABCD-ABCDEFGHIJ'.replace('I','K').replace('J','L'))[0].type,'CLAIM');
  assert.equal(parseLoginText('one@example.com|pass\n# comment\none@example.com|pass').length,1);
  assert.throws(()=>parseLoginText(`invalid|${secret}`),e=>!e.message.includes(secret));
  assert.throws(()=>parseLoginLine('one@example.com|pass|123456'));
  assert.equal(totpCode(otpSecret,59000),'287082'); // RFC 6238, six-digit truncation.
});
test('CLI malformed credential JSON does not echo password text',async()=>{
  await assert.rejects(handleExtended({command:'accounts',args:['accounts','login','-'],flags:{},stdin:async()=>`{"text":${secret}}`,required:x=>x,request:()=>{throw Error('must not send');},output:()=>{}}),e=>e.message.includes('JSON')&&!e.message.includes(secret));
});
test('OTP conversion, message freshness IDs and claim contract',async()=>{
  for(const ip of ['127.0.0.1','10.1.2.3','169.254.1.1','172.16.0.1','192.168.0.1','100.64.0.1','::1','::ffff:127.0.0.1'])assert.equal(publicAddress(ip),false);
  assert.equal(publicAddress('8.8.8.8'),true);
  assert.throws(()=>inboxRequest({email:'a@example.com',inboxUrl:'http://127.0.0.1/key'}));
  assert.equal(inboxRequest({email:'a@example.com',inboxUrl:'https://mail.example.com/mail/?email=a'}).url,'https://mail.example.com/api/temp-mail/inbox?email=a%40example.com');
  assert.deepEqual(inboxMessages({messages:[{id:'new',subject:'Your code is 123456'}]}),[{id:'new',code:'123456'}]);
  assert.notEqual(inboxMessages({success:true,found:true,received_at:1,otp_code:'123456'})[0].id,inboxMessages({success:true,found:true,received_at:2,otp_code:'123456'})[0].id);
  let called='';const result=await claimAccounts('ORD1234ABCD-ABCDEFGHKL',{request:async url=>{called=url;return {emails:['a@example.com'],accounts:[{email:'a@example.com',otp_url:'https://mail.example.com/mail/?email=a'}]};}});
  assert.match(called,/^https:\/\/api\.mrhulkstore\.store\/api\/v1\/muse\/claim\//);assert.equal(result[0].type,'EMAIL_OTP');
});
test('batch saves once, deduplicates, persists only safe progress and supports idempotent submit',async t=>{
  const {service,saved,db}=fixture(t);const requestId=randomUUID();
  const job=service.start({mode:'batch',text:`one@example.com|${secret}\none@example.com|another`,requestId});
  const again=service.start({mode:'batch',text:'different@example.com|x',requestId});assert.equal(again.id,job.id);
  const done=await finish(service,job.id);assert.equal(done.state,'completed');assert.deepEqual(done.rows.map(r=>r.state),['completed','skipped']);assert.equal(saved.length,1);
  const persisted=db.prepare('SELECT document FROM account_login_jobs').get().document;
  for(const value of [secret,cookie,'another'])assert.equal(persisted.includes(value),false);
  assert.equal(saved[0].login_type,'PASSWORD');
});
test('claim expansion logs in every expanded account without storing the claim code',async t=>{
  const code='ORD1234ABCD-ABCDEFGHKL';const {service,saved,db}=fixture(t,{claim:async()=>[{type:'PASSWORD',email:'a@example.com',password:secret},{type:'PASSWORD',email:'b@example.com',password:secret}]});
  const done=await finish(service,service.start({mode:'batch',text:code}).id);
  assert.equal(done.rows.length,2);assert.equal(saved.length,2);assert.ok(done.rows.every(r=>r.state==='completed'));
  assert.equal(db.prepare('SELECT document FROM account_login_jobs').get().document.includes(code),false);
});
test('ambiguous save is unknown and stops the batch without repeating POST',async t=>{
  let posts=0;const {service}=fixture(t,{admin:{accounts:async()=>({accounts:[]}),addAccount:async()=>{posts++;throw Error(secret);}}});
  const done=await finish(service,service.start({mode:'batch',text:`a@example.com|${secret}\nb@example.com|${secret}`}).id);
  assert.equal(posts,1);assert.equal(done.state,'attention');assert.deepEqual(done.rows.map(r=>r.state),['unknown','cancelled']);assert.equal(JSON.stringify(done).includes(secret),false);
});
test('manual cancellation clears the batch, closes its browser adapter and never saves',async t=>{
  let entered;const started=new Promise(r=>{entered=r;});
  const {service,saved}=fixture(t,{login:async(_account,{signal})=>{entered();await new Promise(r=>signal.addEventListener('abort',r,{once:true}));throw new LoginError('LOGIN_CANCELLED','Đã dừng.');}});
  const job=service.start({mode:'manual',label:'Manual fixture'});await started;
  assert.throws(()=>service.start({mode:'manual',label:'Other'}),{code:'LOGIN_BUSY'});
  service.cancel(job.id);const done=await finish(service,job.id);assert.equal(done.state,'cancelled');assert.equal(saved.length,0);
});
test('backend unavailable and proxy failure cannot fall back to direct login',async t=>{
  let launches=0;const a=fixture(t,{backend:{status:async()=>({connected:false})},login:async()=>{launches++;}});
  assert.equal((await finish(a.service,a.service.start({mode:'manual',label:'Test'}).id)).state,'failed');
  const b=fixture(t,{resolveProxy:async()=>{throw new LoginError('LOGIN_PROXY','Proxy chưa sẵn sàng.');},login:async()=>{launches++;}});
  assert.equal((await finish(b.service,b.service.start({mode:'manual',label:'Test',proxy_id:'p1'}).id)).state,'failed');assert.equal(launches,0);
});
test('restart marks a saving row unknown and never resumes credentials',async t=>{
  const {service,db,dependencies}=fixture(t);await service.close();
  const job={id:randomUUID(),state:'running',mode:'batch',rows:[{label:'test',state:'saving'},{label:'next',state:'queued'}]};
  db.prepare('INSERT INTO account_login_jobs VALUES (?,?)').run(job.id,JSON.stringify(job));
  const restored=createAccountLoginService(dependencies);t.after(()=>restored.close());
  assert.deepEqual(restored.get(job.id).rows.map(r=>r.state),['unknown','interrupted']);
});
test('manual session only exports Muse cookies after session endpoint confirms login',async()=>{
  let closed=0,probed=0;
  const cookieList=[{domain:'.muse.ai',name:'hatch_sess',value:cookie,expires:2000000000},{domain:'muse.ai',name:'hatch_vml',value:cookie,expires:2000000000},{domain:'evil.test',name:'password',value:secret}];
  assert.equal(museCookies(cookieList).cookies.password,undefined);
  const page={setDefaultTimeout(){},goto:async()=>{},bringToFront:async()=>{}};
  const context={newPage:async()=>page,pages:()=>[page],cookies:async()=>cookieList,request:{get:async(url,options)=>{assert.equal(url,'https://muse.ai/api/session');assert.equal(options.maxRedirects,0);probed++;return {status:()=>200,dispose:async()=>{}};}},close:async()=>{closed++;}};
  const session=await loginWithBrowser({type:'MANUAL'},{mode:'manual',launch:async options=>{assert.equal(options.headless,false);assert.equal(options.chromiumSandbox,true);return {newContext:async()=>context,isConnected:()=>true,close:async()=>{closed++;}};}});
  assert.equal(probed,1);assert.equal(closed,2);assert.equal(session.cookies.hatch_sess,cookie);assert.equal(session.cookies.password,undefined);
});

function browserFixture(type,{origin='https://muse.ai/',checkpoint=false}={}) {
  let stage='email',closed=0;const filled=[];
  function locator(selector) {
    const kind=selector.includes('Continue')?'next':selector.includes('autocomplete*="username"')?'email':selector==='input[type="password"]'?'password':selector.includes('one-time-code')?'code':selector==='body'?'body':'absent';
    const present=kind==='body'||kind===stage||kind==='next';
    const result={count:async()=>present?1:0,nth:()=>result,isVisible:async()=>present,innerText:async()=>checkpoint?"Confirm you're human":'',fill:async text=>{filled.push({kind,text});},click:async()=>{if(stage==='email')stage=type==='EMAIL_OTP'?'code':'password';else if(stage==='password')stage=type==='TOTP'?'code':'session';else if(stage==='code')stage='session';}};return result;
  }
  const page={setDefaultTimeout(){},url:()=>origin,goto:async()=>{},locator};
  const context={newPage:async()=>page,pages:()=>[page],cookies:async()=>stage==='session'?[{domain:'muse.ai',name:'hatch_sess',value:cookie},{domain:'muse.ai',name:'hatch_vml',value:cookie}]:[],request:{get:async()=>({status:()=>200,dispose:async()=>{}})},close:async()=>{closed++;}};
  return {filled,get closed(){return closed;},launch:async()=>({newContext:async()=>context,isConnected:()=>true,close:async()=>{closed++;}})};
}
test('automatic password, TOTP and fresh email OTP progress through verified steps',{timeout:30000},async()=>{
  for(const type of ['PASSWORD','TOTP','EMAIL_OTP']) {
    const fixture=browserFixture(type);let inboxReads=0;
    const session=await loginWithBrowser({type,email:'a@example.com',...(type==='EMAIL_OTP'?{inboxUrl:'https://mail.example.com/mail/'}:{password:secret}),...(type==='TOTP'?{totp:otpSecret}:{})},{mode:'batch',launch:fixture.launch,inbox:async()=>{inboxReads++;return inboxReads===1?[{id:'old',code:'111111'}]:[{id:'old',code:'111111'},{id:'new',code:'222222'}];}});
    assert.equal(session.cookies.hatch_sess,cookie);assert.equal(fixture.closed,2);assert.equal(fixture.filled[0].text,'a@example.com');
    if(type==='EMAIL_OTP'){assert.equal(fixture.filled.find(x=>x.kind==='code').text,'222222');assert.equal(inboxReads,2);}
    else assert.equal(fixture.filled.find(x=>x.kind==='password').text,secret);
  }
});
test('checkpoint and foreign origin stop before sending credentials',async()=>{
  for(const options of [{checkpoint:true},{origin:'https://untrusted.example/'}]) {
    const fixture=browserFixture('PASSWORD',options);
    await assert.rejects(loginWithBrowser({type:'PASSWORD',email:'a@example.com',password:secret},{mode:'batch',launch:fixture.launch}),{code:'LOGIN_MANUAL_REQUIRED'});
    assert.equal(fixture.filled.length,0);assert.equal(fixture.closed,2);
  }
});
test('HTTP routes integrate add/status/cancel and keep all secret input out of responses',async()=>{
  const rows=[];const backend={status:async()=>({connected:true}),request:async(route,{method='GET',body}={})=>{
    if(route==='/admin/accounts'&&method==='POST'){rows.push({id:'fixture',label:body.label});return {ok:true};}
    if(route==='/admin/accounts')return {accounts:rows};
    throw Error('Unexpected route');
  }};
  const app=await createApp({dataDir:await mkdtemp(path.join(tmpdir(),'muse-login-api-')),port:0,backend,startQueue:false,accountLoginOptions:{capabilities:()=>({available:true}),resolveProxy:async()=>undefined,login:async()=>({cookies:{hatch_sess:cookie,hatch_vml:cookie}})}});
  try {
    const headers={'Content-Type':'application/json','X-Muse-Client':'studio'};
    const denied=await fetch(app.url+'/api/admin/account-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'manual',label:'Denied'})});assert.equal(denied.status,403);
    const result=await fetch(app.url+'/api/admin/account-login',{method:'POST',headers,body:JSON.stringify({mode:'batch',text:'qa@example.com|'+secret})});assert.equal(result.status,200);
    const started=await result.json();const done=await finish(app.features.accountLogin,started.id);assert.equal(done.state,'completed');
    const output=await (await fetch(app.url+'/api/admin/account-login')).text();assert.equal(output.includes(secret),false);assert.equal(output.includes(cookie),false);
    assert.equal((await fetch(app.url+'/account-login-ui.js')).status,200);
    const cancelled=await (await fetch(app.url+'/api/admin/account-login/'+started.id+'/cancel',{method:'POST',headers,body:'{}'})).json();assert.equal(cancelled.state,'completed');
  } finally {await app.close();}
});
