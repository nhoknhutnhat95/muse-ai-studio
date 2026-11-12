import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { AppError } from './schema.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const VOICES=[
  {id:'vi-VN-HoaiMyNeural',name:'Hoài My',language:'vi-VN',gender:'Female'},
  {id:'vi-VN-NamMinhNeural',name:'Nam Minh',language:'vi-VN',gender:'Male'},
  {id:'en-US-ChristopherNeural',name:'Christopher',language:'en-US',gender:'Male'},
  {id:'en-US-JennyNeural',name:'Jenny',language:'en-US',gender:'Female'},
  {id:'en-US-GuyNeural',name:'Guy',language:'en-US',gender:'Male'},
];
const TRANSITIONS=['none','fade','wipeleft','wiperight','slideleft','slideright','dissolve'];
const MIME_EXT={'audio/mpeg':'.mp3','audio/wav':'.wav','audio/x-wav':'.wav','audio/mp4':'.m4a','audio/aac':'.aac','audio/ogg':'.ogg','audio/flac':'.flac','video/mp4':'.mp4','video/webm':'.webm','video/quicktime':'.mov','video/x-matroska':'.mkv','image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','application/x-subrip':'.srt'};
const now=()=>new Date().toISOString();
const number=(v,def,min,max,name)=>{v=v??def;if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new AppError(`${name}: cần số từ ${min} đến ${max}.`);return v;};
function inside(root,file){const rel=path.relative(root,file);return rel!==''&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);}

/** Local media queue. Only server-resolved asset/job files enter the fixed worker. */
export function createMediaService({store,dataDir=store.dir,ffmpeg,ffprobe,python,autoStart=true}={}){
  const dir=realpathSync(dataDir), bin=path.join(process.env.LOCALAPPDATA||'', 'Programs','Muse AI Studio','_internal','bin');
  ffmpeg=ffmpeg||path.join(bin,'ffmpeg.exe');ffprobe=ffprobe||path.join(bin,'ffprobe.exe');
  python=python||path.join(ROOT,'tools','media-runtime',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  const worker=path.join(ROOT,'scripts','media_worker.py');
  const db=store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS media_jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,project_id TEXT,state TEXT NOT NULL,spec TEXT NOT NULL,result TEXT,error TEXT,progress TEXT,attempt INTEGER DEFAULT 1,created TEXT,updated TEXT);`);
  db.prepare("UPDATE media_jobs SET state='interrupted',error='Máy chủ dừng trong khi xử lý. Có thể thử lại thủ công.',updated=? WHERE state IN ('running','cancelling')").run(now());
  let timer=null,active=null,closed=false,ttsAvailable=false;
  const musicRoot=path.join(bin,'..','ah_bgm'),musicCatalog=new Map();
  try{const library=JSON.parse(readFileSync(path.join(musicRoot,'library.json'),'utf8'));for(const [mood,tracks] of Object.entries(library.moods||{})){if(!/^[a-z0-9_-]+$/i.test(mood)||!Array.isArray(tracks))continue;for(const track of tracks){if(!/^[a-z0-9_-]+$/i.test(track.name)||track.enabled===false)continue;const file=path.join(musicRoot,mood,`${track.name}.mp3`);if(existsSync(file)&&inside(realpathSync(musicRoot),realpathSync(file)))musicCatalog.set(`${mood}/${track.name}`,{id:`${mood}/${track.name}`,name:track.name,mood,duration:track.duration,bytes:statSync(file).size,file});}}}catch{}
  if(existsSync(python)){const p=spawnSync(python,['-c','import edge_tts'],{windowsHide:true,timeout:10000,stdio:'ignore'});ttsAvailable=p.status===0;}
  const capabilities=()=>({ffmpeg:existsSync(ffmpeg),ffprobe:existsSync(ffprobe),python:existsSync(python),tts:{available:ttsAvailable,provider:'edge-tts',online:true},musicLibrary:[...musicCatalog.values()].map(({file,...record})=>record),render:{available:existsSync(ffmpeg)&&existsSync(ffprobe)&&existsSync(python),resolutions:['source','720p','1080p','4k'],fps:[24,25,30,60],transitions:TRANSITIONS,upscale:'Lanczos (not AI)',interpolation:'FFmpeg optical flow MCI/AOBMC'}});
  function parse(row){return {...row,spec:JSON.parse(row.spec),result:row.result?JSON.parse(row.result):null,progress:row.progress?JSON.parse(row.progress):null};}
  function get(id){const r=db.prepare('SELECT * FROM media_jobs WHERE id=?').get(String(id));if(!r)throw new AppError('Không có tác vụ hậu kỳ.',404,'NOT_FOUND');return parse(r);}
  function set(id,fields){const keys=Object.keys(fields);db.prepare(`UPDATE media_jobs SET ${keys.map(k=>`${k}=?`).join(',')},updated=? WHERE id=?`).run(...keys.map(k=>['spec','result','progress'].includes(k)&&fields[k]!==null?JSON.stringify(fields[k]):fields[k]),now(),id);return get(id);}
  function owned(relative){if(typeof relative!=='string')throw new AppError('Tệp không thuộc thư viện local.',400,'INVALID_ASSET');const file=path.resolve(dir,relative);if(!inside(dir,file)||!existsSync(file)||!inside(dir,realpathSync(file))||!statSync(file).isFile())throw new AppError('Tệp local không tồn tại hoặc không hợp lệ.',400,'INVALID_ASSET');return realpathSync(file);}
  function asset(reference,audio=false){if(typeof reference!=='string'||!/^asset:[a-f0-9]{32}$/.test(reference))throw new AppError('Cần asset đã nhập qua web hoặc CLI.');const a=db.prepare('SELECT * FROM assets WHERE id=?').get(reference.slice(6));if(!a||(audio&&!a.mime.startsWith('audio/')))throw new AppError('Không tìm thấy asset âm thanh phù hợp.');return {file:owned(a.file),mime:a.mime};}
  function source(id,media=false){const j=media?get(id):store.job(id);if(j.state!=='completed'||!j.result?.file)throw new AppError('Nguồn phải là tác vụ đã hoàn tất.',409);if(media&&j.kind==='tts')throw new AppError('Trích frame cần nguồn video.');return owned(j.result.file);}
  function importAsset({name='asset',mime,base64}={}){
    if(!MIME_EXT[mime]||typeof base64!=='string'||!base64.length||base64.length>350*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw new AppError('Asset cần MIME hỗ trợ và base64 hợp lệ (tối đa 250 MB).');
    const data=Buffer.from(base64,'base64');if(!data.length||data.length>250*1024*1024)throw new AppError('Asset rỗng hoặc vượt quá 250 MB.');
    const id=createHash('sha256').update(data).digest('hex').slice(0,32),file=`assets/${id}${MIME_EXT[mime]}`;
    mkdirSync(path.join(dir,'assets'),{recursive:true});if(!inside(dir,realpathSync(path.join(dir,'assets'))))throw new AppError('Thư mục assets nằm ngoài dữ liệu local.');writeFileSync(path.join(dir,file),data);db.prepare('INSERT OR IGNORE INTO assets(id,name,mime,file) VALUES(?,?,?,?)').run(id,path.basename(String(name)).slice(0,240),mime,file);
    return {id,reference:`asset:${id}`,name:path.basename(String(name)),mime,bytes:data.length};
  }
  function register(file,mime,name){const data=readFileSync(owned(file));return importAsset({name,mime,base64:data.toString('base64')});}
  function enqueue(kind,spec){if(closed)throw new AppError('Hàng đợi đang dừng.',503);if(!capabilities().render.available)throw new AppError('Cần FFmpeg, FFprobe và Python local để xử lý media.',503,'MEDIA_UNAVAILABLE');const id=randomUUID(),time=now();db.prepare('INSERT INTO media_jobs(id,kind,project_id,state,spec,created,updated) VALUES(?,?,?,?,?,?,?)').run(id,kind,spec.projectId||null,'queued',JSON.stringify(spec),time,time);if(spec.projectId)store.event(spec.projectId,`Xếp hàng hậu kỳ ${kind}: ${id}`);if(timer)queueMicrotask(pump);return get(id);}
  function synthesize(input={}){
    const p=input.projectId?store.get(input.projectId):null,text=input.text??p?.scenes.map(s=>s.narration||'').filter(Boolean).join('\n\n');
    if(typeof text!=='string'||!text.trim()||text.length>100000)throw new AppError('Lời đọc cần 1–100000 ký tự.');
    const voice=input.voice||VOICES[0].id;if(!/^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9]+Neural$/.test(voice))throw new AppError('Mã giọng đọc không hợp lệ.');
    if(!ttsAvailable)throw new AppError('Chưa có edge-tts trong tools/media-runtime. Xem hướng dẫn cài đặt media.',503,'TTS_UNAVAILABLE');
    for(const key of ['rate','pitch','volume'])if(input[key]!==undefined&&!Number.isInteger(input[key]))throw new AppError(`${key}: cần số nguyên.`);
    return enqueue('tts',{projectId:p?.id,text,voice,rate:number(input.rate,0,-90,100,'Tốc độ'),pitch:number(input.pitch,0,-100,100,'Cao độ'),volume:number(input.volume,0,-100,100,'Âm lượng')});
  }
  function render(input={}){
    const p=input.projectId?store.get(input.projectId):null;let scenes=p?.scenes||[],videoAssets;
    if(input.videoAssets!==undefined){if(input.sceneIds!==undefined)throw new AppError('Chọn videoAssets hoặc sceneIds, không chọn cả hai.');if(!Array.isArray(input.videoAssets)||!input.videoAssets.length||input.videoAssets.length>500)throw new AppError('videoAssets cần 1–500 asset video.');videoAssets=input.videoAssets.map(ref=>{const a=asset(ref);if(!a.mime.startsWith('video/'))throw new AppError('videoAssets chỉ nhận tệp video đã nhập.');return ref;});scenes=[];}
    else if(!p)throw new AppError('Cần projectId hoặc videoAssets để dựng video.');
    if(input.sceneIds!==undefined){if(!Array.isArray(input.sceneIds)||!input.sceneIds.length||new Set(input.sceneIds).size!==input.sceneIds.length)throw new AppError('sceneIds cần danh sách cảnh không trùng.');scenes=input.sceneIds.map(id=>{const s=p.scenes.find(s=>s.id===id);if(!s)throw new AppError(`Không có cảnh ${id}.`);return s;});}
    const jobIds=scenes.filter(s=>s.kind==='video').map(s=>{const j=p.jobs.find(j=>j.scene_id===s.id&&j.state==='completed');if(!j)throw new AppError(`Cảnh ${s.id} chưa có video hoàn tất.`,409);source(j.id);return j.id;});
    if(!jobIds.length&&!videoAssets?.length)throw new AppError('Dự án chưa có cảnh video để ghép.');
    const resolution=input.resolution||'source',fps=input.fps??30;if(!capabilities().render.resolutions.includes(resolution)||![24,25,30,60].includes(fps))throw new AppError('Độ phân giải hoặc FPS không được hỗ trợ.');
    if(input.narrationAsset&&input.narrationJob)throw new AppError('Chọn một nguồn lời đọc: asset hoặc tác vụ TTS.');
    let musicAsset=input.musicAsset;
    if(input.bundledMusicId){if(musicAsset)throw new AppError('Chọn nhạc thư viện hoặc asset nhạc riêng.');const track=musicCatalog.get(input.bundledMusicId);if(!track||!inside(realpathSync(musicRoot),realpathSync(track.file)))throw new AppError('Không có bản nhạc trong thư viện Muse.');musicAsset=importAsset({name:track.name+'.mp3',mime:'audio/mpeg',base64:readFileSync(track.file).toString('base64')}).reference;}
    if(input.narrationAsset)asset(input.narrationAsset,true);if(musicAsset)asset(musicAsset,true);
    if(input.narrationJob){const j=get(input.narrationJob);if(j.kind!=='tts'||j.state!=='completed')throw new AppError('Lời đọc phải là tác vụ TTS đã hoàn tất.');owned(j.result.file);}
    const captions=input.captions??false;if(typeof captions!=='boolean'&&typeof captions!=='string')throw new AppError('captions cần boolean hoặc nội dung SRT.');if(typeof captions==='string'&&(captions.length>1000000||!captions.includes('-->')))throw new AppError('Nội dung SRT không hợp lệ.');if(captions===true&&!input.narrationJob)throw new AppError('Phụ đề tự động cần tác vụ TTS có SRT, hoặc truyền SRT cụ thể.');
    const t=input.transition||{type:'none',duration:0};if(!TRANSITIONS.includes(t.type))throw new AppError('Hiệu ứng chuyển cảnh không được hỗ trợ.');
    return enqueue('render',{projectId:p?.id,jobIds,videoAssets,resolution,fps,interpolate:input.interpolate===true,speed:number(input.speed,1,.5,2,'Tốc độ phát'),trimSilence:input.trimSilence===true,normalizeLoudness:input.normalizeLoudness===true,fadeEdges:input.fadeEdges!==false,narrationAsset:input.narrationAsset,narrationJob:input.narrationJob,musicAsset,musicGain:number(input.musicGain,.12,0,2,'Nhạc nền'),originalGain:number(input.originalGain,input.narrationAsset||input.narrationJob?0:1,0,2,'Âm thanh gốc'),narrationGain:number(input.narrationGain,1,0,2,'Lời đọc'),duckMusic:input.duckMusic!==false,captions,transition:{type:t.type,duration:number(t.duration,.35,0,2,'Thời lượng chuyển cảnh')}});
  }
  function prepareAffiliateReferences(input={}){if(input.projectId)store.get(input.projectId);const spec={projectId:input.projectId};for(const key of ['kolAsset','productAsset','detailAsset']){if(key!=='productAsset'&&!input[key])continue;const value=asset(input[key]);if(!value.mime.startsWith('image/'))throw new AppError(`${key}: cần asset ảnh.`);spec[key]=input[key];}return enqueue('references',spec);}
  function frame(input={}){if(!!input.sourceJobId===!!input.mediaJobId)throw new AppError('Chọn đúng một nguồn: sourceJobId hoặc mediaJobId.');const j=input.mediaJobId?get(input.mediaJobId):store.job(input.sourceJobId);source(j.id,!!input.mediaJobId);return enqueue('frame',{projectId:j.project_id||undefined,sourceJobId:input.sourceJobId,mediaJobId:input.mediaJobId,seconds:number(input.seconds,0,0,86400,'Vị trí frame')});}
  function resolveFile(id,artifact='media'){const j=get(id);if(j.state!=='completed')throw new AppError('Tác vụ chưa có tệp kết quả.',409);const relative=artifact==='media'?j.result.file:['subtitle','kol','product'].includes(artifact)?j.result.artifacts?.[artifact]:null;if(!relative)throw new AppError('Không có tệp kết quả này.',404);return {file:owned(relative),mime:artifact==='subtitle'?'application/x-subrip':j.result.mime,name:path.basename(relative)};}
  function cancel(id){const j=get(id);if(!['queued','running','cancelling'].includes(j.state))return j;if(active?.id===id){writeFileSync(path.join(active.workdir,'cancel.flag'),'cancel');return set(id,{state:'cancelling'});}return set(id,{state:'cancelled',error:'Người dùng hủy tác vụ.'});}
  function retry(id){const j=get(id);if(!['failed','cancelled','interrupted'].includes(j.state))throw new AppError('Chỉ thử lại tác vụ lỗi, đã hủy hoặc bị gián đoạn.',409);set(id,{state:'queued',result:null,error:null,progress:null,attempt:j.attempt+1});if(timer)queueMicrotask(pump);return get(id);}
  function prepare(j,workdir){const s=j.spec,payload={...s,kind:j.kind,ffmpeg,ffprobe,workdir};if(j.kind==='render'){payload.sources=s.videoAssets?s.videoAssets.map(ref=>asset(ref).file):s.jobIds.map(id=>source(id));if(s.narrationAsset)payload.narration=asset(s.narrationAsset,true).file;if(s.narrationJob){const n=get(s.narrationJob);if(n.state!=='completed')throw new AppError('TTS chưa hoàn tất.');payload.narration=owned(n.result.file);if(s.captions===true)payload.captions=readFileSync(owned(n.result.artifacts.subtitle),'utf8');}if(s.musicAsset)payload.music=asset(s.musicAsset,true).file;}if(j.kind==='frame')payload.source=source(s.sourceJobId||s.mediaJobId,!!s.mediaJobId);if(j.kind==='references')for(const key of ['kolAsset','productAsset','detailAsset'])if(s[key])payload[key+'File']=asset(s[key]).file;return payload;}
  async function pump(){if(active||closed)return;const row=db.prepare("SELECT * FROM media_jobs WHERE state='queued' ORDER BY created LIMIT 1").get();if(!row)return;const j=parse(row),workdir=path.join(dir,'media-jobs',j.id,`attempt-${j.attempt}-${randomUUID().slice(0,8)}`);mkdirSync(workdir,{recursive:true});let child,heartbeat;let doneResolve;const done=new Promise(r=>{doneResolve=r;});active={id:j.id,workdir,done};
    try{
      writeFileSync(path.join(workdir,'input.json'),JSON.stringify(prepare(j,workdir)));writeFileSync(path.join(workdir,'heartbeat'),'live');set(j.id,{state:'running',error:null,progress:{phase:'starting'}});
      child=spawn(python,[worker,path.join(workdir,'input.json')],{cwd:workdir,windowsHide:true,stdio:['ignore','pipe','pipe']});active.child=child;let errorText='';child.stderr.on('data',x=>{errorText=(errorText+x).slice(-6000);});child.stdout.resume();
      heartbeat=setInterval(()=>{try{writeFileSync(path.join(workdir,'heartbeat'),'live');const p=path.join(workdir,'progress.json');if(existsSync(p))set(j.id,{progress:JSON.parse(readFileSync(p,'utf8'))});}catch{}},800);
      const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});const cancelRequested=get(j.id).state==='cancelling';
      if(cancelRequested||code===130){set(j.id,{state:'cancelled',error:'Người dùng hủy tác vụ.',progress:null});}
      else if(code!==0){const failure=path.join(workdir,'failure.json');let message='';try{message=JSON.parse(readFileSync(failure,'utf8')).error;}catch{}throw new Error(message||errorText||`Media worker dừng với mã ${code}.`);}
      else {const result=JSON.parse(readFileSync(path.join(workdir,'result.json'),'utf8'));for(const key of ['file']){const full=path.resolve(workdir,result[key]);if(!inside(workdir,full))throw new Error('Worker output path không hợp lệ.');result[key]=path.relative(dir,full).split(path.sep).join('/');owned(result[key]);}if(result.artifacts)for(const k of Object.keys(result.artifacts)){const full=path.resolve(workdir,result.artifacts[k]);if(!inside(workdir,full))throw new Error('Artifact path không hợp lệ.');result.artifacts[k]=path.relative(dir,full).split(path.sep).join('/');owned(result.artifacts[k]);}if(['tts','frame'].includes(j.kind)){const a=register(result.file,result.mime,j.kind==='tts'?'narration.mp3':'frame.jpg');result.asset=a.reference;}if(j.kind==='references'){result.references={product:register(result.file,'image/png','product-reference.png').reference};if(result.artifacts.kol)result.references.kol=register(result.artifacts.kol,'image/png','kol-portrait.png').reference;result.sourceReferences={kol:j.spec.kolAsset||null,product:j.spec.productAsset,detail:j.spec.detailAsset||null};}set(j.id,{state:'completed',result,progress:{phase:'completed',percent:100}});if(j.project_id)store.event(j.project_id,`Hoàn tất hậu kỳ ${j.kind}: ${j.id}`);}
    }catch(e){set(j.id,{state:get(j.id).state==='cancelling'?'cancelled':'failed',error:String(e.message).slice(-6000),progress:null});}
    finally{clearInterval(heartbeat);active=null;doneResolve();if(timer&&!closed)queueMicrotask(pump);}
  }
  function start(){if(closed)throw new AppError('Media service đã đóng.',503);if(!timer){timer=setInterval(pump,500);timer.unref();queueMicrotask(pump);}return service;}
  async function stop(){closed=true;clearInterval(timer);timer=null;if(active){const {id,done}=active;cancel(id);await done;}}
  const service={capabilities,voices:()=>VOICES.map(v=>({...v})),synthesize,render,frame,prepareAffiliateReferences,importAsset,get,list:({projectId}={})=>(projectId?db.prepare('SELECT * FROM media_jobs WHERE project_id=? ORDER BY created DESC').all(projectId):db.prepare('SELECT * FROM media_jobs ORDER BY created DESC LIMIT 500').all()).map(parse),cancel,retry,resolveFile,start,stop,close:stop};
  if(autoStart)start();return service;
}
