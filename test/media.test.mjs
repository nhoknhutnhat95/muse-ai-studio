import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Store } from '../server/store.mjs';
import { normalize } from '../server/schema.mjs';
import { createMediaService } from '../server/media.mjs';
import {mediaPaths} from '../server/runtime-paths.mjs';

const runtime=mediaPaths();
const ffmpeg=process.env.MUSE_TEST_FFMPEG||runtime.ffmpeg,ffprobe=process.env.MUSE_TEST_FFPROBE||runtime.ffprobe;
const python=runtime.python;
const available=[ffmpeg,ffprobe,python].every(existsSync);
function fixture(){const dir=mkdtempSync(path.join(os.tmpdir(),'muse-media-test-')),store=new Store(dir);return {dir,store};}
function exec(args){const p=spawnSync(ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-y',...args],{windowsHide:true,encoding:'utf8',timeout:30000});assert.equal(p.status,0,p.stderr);}
async function wait(media,id){const end=Date.now()+60000;while(Date.now()<end){const j=media.get(id);if(!['queued','running','cancelling'].includes(j.state))return j;await new Promise(r=>setTimeout(r,100));}throw new Error('Media task timed out.');}
function addProject(store){return store.create(normalize({title:'Local media fixture',scenes:[{id:'one',prompt:'red'},{id:'two',prompt:'blue'}]}));}
function seed(store,p,files){store.enqueue(p.id);const jobs=store.get(p.id).jobs;for(let i=0;i<jobs.length;i++)store.setJob(jobs[i].id,{state:'completed',result:{file:files[i]}});return store.get(p.id);}

test('media validates references and recovers durable local jobs without generation',{skip:!available},async()=>{
  const {dir,store}=fixture(),media=createMediaService({store,dataDir:dir,autoStart:false,ffmpeg,ffprobe,python});
  try{
    assert.equal(media.capabilities().tts.online,true);
    assert.equal(media.voices()[0].id,'vi-VN-HoaiMyNeural');
    const p=addProject(store);
    assert.throws(()=>media.render({projectId:p.id}),/chưa có video/);
    assert.throws(()=>media.importAsset({name:'a',mime:'application/javascript',base64:'YQ=='}),/MIME/);
    assert.throws(()=>media.frame({sourceJobId:'x',mediaJobId:'y'}),/đúng một/);
    mkdirSync(path.join(dir,'outputs'));
    writeFileSync(path.join(dir,'outputs','fake.mp4'),'fixture');
    const seeded=seed(store,p,[path.join(dir,'outputs','fake.mp4'),'../escape.mp4']);
    assert.throws(()=>media.render({projectId:p.id}),/local/);
    const job=media.frame({sourceJobId:seeded.jobs[0].id});
    assert.equal(media.cancel(job.id).state,'cancelled');assert.equal(media.retry(job.id).attempt,2);
    store.db.prepare("UPDATE media_jobs SET state='running' WHERE id=?").run(job.id);
    await media.close();
    const recovered=createMediaService({store,autoStart:false,ffmpeg,ffprobe,python});
    assert.equal(recovered.get(job.id).state,'interrupted');
    await recovered.close();
  }finally{await media.close();store.close();}
});

test('real FFmpeg render: silent clip + audio clip, narration, BGM duck, transition, captions and extracted frame',{skip:!available,timeout:90000},async()=>{
  const {dir,store}=fixture();mkdirSync(path.join(dir,'outputs'));
  const one=path.join(dir,'outputs','one.mp4'),two=path.join(dir,'outputs','two.mp4'),audio=path.join(dir,'voice.wav'),music=path.join(dir,'music.wav');
  exec(['-f','lavfi','-i','color=red:s=160x90:r=24:d=1.5','-c:v','libx264','-pix_fmt','yuv420p',one]);
  exec(['-f','lavfi','-i','color=blue:s=160x90:r=24:d=1.5','-f','lavfi','-i','sine=frequency=440:duration=0.7','-af','adelay=400|400,apad=pad_dur=0.4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',two]);
  exec(['-f','lavfi','-i','sine=frequency=800:duration=1.2',audio]);
  exec(['-f','lavfi','-i','sine=frequency=200:duration=1',music]);
  const p=seed(store,addProject(store),['outputs/one.mp4','outputs/two.mp4']);
  const media=createMediaService({store,dataDir:dir,ffmpeg,ffprobe,python});
  try{
    const voice=media.importAsset({name:'voice.wav',mime:'audio/wav',base64:readFileSync(audio).toString('base64')});
    const bgm=media.importAsset({name:'music.wav',mime:'audio/wav',base64:readFileSync(music).toString('base64')});
    const job=media.render({projectId:p.id,fps:30,narrationAsset:voice.reference,musicAsset:bgm.reference,captions:'1\n00:00:00,000 --> 00:00:01,000\nXin chào vườn cây\n',transition:{type:'fade',duration:.3}});
    const result=await wait(media,job.id);assert.equal(result.state,'completed',result.error);assert.equal(result.result.width,160);assert.equal(result.result.height,90);assert.equal(result.result.hasAudio,true);assert.ok(result.result.duration>2.5&&result.result.duration<3.2);assert.equal(result.result.fps,30);assert.match(result.result.scaling,/not AI/);assert.ok(existsSync(media.resolveFile(job.id,'subtitle').file));
    const frame=await wait(media,media.frame({mediaJobId:job.id,seconds:.5}).id);assert.equal(frame.state,'completed',frame.error);assert.match(frame.result.asset,/^asset:/);assert.equal(frame.result.mime,'image/jpeg');
    const oneAsset=media.importAsset({name:'one.mp4',mime:'video/mp4',base64:readFileSync(one).toString('base64')}),twoAsset=media.importAsset({name:'two.mp4',mime:'video/mp4',base64:readFileSync(two).toString('base64')});
    const standalone=await wait(media,media.render({videoAssets:[twoAsset.reference,oneAsset.reference]}).id);assert.equal(standalone.state,'completed',standalone.error);assert.equal(standalone.project_id,null);assert.ok(standalone.result.duration>2.9);const firstPixel=spawnSync(ffmpeg,['-v','error','-i',media.resolveFile(standalone.id).file,'-vf','scale=1:1,format=rgb24','-frames:v','1','-f','rawvideo','-'],{windowsHide:true,timeout:30000});assert.equal(firstPixel.status,0);assert.ok(firstPixel.stdout[2]>firstPixel.stdout[0],'uploaded clip order preserved (blue first)');
    const rotatedFile=path.join(dir,'rotated.mp4');exec(['-display_rotation:v:0','90','-i',one,'-c','copy',rotatedFile]);const rotatedAsset=media.importAsset({name:'portrait.mp4',mime:'video/mp4',base64:readFileSync(rotatedFile).toString('base64')});const rotated=await wait(media,media.render({videoAssets:[rotatedAsset.reference]}).id);assert.equal(rotated.state,'completed',rotated.error);assert.equal(rotated.result.width,90);assert.equal(rotated.result.height,160);
    const bluePng=path.join(dir,'blue.png');exec(['-f','lavfi','-i','color=blue:s=80x120','-frames:v','1',bluePng]);const detail=media.importAsset({name:'detail.png',mime:'image/png',base64:readFileSync(bluePng).toString('base64')});
    const refs=await wait(media,media.prepareAffiliateReferences({kolAsset:frame.result.asset,productAsset:frame.result.asset,detailAsset:detail.reference}).id);assert.equal(refs.state,'completed',refs.error);assert.equal(refs.result.width,720);assert.equal(refs.result.height,1280);assert.match(refs.result.references.kol,/^asset:/);assert.match(refs.result.references.product,/^asset:/);assert.equal(refs.result.sourceReferences.detail,detail.reference);const bottomPixel=spawnSync(ffmpeg,['-v','error','-i',media.resolveFile(refs.id).file,'-vf','crop=720:512:0:768,scale=1:1,format=rgb24','-frames:v','1','-f','rawvideo','-'],{windowsHide:true,timeout:30000});assert.equal(bottomPixel.status,0);assert.ok(bottomPixel.stdout[2]>bottomPixel.stdout[0],'detail fills bottom 40%');assert.ok(existsSync(media.resolveFile(refs.id,'kol').file));
    const productOnly=await wait(media,media.prepareAffiliateReferences({productAsset:detail.reference}).id);assert.equal(productOnly.state,'completed',productOnly.error);assert.equal(productOnly.result.references.kol,undefined);
    const smooth=await wait(media,media.render({projectId:p.id,sceneIds:['one'],fps:60,interpolate:true}).id);assert.equal(smooth.state,'completed',smooth.error);assert.equal(smooth.result.fps,60);assert.equal(smooth.result.interpolation,'optical-flow');
    const trimmed=await wait(media,media.render({projectId:p.id,sceneIds:['two'],speed:1.5,trimSilence:true,normalizeLoudness:true}).id);assert.equal(trimmed.state,'completed',trimmed.error);assert.ok(trimmed.result.duration>.5&&trimmed.result.duration<1);assert.ok(trimmed.result.trims[0].sourceStart>.25);assert.ok(trimmed.result.trims[0].sourceEnd<1.4);assert.match(trimmed.result.loudness,/-16 LUFS/);
    const cancelled=media.render({projectId:p.id,interpolate:true,fps:60});await new Promise(r=>setTimeout(r,20));assert.equal(media.get(cancelled.id).state,'running');media.cancel(cancelled.id);assert.equal((await wait(media,cancelled.id)).state,'cancelled');
    const invalid=await wait(media,media.frame({mediaJobId:job.id,seconds:99}).id);assert.equal(invalid.state,'failed');assert.match(invalid.error,/Vị trí frame/);
    assert.ok(existsSync(one)&&existsSync(two),'original clips preserved');
    const decoding=spawnSync(ffmpeg,['-v','error','-i',media.resolveFile(job.id).file,'-f','null','-'],{windowsHide:true,encoding:'utf8',timeout:30000});assert.equal(decoding.status,0,decoding.stderr);
  }finally{await media.close();store.close();}
});
