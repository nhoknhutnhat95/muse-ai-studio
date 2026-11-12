import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createAdminService } from '../server/admin.mjs';

function fixture(t,replies={}) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const calls=[];
  const backend={async request(route,options={}){calls.push({route,...options});const result=replies[`${options.method??'GET'} ${route}`];if(result instanceof Error)throw result;return typeof result==='function'?result(options):result??{ok:true};}};
  const store={db};
  return {service:createAdminService({store,backend}),calls,store,backend};
}
const secret='do-not-leak-private-value';
const a={id:'acc_1',label:'Test account',enabled:true,ok:true,cookie_header:secret,cookies:{session:secret},cookies_exp:{[secret]:1},otp_url:secret,note:secret,video_last_error:secret,dead_reason:secret,expires_at:Date.now()/1000+60000,cookie_count:4,essential_ok:true,video_24h:[Date.now()/1000,1],quota:{found:true,plan:'Pro',weekly_used_pct:25,extra_used_pct:10,extra_left:'100',extra_expires:'Tomorrow',weekly_reset:'Next week',raw:secret}};

test('account listing/detail redact secrets and support filters and pagination',async t=>{
  const {service}=fixture(t,{'GET /admin/accounts':{accounts:[a,{...a,id:'acc_2',label:'Disabled',enabled:false}],stats:{secret}}});
  const result=await service.accounts({state:'healthy',search:'test',limit:1});
  assert.equal(result.total,1);assert.equal(result.stats.total,2);assert.equal(result.accounts[0].video_24h_count,1);
  assert.equal(result.accounts[0].quota.weekly_used_pct,25);
  assert.equal(JSON.stringify(result).includes(secret),false);
  assert.equal(JSON.stringify(await service.account('acc_1')).includes(secret),false);
  await assert.rejects(service.account('missing'),{code:'NOT_FOUND'});
});

test('quota filters, summary and remaining sort stay separate from login state',async t=>{
  const checked_at=Date.now()/1000,base={found:true,checked_at,extra_used_pct:100,extra_left:'0 tokens left'};
  const accounts=[
    {...a,id:'low',quota:{...base,weekly_used_pct:70}},
    {...a,id:'high',enabled:false,quota:{...base,weekly_used_pct:10}},
    {...a,id:'extra',quota:{...base,weekly_used_pct:100,extra_used_pct:11,extra_left:'892M tokens left'}},
    {...a,id:'empty',quota:{...base,weekly_used_pct:100}},
    {...a,id:'unknown',quota:null},
    {...a,id:'weekly-only',quota:{...base,weekly_used_pct:100,extra_left:'',extra_used_pct:null}}
  ];
  const {service}=fixture(t,{'GET /admin/accounts':{accounts}});
  const data=await service.accounts();assert.deepEqual(data.stats.quota,{available:2,extra_only:1,exhausted:1,unknown:2,stale:1,weeklyExhausted:3});
  assert.deepEqual((await service.accounts({quota:'remaining'})).accounts.map(a=>a.id),['high','low','extra']);
  assert.deepEqual((await service.accounts({quota:'remaining',state:'healthy'})).accounts.map(a=>a.id),['low','extra']);
  assert.equal((await service.accounts({quota:'exhausted'})).accounts[0].id,'empty');
  assert.equal((await service.accounts({quota:'unknown'})).total,2);
  assert.equal((await service.accounts({quota:'stale'})).total,1);
  assert.equal((await service.accounts({sort:'exhausted'})).accounts[0].id,'empty');
  await assert.rejects(service.accounts({quota:'bad'}),{status:400});
  await assert.rejects(service.accounts({sort:'bad'}),{status:400});
});

test('account cookie import and update forward exactly one credential source without reflecting response',async t=>{
  const {service,calls}=fixture(t,{'POST /admin/accounts':{ok:true,count:2,warning:secret,accounts:[a]},'POST /admin/accounts/acc_1/cookies':{cookie_count:8,cookie_header:secret}});
  const added=await service.addAccount({label:'A',cookie_header:secret,proxy_id:'proxy_1'});
  assert.deepEqual(calls[0],{route:'/admin/accounts',method:'POST',body:{label:'A',proxy_id:'proxy_1',cookie_header:secret}});
  assert.equal(added.count,2);assert.equal(JSON.stringify(added).includes(secret),false);
  const updated=await service.updateCookies('acc_1',{cookie_header:secret});assert.equal(updated.cookie_count,8);assert.equal(JSON.stringify(updated).includes(secret),false);
  await service.addAccount({batch:`${secret}\n${secret}`});assert.equal(calls.at(-1).body.batch,`${secret}\n${secret}`);
  const count=calls.length;
  await assert.rejects(service.addAccount({cookies:{sid:secret},cookie_header:secret}),{status:400});
  await assert.rejects(service.addAccount({cookies:{sid:secret},password:secret}),{status:400});
  await assert.rejects(service.updateCookies('acc_1',{cookies:{sid:secret}}),{status:400});
  assert.equal(calls.length,count);
});

test('account mutations use observed routes and do not return upstream messages',async t=>{
  const {service,calls}=fixture(t,{'POST /admin/accounts/acc_1/test':{ok:false,message:secret,quota_error:secret,quota:a.quota},'POST /admin/accounts/acc_1/quota':a.quota,'POST /admin/accounts/acc_1/keepalive':{ok:false,error:secret},'POST /admin/accounts/keepalive?force=true':{status:'busy',note:secret}});
  await service.updateAccount('acc_1',{enabled:false,label:'New',proxy_id:''});
  assert.deepEqual(calls[0].body,{enabled:false,label:'New',proxy_id:''});
  await service.deleteAccount('acc_1');assert.equal(calls.at(-1).method,'DELETE');
  for(const result of [await service.testAccount('acc_1'),await service.quota('acc_1'),await service.keepaliveAccount('acc_1'),await service.keepaliveAll()])assert.equal(JSON.stringify(result).includes(secret),false);
  await assert.rejects(service.updateAccount('../bad',{enabled:true}),{status:400});
  await assert.rejects(service.updateAccount('acc_1',{enabled:'false'}),{status:400});
  await assert.rejects(service.updateAccount('acc_1',{dead_reason:secret}),{status:400});
});

test('proxy lists show only address and credential presence',async t=>{
  const {service}=fixture(t,{'GET /admin/proxies':{proxies:[{id:'p1',name:'HTTP',proxy:`http://user:${secret}@127.0.0.1:8080`,password:secret},{id:'p2',name:'SOCKS',proxy:`proxy.example:1080:user:${secret}`,scheme:'socks5'},{id:'p3',name:'Bad',proxy:`bad ${secret}`}]}});
  const result=await service.proxies();assert.equal(result.proxies[0].display,'127.0.0.1:8080');assert.equal(result.proxies[0].hasCredentials,true);assert.equal(result.proxies[1].scheme,'socks5');assert.equal(result.proxies[2].display,'');
  assert.equal(JSON.stringify(result).includes(secret),false);assert.equal(JSON.stringify(result).includes('user:'),false);
});

test('proxy edits preserve blank credentials and test response contains validated IP only',async t=>{
  const {service,calls}=fixture(t,{'POST /admin/proxies/p1/test':{ok:true,ip:'203.0.113.4',ms:25,proxy:secret},'POST /admin/proxies/test':{ok:false,ip:secret,error:secret,ms:10}});
  await service.updateProxy('p1',{name:'Renamed',proxy:''});assert.deepEqual(calls[0].body,{name:'Renamed'});
  await service.addProxy({name:'New',proxy:`127.0.0.1:8080:user:${secret}`,scheme:'http'});assert.equal(calls.at(-1).route,'/admin/proxies');
  const good=await service.testProxy('p1');assert.equal(good.ip,'203.0.113.4');assert.equal(good.ms,25);
  const bad=await service.testProxyDraft({proxy:'localhost:8080'});assert.equal(bad.ip,null);assert.equal(JSON.stringify(bad).includes(secret),false);
  await service.deleteProxy('p1');assert.equal(calls.at(-1).method,'DELETE');
  await assert.rejects(service.addProxy({proxy:'localhost:8080',scheme:'file'}),{status:400});
});

test('already masked upstream proxy records preserve has_auth and usage',async t=>{
  const {service}=fixture(t,{'GET /admin/proxies':{proxies:[{id:'p1',name:'IPv6',host:'2001:db8::1',port:1080,scheme:'socks5',has_auth:true,usage:3}]}});
  const {proxies}=await service.proxies();assert.equal(proxies[0].display,'[2001:db8::1]:1080');assert.equal(proxies[0].hasCredentials,true);assert.equal(proxies[0].usage,3);
});

test('backend errors cannot echo cookie/proxy credentials',async t=>{
  const error=new Error(`Authorization Bearer ${secret}`);error.status=400;
  const {service}=fixture(t,{'POST /admin/accounts':error,'GET /admin/accounts':error});
  for(const promise of [service.addAccount({cookie_header:secret}),service.accounts()])await assert.rejects(promise,e=>e.code==='ADMIN_BACKEND_ERROR'&&!e.message.includes(secret));
});

test('settings are persisted only in web SQLite with nested partial updates',t=>{
  const {service,calls,store,backend}=fixture(t);
  assert.equal(service.settings().defaults.size,'16:9');
  service.updateSettings({defaults:{size:'9:16',concurrency:3},library:{sort:'largest',pageSize:20}});
  service.updateSettings({defaults:{duration:15}});
  const result=createAdminService({store,backend}).settings();
  assert.deepEqual(result.defaults,{size:'9:16',concurrency:3,duration:15});assert.equal(result.library.sort,'largest');assert.equal(calls.length,0);
  assert.throws(()=>service.updateSettings({api_key:secret}),{status:400});
  assert.throws(()=>service.updateSettings({defaults:{concurrency:0}}),{status:400});
  assert.throws(()=>service.updateSettings({library:{pageSize:10000}}),{status:400});
  assert.throws(()=>service.updateSettings({defaults:{size:'10:9'}}),{status:400});
});

test('queue settings validate limits, merge existing settings, and persist partial updates',t=>{
  const {service,store,backend,calls}=fixture(t);
  store.db.prepare('INSERT INTO studio_settings(id,document) VALUES(1,?)').run(JSON.stringify({defaults:{size:'9:16',duration:15,concurrency:3},library:{sort:'oldest',kind:'video',pageSize:20}}));
  assert.deepEqual(service.settings().queue,{maxParallel:8,taskTimeoutSeconds:600});
  service.updateSettings({queue:{maxParallel:4}});
  service.updateSettings({queue:{taskTimeoutSeconds:1200}});
  const saved=createAdminService({store,backend}).settings();
  assert.deepEqual(saved.queue,{maxParallel:4,taskTimeoutSeconds:1200});
  assert.equal(saved.defaults.size,'9:16');assert.equal(saved.library.sort,'oldest');assert.equal(calls.length,0);
  for(const value of [0,9,1.5,'4',null])assert.throws(()=>service.updateSettings({queue:{maxParallel:value}}),{status:400});
  for(const value of [59,1801,60.5,'600',null])assert.throws(()=>service.updateSettings({queue:{taskTimeoutSeconds:value}}),{status:400});
  assert.throws(()=>service.updateSettings({queue:{autoRetry:true}}),{status:400});
  assert.deepEqual(service.settings().queue,{maxParallel:4,taskTimeoutSeconds:1200});
});

test('media library paginates filtered results with stable order and generated local URLs',async t=>{
  const {service}=fixture(t,{'GET /admin/media':{media:[{name:'b.mp4',kind:'video',bytes:10,mtime:30,url:'https://evil.example/private'},{name:'a.mp4',kind:'video',bytes:50,mtime:10},{name:'a.png',kind:'image',bytes:30,mtime:20},{name:'../unsafe.mp4',kind:'video',bytes:50,mtime:99}]}});
  const result=await service.library({kind:'video',sort:'largest',offset:1,limit:1});
  assert.equal(result.count,2);assert.equal(result.total,3);assert.equal(result.media[0].name,'b.mp4');assert.equal(result.media[0].url,'/v1/media/b.mp4');assert.equal(result.bytes,60);
  const search=await service.library({search:'a.',sort:'name'});assert.deepEqual(search.media.map(m=>m.name),['a.mp4','a.png']);
  await assert.rejects(service.library({sort:'random'}),{status:400});await assert.rejects(service.library({limit:-1}),{status:400});
});

test('media deletion only sends explicit basenames and redacts backend response',async t=>{
  const {service,calls}=fixture(t,{'POST /admin/media/delete':{removed:1,paths:[secret]}});
  const result=await service.deleteMedia(['a.mp4','a.mp4']);assert.deepEqual(result,{ok:true,removed:1});assert.deepEqual(calls[0].body,{names:['a.mp4']});
  for(const name of ['../secret','C:\\private.mp4','a/evil.mp4','.','a.mp4:secret','a.mp4.'])await assert.rejects(service.deleteMedia([name]),{status:400});
  await assert.rejects(service.deleteMedia([]),{status:400});assert.equal(calls.length,1);
});
