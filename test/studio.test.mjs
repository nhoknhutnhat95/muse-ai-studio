import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { normalize } from '../server/schema.mjs';
import { Backend } from '../server/backend.mjs';
import { createApp } from '../server/index.mjs';

const exec=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const script={title:'Kiểm thử tiếng Việt',settings:{size:'16:9',duration:10,concurrency:2},scenes:[{id:'s001',prompt:'Một cảnh vườn cây.',narration:'Lời đọc không đổi.'}]};
test('parse TXT, BOM, JSON and narration without losing Vietnamese',()=>{
  assert.equal(normalize('\uFEFF Một cảnh\r\n\r\n Cảnh hai ').scenes.length,2);
  assert.equal(normalize('[4K, 16:9, 10 giây] Khu vườn bình minh.\n[9:16] Cận cảnh hoa.').scenes.length,2);
  assert.equal(normalize(JSON.stringify(script)).scenes[0].narration,script.scenes[0].narration);
  assert.throws(()=>normalize('{broken'),/JSON/);
  assert.throws(()=>normalize({...script,settings:{duration:-1}}),/Thời lượng/);
  assert.throws(()=>normalize({...script,settings:{size:'1:1'}}),/chỉ hỗ trợ video/);
  assert.equal(normalize({...script,scenes:[{prompt:'square image',kind:'image',size:'1:1'}]}).scenes[0].size,'1:1');
  assert.throws(()=>normalize({...script,scenes:[{id:'a',prompt:'a'},{id:'a',prompt:'b'}]}),/ID/);
});
test('reference graph rejects missing, non-image and cyclic dependencies',()=>{
  assert.throws(()=>normalize({...script,scenes:[{id:'a',prompt:'a',reference:'scene:b'}]}),/tham chiếu/);
  assert.throws(()=>normalize({...script,scenes:[{id:'a',prompt:'a',kind:'image',reference:'scene:b'},{id:'b',prompt:'b',kind:'image',reference:'scene:a'}]}),/vòng lặp/);
  assert.throws(()=>normalize({...script,scenes:[{prompt:'a',image:'secret.txt'}]}),/CLI/);
});

test('HTTP, CLI, persistence and queue integrate with Muse-shaped backend',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'muse-studio-test-'));
  let created=0,ambiguous=false,onCreate=null;const tasks=new Map();
  const remote=http.createServer(async(req,res)=>{
    const send=(d,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(d));};
    if(req.url.startsWith('/v1/media/')) {res.writeHead(200,{'Content-Type':req.url.endsWith('.png')?'image/png':'video/mp4'});return res.end('test-media-content');}
    assert.equal(req.headers.authorization,'Bearer test-only-key');
    if(req.url==='/admin/status')return send({stats:{healthy:1,total:1},accounts:[{cookies:'must-not-leak'}],config:{gen_slots:1},browser_running:true,media_count:1});
    if(req.url==='/admin/media')return send({media:[{name:'fixture.mp4',url:'/v1/media/fixture.mp4',bytes:18,mtime:1,kind:'video'}]});
    if(req.method==='POST'&&['/v1/videos','/v1/images/tasks'].includes(req.url)) {
      let body='';for await(const c of req)body+=c;const data=JSON.parse(body),id=`task_${++created}`;tasks.set(id,{...data,id,kind:req.url.includes('images')?'image':'video'});
      if(onCreate)await onCreate();
      if(ambiguous)return send({detail:'Accepted upstream; response failed'},500);
      return send({id,status:'queued'});
    }
    const id=req.url.endsWith('/cancel')?req.url.split('/').at(-2):req.url.split('/').at(-1),task=tasks.get(id);
    if(task)return send({id,status:'completed',prompt:task.prompt,result:{url:`/v1/media/${id}${task.kind==='image'?'.png':'.mp4'}`}});
    return send({detail:'Not found'},404);
  });
  await new Promise(r=>remote.listen(0,'127.0.0.1',r));
  const backend=new Backend({base:`http://127.0.0.1:${remote.address().port}`,key:'test-only-key'});
  let app=await createApp({dataDir:dir,backend,port:0,startQueue:false});
  const call=async(route,method='GET',body,extra={})=>{const r=await fetch(app.url+route,{method,headers:{'Content-Type':'application/json','X-Muse-Client':'studio',...extra},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
  try{
    await t.test('project deep links serve the page and every imported browser module',async()=>{
      const page=await fetch(app.url+'/?project=example-project');
      assert.equal(page.status,200);assert.match(page.headers.get('content-type'),/text\/html/);
      const html=await page.text(),pending=[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m=>m[1]),seen=new Set();
      while(pending.length){
        const route=pending.pop();if(seen.has(route))continue;seen.add(route);
        const response=await fetch(app.url+route);assert.equal(response.status,200,route);assert.match(response.headers.get('content-type'),/javascript/,route);
        const source=await response.text();
        for(const match of source.matchAll(/(?:import|export)[^;\n]*?from\s+['"](\.\.?\/[^'"]+)['"]/g))pending.push(new URL(match[1],app.url+route).pathname);
      }
      assert.ok(seen.size>1);
    });
    await t.test('a second server cannot touch the same live data directory',async()=>{
      await assert.rejects(createApp({dataDir:dir,backend,port:0,startQueue:false}),/đã chạy/);
    });
    await t.test('status sanitizes account secrets and rejects cross-origin writes',async()=>{
      const result=await call('/api/backend');assert.equal(result.data.connected,true);assert.ok(!JSON.stringify(result.data).includes('must-not-leak'));
      assert.equal((await call('/api/projects','POST',{document:script},{Origin:'https://attacker.invalid'})).status,403);
      assert.equal((await fetch(app.url+'/api/projects',{method:'POST',body:'{}'})).status,403);
    });
    let p;
    await t.test('CLI imports idempotently and dry-run creates no remote jobs',async()=>{
      const cli=path.join(root,'bin/muse.mjs'),f=path.join(dir,'script.json');await (await import('node:fs/promises')).writeFile(f,JSON.stringify(script));
      const result=await exec(process.execPath,[cli,'import',f,'--base',app.url]);p=JSON.parse(result.stdout);assert.equal(p.title,script.title);
      const again=await exec(process.execPath,[cli,'import',f,'--base',app.url]);assert.equal(JSON.parse(again.stdout).id,p.id);
      const dry=await exec(process.execPath,[cli,'run',p.id,'--dry-run','--base',app.url]);assert.equal(JSON.parse(dry.stdout).dryRun,true);assert.equal(created,0);
    });
    await t.test('same image-backed script imports once and unsupported video ratios fail',async()=>{
      const fs=await import('node:fs/promises');const png=path.join(dir,'reference.png');await fs.writeFile(png,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
      const f=path.join(dir,'with-image.json');await fs.writeFile(f,JSON.stringify({title:'With image',scenes:[{prompt:'test reference',image:'reference.png'}]}));
      const a=JSON.parse((await exec(process.execPath,[path.join(root,'bin/muse.mjs'),'import',f,'--base',app.url])).stdout);
      const b=JSON.parse((await exec(process.execPath,[path.join(root,'bin/muse.mjs'),'import',f,'--base',app.url])).stdout);
      assert.equal(a.id,b.id);assert.equal(a.scenes[0].reference,b.scenes[0].reference);
      assert.equal((await call('/api/validate','POST',{document:{...script,settings:{size:'1:1'}}})).status,400);
    });
    await t.test('duplicate run is a single creation, persisted result downloads and seeks',async()=>{
      await call(`/api/projects/${p.id}/run`,'POST',{});await call(`/api/projects/${p.id}/run`,'POST',{});
      await app.queue.tick();assert.equal(created,1);assert.equal(app.store.get(p.id).jobs[0].state,'running');
      await app.queue.tick();const j=app.store.get(p.id).jobs[0];assert.equal(j.state,'completed');assert.equal(await readFile(path.join(dir,j.result.file),'utf8'),'test-media-content');
      const media=await fetch(app.url+`/api/jobs/${j.id}/media`,{headers:{Range:'bytes=0-3'}});assert.equal(media.status,206);assert.equal(await media.text(),'test');
      const head=await fetch(app.url+`/api/jobs/${j.id}/media`,{method:'HEAD'});assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),18);assert.equal(await head.text(),'');
      const suffix=await fetch(app.url+`/api/jobs/${j.id}/media`,{headers:{Range:'bytes=-7'}});assert.equal(suffix.status,206);assert.equal(await suffix.text(),'content');
      await call(`/api/projects/${p.id}/run`,'POST',{});await app.queue.tick();assert.equal(created,1);
      assert.equal((await call(`/api/projects/${p.id}`,'PUT',{...script,scenes:[{id:'s001',prompt:'changed'}]})).status,409);
    });
    await t.test('browser closing a streaming video does not terminate the HTTP server',async()=>{
      const fs=await import('node:fs/promises');const pr=app.store.create(normalize({title:'Stream abort',scenes:[{prompt:'stream abort test'}]}));app.store.enqueue(pr.id);app.store.pause(pr.id,true);const j=app.store.get(pr.id).jobs[0];
      await fs.writeFile(path.join(dir,'large.mp4'),Buffer.alloc(16*1024*1024,1));app.store.setJob(j.id,{state:'completed',result:{file:'large.mp4'}});
      await new Promise((resolve,reject)=>{const req=http.get(app.url+`/api/jobs/${j.id}/media`,res=>{res.once('data',()=>{res.destroy();resolve();});res.on('error',()=>{});});req.on('error',reject);});
      await new Promise(r=>setTimeout(r,30));assert.equal((await call('/api/health')).status,200);
    });
    await t.test('reference dependency runs image before video even if requested alone',async()=>{
      const doc={title:'References',scenes:[{id:'video',kind:'video',prompt:'Animate',reference:'scene:image'},{id:'image',kind:'image',prompt:'Portrait'}]};
      const dep=(await call('/api/projects','POST',{document:doc})).data;await call(`/api/projects/${dep.id}/run`,'POST',{scenes:['video']});
      assert.equal(app.store.get(dep.id).jobs.length,2);await app.queue.tick();assert.equal(app.store.get(dep.id).jobs.find(j=>j.scene_id==='video').state,'queued');
      await app.queue.tick();const video=app.store.get(dep.id).jobs.find(j=>j.scene_id==='video');assert.equal(video.state,'running');assert.match(tasks.get(video.task_id).image,/^data:image\/png;base64,/);
      await app.queue.tick();assert.ok(app.store.get(dep.id).jobs.every(j=>j.state==='completed'));
    });
    await t.test('pause during a submission prevents the next queued scene from being sent',async()=>{
      const p=app.store.create(normalize({title:'Pause race',scenes:[{id:'a',prompt:'a'},{id:'b',prompt:'b'}]}));app.store.enqueue(p.id);const before=created;
      onCreate=()=>{app.store.pause(p.id,true);onCreate=null;};await app.queue.tick();assert.equal(created,before+1);assert.equal(app.store.get(p.id).jobs.find(j=>j.scene_id==='b').state,'queued');await app.queue.tick();
    });
    await t.test('queued cancellation during a preceding POST is not overwritten',async()=>{
      const p=app.store.create(normalize({title:'Cancel race',scenes:[{id:'a',prompt:'a'},{id:'b',prompt:'b'}]}));app.store.enqueue(p.id);const before=created;
      onCreate=async()=>{onCreate=null;await app.queue.cancel(app.store.get(p.id).jobs.find(j=>j.scene_id==='b').id);};await app.queue.tick();assert.equal(created,before+1);assert.equal(app.store.get(p.id).jobs.find(j=>j.scene_id==='b').state,'cancelled');await app.queue.tick();
    });
    await t.test('cancel racing remote completion retains and downloads the completed result',async()=>{
      const p=app.store.create(normalize({title:'Completed before cancel',scenes:[{prompt:'already done'}]}));app.store.enqueue(p.id);await app.queue.tick();const j=app.store.get(p.id).jobs[0];assert.equal(j.state,'running');
      await app.queue.cancel(j.id);assert.equal(app.store.job(j.id).state,'completed');assert.ok(app.store.job(j.id).result.file);assert.throws(()=>app.store.retry(j.id),/Chỉ thử lại/);
    });
    await t.test('pause prevents submission; ambiguous POST does not retry after restart',async()=>{
      const unknown=app.store.create(normalize({title:'Unknown',scenes:[{id:'u',prompt:'uncertain'}]}));app.store.enqueue(unknown.id);app.store.pause(unknown.id,true);const n=created;await app.queue.tick();assert.equal(created,n);
      app.store.pause(unknown.id,false);ambiguous=true;await app.queue.tick();ambiguous=false;assert.equal(app.store.get(unknown.id).jobs[0].state,'unknown');
      await app.close();app=await createApp({dataDir:dir,backend,port:0,startQueue:false});await app.queue.tick();assert.equal(created,n+1);assert.equal(app.store.get(unknown.id).jobs[0].state,'unknown');
      const retry=await call(`/api/jobs/${app.store.get(unknown.id).jobs[0].id}/retry`,'POST',{});assert.equal(retry.status,409);
      const task=app.store.get(unknown.id).jobs[0];await app.queue.reconcile(task.id,`task_${created}`);assert.equal(app.store.job(task.id).state,'completed');
    });
    await t.test('in-flight submission crash becomes unknown instead of re-posting',async()=>{
      const pr=app.store.create(normalize({title:'Crash',scenes:[{prompt:'crash'}]}));app.store.enqueue(pr.id);app.store.setJob(app.store.get(pr.id).jobs[0].id,{state:'submitting'});const n=created;
      await app.close();app=await createApp({dataDir:dir,backend,port:0,startQueue:false});assert.equal(app.store.get(pr.id).jobs[0].state,'unknown');await app.queue.tick();assert.equal(created,n);
    });
  }finally{await app.close();await new Promise(r=>remote.close(r));await rm(dir,{recursive:true,force:true});}
});
