import http from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Store } from './store.mjs';
import { Backend } from './backend.mjs';
import { Queue } from './queue.mjs';
import { AppError, normalize, template } from './schema.mjs';
import { acquireLock } from './lock.mjs';
import { createFeatures } from './features.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const types={'.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.aac':'audio/aac','.ogg':'audio/ogg','.flac':'audio/flac','.srt':'application/x-subrip; charset=utf-8','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.mp4':'video/mp4','.webm':'video/webm','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml'};
const json=(res,code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function body(req,limit=24*1024*1024) {const chunks=[];let n=0;for await(const c of req){n+=c.length;if(n>limit)throw new AppError(`Dữ liệu vượt quá ${Math.round(limit/1048576)} MB.`,413);chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AppError('JSON không hợp lệ.');}}
async function file(res,req,filename) {
  const s=await stat(filename);let start=0,end=s.size-1,code=200;
  if(req.headers.range){const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!m||(!m[1]&&!m[2])){res.writeHead(416,{'Content-Range':`bytes */${s.size}`});return res.end();}if(!m[1]){if(+m[2]<=0){res.writeHead(416,{'Content-Range':`bytes */${s.size}`});return res.end();}start=Math.max(0,s.size-Number(m[2]));}else{start=+m[1];end=m[2]?Math.min(+m[2],s.size-1):end;}if(start>end||start>=s.size){res.writeHead(416,{'Content-Range':`bytes */${s.size}`});return res.end();}code=206;}
  res.writeHead(code,{'Content-Type':types[path.extname(filename)]||'application/octet-stream','Content-Length':end-start+1,'Accept-Ranges':'bytes',...(code===206?{'Content-Range':`bytes ${start}-${end}/${s.size}`}:{})});
  if(req.method==='HEAD')return res.end();await pipeline(createReadStream(filename,{start,end}),res);
}
export async function createApp({dataDir=process.env.MUSE_DATA_DIR||path.join(ROOT,'data'),backend=new Backend(),port=Number(process.env.MUSE_PORT||3210),startQueue=true,accountLoginOptions={}}={}) {
  dataDir=path.resolve(dataDir);
  const release=acquireLock(dataDir);
  let store;
  try{store=new Store(dataDir);}catch(e){release();throw e;}
  const queue=new Queue(store,backend);
  let features;try{features=createFeatures({store,backend,dataDir,autoStart:startQueue,body,json,file,accountLoginOptions});}catch(e){store.close();release();throw e;}
  queue.settings=()=>features.admin.settings().queue;
  queue.reviewCompleted=async(project,job)=>{
    if(project.metadata?.affiliate?.reviewMode!=='flagged')return;
    try{await features.inspectImages({projectId:project.id,jobId:job.id,apply:true});}
    catch(e){store.review(job.id,{state:'pending',note:`Chưa kiểm tra kỹ thuật được: ${e.message}`.slice(0,2000)});return;}
    const fresh=store.get(project.id),reviewed=fresh.jobs.find(j=>j.id===job.id),limit=fresh.metadata?.affiliate?.autoRepairAttempts;
    if(!fresh.paused&&Number.isInteger(limit)&&limit>=1&&limit<=2&&reviewed.review?.state==='rejected'&&reviewed.attempt<=limit){store.event(project.id,`${reviewed.scene_id}: tạo lại ảnh theo cấu hình QC tự động (${reviewed.attempt}/${limit}).`);store.retry(reviewed.id);}
  };
  const server=http.createServer(async(req,res)=>{
    try {
      const hostname=req.headers.host?.split(':')[0];
      if(!['127.0.0.1','localhost'].includes(hostname))throw new AppError('Host không được phép.',403);
      const origin=req.headers.origin;
      if(origin&&origin!==`http://${req.headers.host}`)throw new AppError('Origin không được phép.',403);
      res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
      const url=new URL(req.url,`http://${req.headers.host}`),p=url.pathname,m=req.method;
      if(!['GET','HEAD'].includes(m)&&req.headers['x-muse-client']!=='studio')throw new AppError('Thiếu X-Muse-Client: studio.',403);
      if(p==='/api/health')return json(res,200,{ok:true,version:'0.2.0'});
      if(await features.route(req,res,url))return;
      if(p==='/api/backend'&&m==='GET')return json(res,200,await backend.status());
      if(p==='/api/template'&&m==='GET'){const settings=features.admin.settings().defaults;return json(res,200,{...template,settings:{...settings,size:['16:9','9:16'].includes(settings.size)?settings.size:'16:9'}});}
      if(p==='/api/schema'&&m==='GET')return await file(res,req,path.join(ROOT,'schema','script.schema.json'));
      if(p==='/api/validate'&&m==='POST'){const b=await body(req);return json(res,200,{valid:true,document:normalize(b.document??b,b.options)});}
      if(p==='/api/projects'&&m==='GET')return json(res,200,store.list());
      if(p==='/api/projects'&&m==='POST'){const b=await body(req);return json(res,201,store.create(normalize(b.document??b,{defaults:features.admin.settings().defaults,...b.options}),b.newCopy===true));}
      const project=/^\/api\/projects\/([a-f0-9-]+)(?:\/(run|pause|events|export))?$/.exec(p);
      if(project){const [,id,action]=project;
        if(!action&&m==='GET')return json(res,200,store.get(id));
        if(!action&&m==='PUT')return json(res,200,store.update(id,normalize(await body(req))));
        if(action==='events'&&m==='GET')return json(res,200,store.events(id));
        if(action==='export'&&m==='GET'){const pr=store.get(id);return json(res,200,{version:1,title:pr.title,settings:pr.settings,scenes:pr.scenes,metadata:pr.metadata,results:pr.jobs.map(j=>({sceneId:j.scene_id,state:j.state,taskId:j.task_id,review:j.review,...j.result})),postproduction:features.media.list({projectId:id})});}
        if(action==='pause'&&m==='POST')return json(res,200,store.pause(id,true));
        if(action==='run'&&m==='POST'){const b=await body(req);const status=await backend.status();if(!status.connected)throw new AppError(status.error,503);return json(res,200,store.enqueue(id,b.scenes));}
      }
      const job=/^\/api\/jobs\/([a-f0-9-]+)\/(retry|cancel|reconcile|review|asset|media)$/.exec(p);
      if(job){const[,id,action]=job;
        if(action==='retry'&&m==='POST')return json(res,200,store.retry(id));
        if(action==='review'&&m==='POST')return json(res,200,store.review(id,await body(req)));
        if(action==='asset'&&m==='POST'){const j=store.job(id),pr=store.get(j.project_id);if(j.state!=='completed'||pr.scenes.find(s=>s.id===j.scene_id)?.kind!=='image')throw new AppError('Chọn ảnh đã hoàn tất.',409);const filename=path.resolve(dataDir,j.result.file);return json(res,200,features.media.importAsset({name:path.basename(filename),mime:types[path.extname(filename)],base64:(await readFile(filename)).toString('base64')}));}
        if(action==='cancel'&&m==='POST')return json(res,200,await queue.cancel(id));
        if(action==='reconcile'&&m==='POST'){const b=await body(req);return json(res,200,await queue.reconcile(id,b.taskId));}
        if(action==='media'&&['GET','HEAD'].includes(m)){const j=store.job(id);if(!j.result?.file)throw new AppError('Media chưa sẵn sàng.',404);if(url.searchParams.has('download'))res.setHeader('Content-Disposition',`attachment; filename="${path.basename(j.result.file)}"`);return await file(res,req,path.join(dataDir,j.result.file));}
      }
      if(p==='/api/assets'&&m==='POST'){
        const b=await body(req),match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(b.data||'');
        if(!match)throw new AppError('Chỉ nhận ảnh PNG, JPEG, WebP.');
        const buffer=Buffer.from(match[2],'base64');if(!buffer.length||buffer.length>12*1024*1024)throw new AppError('Ảnh phải nhỏ hơn 12 MB.');
        const valid=match[1]==='image/png'?buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):match[1]==='image/jpeg'?buffer[0]===255&&buffer[1]===216:buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP';
        if(!valid)throw new AppError('Nội dung file không khớp định dạng ảnh.');
        const id=createHash('sha256').update(buffer).digest('hex').slice(0,32),dir=path.join(dataDir,'assets');await mkdir(dir,{recursive:true});const target=path.join(dir,id+({ 'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'}[match[1]]));await writeFile(target,buffer);
        store.db.prepare('INSERT OR IGNORE INTO assets VALUES(?,?,?,?)').run(id,String(b.name||'reference').slice(0,200),match[1],target);return json(res,201,{id,reference:`asset:${id}`});
      }
      const asset=/^\/api\/assets\/([a-f0-9]{32})$/.exec(p);
      if(asset&&['GET','HEAD'].includes(m)){const a=store.db.prepare('SELECT * FROM assets WHERE id=?').get(asset[1]);if(!a)throw new AppError('Không có asset.',404);return await file(res,req,path.resolve(dataDir,a.file));}
      const media=/^\/api\/library\/media\/([^/]+)$/.exec(p);
      if(media&&m==='GET'){const r=await backend.media(`/v1/media/${media[1]}`,req.headers.range);res.writeHead(r.status,{'Content-Type':r.headers.get('content-type')||'application/octet-stream','Accept-Ranges':'bytes',...(r.headers.has('content-length')?{'Content-Length':r.headers.get('content-length')}:{}) ,...(r.headers.has('content-range')?{'Content-Range':r.headers.get('content-range')}:{})});return await pipeline(Readable.fromWeb(r.body),res);}
      if(p==='/api/backend/tasks'&&m==='GET') {const d=await backend.request('/admin/tasks?limit=60');return json(res,200,{tasks:(d.tasks||[]).map(t=>({id:t.id,type:t.type,status:t.status,prompt:t.prompt,created:t.created_at,progress:t.progress,error:typeof t.error==='string'?t.error:null}))});}
      const backendCancel=/^\/api\/backend\/tasks\/([\w-]+)\/cancel$/.exec(p);
      if(backendCancel&&m==='POST'){const id=backendCancel[1];const owned=store.db.prepare('SELECT id FROM jobs WHERE task_id=?').get(id);if(owned)return json(res,200,await queue.cancel(owned.id));const tasks=await backend.request('/admin/tasks?limit=500');const task=tasks.tasks?.find(t=>t.id===id);if(!task||!['image','video'].includes(task.type))throw new AppError('Không tìm thấy tác vụ ảnh/video.',404);if(!['queued','processing','running','pending'].includes(task.status))throw new AppError('Tác vụ đã kết thúc; không hủy.',409);const result=await backend.request(backend.route(task.type,id)+'/cancel',{method:'POST',body:{}});return json(res,200,{id,status:result.status});}
      const publicFiles={'/':'index.html','/app.js':'app.js','/project-panels.js':'project-panels.js','/workflows-ui.js':'workflows-ui.js','/affiliate-ui.js':'affiliate-ui.js','/admin-ui.js':'admin-ui.js','/media-ui.js':'media-ui.js','/features.css':'features.css','/styles.css':'styles.css','/favicon.svg':'favicon.svg'};
      publicFiles['/account-login-ui.js']='account-login-ui.js';
      if(publicFiles[p]&&['GET','HEAD'].includes(m))return await file(res,req,path.join(ROOT,'public',publicFiles[p]));
      throw new AppError('Không tìm thấy.',404,'NOT_FOUND');
    }catch(e){if(res.headersSent){res.destroy();return;}json(res,e.status||500,{error:{code:e.code||'INTERNAL_ERROR',message:e.status?e.message:'Lỗi nội bộ. Xem nhật ký máy chủ.'}});if(!e.status)console.error(e);}
  });
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}catch(e){await features.close();store.close();release();throw e;}
  if(startQueue)queue.start();
  return {server,store,queue,features,url:`http://127.0.0.1:${server.address().port}`,close:async()=>{queue.stop();await features.close();await new Promise(r=>server.close(r));while(queue.busy)await new Promise(r=>setTimeout(r,30));store.close();release();}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=await createApp();console.log(`Muse Studio Web · ${app.url}`);
  for(const s of ['SIGINT','SIGTERM'])process.once(s,async()=>{await app.close();process.exit(0);});
}
