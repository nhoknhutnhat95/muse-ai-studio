import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {normalize} from '../server/schema.mjs';
import {planWorkflow,selectReferences} from '../server/workflows.mjs';
import {createApp} from '../server/index.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const asset=n=>'asset:'+String(n).padStart(32,'0');
test('character slots select and renumber sparse references, enforce per-scene limits',()=>{
  const slots=Array.from({length:12},(_,i)=>({reference:asset(i+1)}));
  assert.deepEqual(selectReferences('@Image12 talks to @Image3. @Image12 smiles.',slots),{prompt:'@Image2 talks to @Image1. @Image2 smiles.',references:[asset(3),asset(12)]});
  assert.throws(()=>selectReferences('all images',slots),/tối đa 6/);
  assert.throws(()=>selectReferences('@Image13',slots),/chưa có ảnh/);
  const plan=planWorkflow({kind:'character',title:'Character',prompts:'@Image1 walks\n@Image2 smiles',slots:slots.slice(0,2)});
  assert.equal(plan.document.scenes[0].referenceMode,'identity');
  assert.equal(plan.document.metadata.character.slots.length,2);
  assert.equal(plan.document.scenes.length,2);
});
test('multiple reference graph detects cycles through non-primary references',()=>{
  assert.throws(()=>normalize({title:'cycle',scenes:[{id:'a',kind:'image',prompt:'a',references:['scene:b']},{id:'b',kind:'image',prompt:'b',references:['scene:a']}]}),/vòng lặp/);
  assert.throws(()=>normalize({scenes:[{prompt:'x',references:Array.from({length:7},(_,i)=>asset(i))}]}),/tối đa 6/);
});
test('integrated feature routes and approval gate preserve originals and prevent premature video POST',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'muse-features-'));let posts=[];const tasks=new Map();
  const backend={status:async()=>({connected:true,accounts:{healthy:1}}),route:(kind,id)=>`/${kind}${id?'/'+id:''}`,mediaRoute:u=>u,media:async()=>new Response(Buffer.from('fake image bytes')),
    async request(route,options){
      if(options?.method==='POST'&&['/image','/video'].includes(route)){posts.push({...options.body,kind:route});const id='t'+posts.length;tasks.set(id,options.body);return {id};}
      if(route.startsWith('/image/')||route.startsWith('/video/')){const id=route.split('/').at(-1);return {id,status:'completed',prompt:tasks.get(id).prompt,result:{url:`/v1/media/${id}.png`}};}
      if(route==='/admin/accounts')return {accounts:[]};if(route==='/admin/media')return {media:[]};if(route==='/admin/proxies')return {proxies:[]};throw Error('Unexpected '+route);
    }};
  const app=await createApp({dataDir:dir,backend,port:0,startQueue:false});
  const call=async(route,method='GET',value)=>{const r=await fetch(app.url+route,{method,headers:{'Content-Type':'application/json','X-Muse-Client':'studio'},body:value===undefined?undefined:JSON.stringify(value)});const d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;};
  try{
    const cli=async(...args)=>{const result=await promisify(execFile)(process.execPath,['bin/muse.mjs',...args,'--base',app.url],{cwd:path.resolve('.'),env:process.env});return JSON.parse(result.stdout);};
    const spec=path.join(dir,'workflow.json'),planFile=path.join(dir,'plan.json');await writeFile(spec,JSON.stringify({kind:'character',title:'CLI draft wrapper',textOnly:true,prompts:'A consistent person walking'}));
    await cli('workflow',spec,'--out',planFile);const draft=await cli('import',planFile);assert.equal(draft.jobs.length,0);assert.equal(draft.scenes[0].kind,'video');
    assert.equal((await cli('media','capabilities')).tts.provider,'edge-tts');
    assert.ok((await cli('help')).commands.affiliate.includes('plan'));
    assert.equal((await call('/api/workflows/options')).maxSlots,12);
    assert.ok((await call('/api/affiliate/options')).voices||await call('/api/affiliate/options'));
    assert.equal((await call('/api/admin/accounts')).stats.total,0);
    assert.deepEqual((await call('/api/admin/proxies')).proxies,[]);
    assert.equal((await call('/api/library')).count,0);
    assert.equal((await call('/api/settings','PUT',{defaults:{concurrency:3}})).defaults.concurrency,3);
    assert.ok((await call('/api/media/capabilities')).render);
    const p=await call('/api/projects','POST',{document:{title:'Reviewed sequence',scenes:[{id:'a',kind:'image',prompt:'person',reviewRequired:true},{id:'b',kind:'image',prompt:'product'},{id:'v',kind:'video',prompt:'person holds product',references:['scene:a','scene:b'],referenceMode:'identity'}]}});
    await call(`/api/projects/${p.id}/run`,'POST',{scenes:['v']});await app.queue.tick();await app.queue.tick();await app.queue.tick();
    assert.equal(posts.length,2,'only reference images sent before approval');
    const progress=app.store.get(p.id),image=progress.jobs.find(j=>j.scene_id==='a');assert.equal(image.state,'completed');assert.equal(progress.jobs.find(j=>j.scene_id==='v').state,'queued');
    await call(`/api/jobs/${image.id}/review`,'POST',{state:'approved'});await app.queue.tick();
    assert.equal(posts.length,3);assert.equal(posts[2].reference_image.length,2);assert.equal(posts[2].reference_mode,'identity');
    await app.queue.tick();assert.equal((await call('/api/local-library')).media.length,3);
    const exported=await call(`/api/projects/${p.id}/export`);assert.equal(exported.results.find(j=>j.sceneId==='a').review.state,'approved');
    // Old v0.1 documents with locked jobs can still change project settings.
    const legacy=app.store.get(p.id);for(const s of legacy.scenes){delete s.references;delete s.referenceMode;delete s.reviewRequired;delete s.accountId;}
    app.store.db.prepare('UPDATE projects SET document=? WHERE id=?').run(JSON.stringify({title:legacy.title,settings:legacy.settings,scenes:legacy.scenes}),p.id);
    const document=normalize({...legacy,settings:{...legacy.settings,concurrency:4}});assert.equal(app.store.update(p.id,document).settings.concurrency,4);
    const flagged=await call('/api/projects','POST',{document:{title:'Flagged local QC',metadata:{affiliate:{reviewMode:'flagged'}},scenes:[{id:'ref',kind:'image',prompt:'reference image',reviewRequired:true,size:'9:16'},{id:'clip',prompt:'animate',reference:'scene:ref'}]}});
    const before=posts.length;await call(`/api/projects/${flagged.id}/run`,'POST',{});await app.queue.tick();await app.queue.tick();
    const qcProject=app.store.get(flagged.id),qcImage=qcProject.jobs.find(j=>j.scene_id==='ref');
    assert.equal(posts.length,before+1,'technical QC blocks video when image cannot decode');
    assert.equal(qcImage.review.state,'rejected');assert.equal(qcImage.qc.flags[0].code,'unreadable_image');
    await call(`/api/jobs/${qcImage.id}/review`,'POST',{state:'approved',note:'Explicit human override for fake fixture'});await app.queue.tick();assert.equal(posts.length,before+2);
    const repair=await call('/api/projects','POST',{document:{title:'Bounded opt-in repair',metadata:{affiliate:{reviewMode:'flagged',autoRepairAttempts:1}},scenes:[{id:'ref',kind:'image',size:'9:16',prompt:'reference',reviewRequired:true},{id:'clip',prompt:'animate',reference:'scene:ref'}]}});
    const repairStart=posts.length;await call(`/api/projects/${repair.id}/run`,'POST',{});for(let i=0;i<5;i++)await app.queue.tick();
    const repairImage=app.store.get(repair.id).jobs.find(j=>j.scene_id==='ref');assert.equal(repairImage.attempt,2);assert.equal(repairImage.history.length,1);assert.notEqual(repairImage.history[0].result.file,repairImage.result.file);assert.ok((await readFile(path.join(dir,repairImage.history[0].result.file))).length);assert.equal(repairImage.review.state,'rejected');assert.equal(posts.length,repairStart+2,'opt-in only retries exactly once; no video or unbounded repair');
    app.features.inspectImages=async()=>{throw Error('QC runtime unavailable');};
    const unavailable=await call('/api/projects','POST',{document:{title:'Unavailable QC',metadata:{affiliate:{reviewMode:'flagged',autoRepairAttempts:2}},scenes:[{id:'image',kind:'image',prompt:'reference',reviewRequired:true}]}});
    await call(`/api/projects/${unavailable.id}/run`,'POST',{});await app.queue.tick();await app.queue.tick();
    const manual=app.store.get(unavailable.id).jobs[0];assert.equal(manual.review.state,'pending');assert.equal(manual.attempt,1,'missing QC infrastructure never spends generation retry');
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
