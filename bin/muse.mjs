#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { normalize, template } from '../server/schema.mjs';
import {extendedHelp,handleExtended} from './extended.mjs';

let parsed;
try{parsed=parseArgs({allowPositionals:true,options:{base:{type:'string'},out:{type:'string'},title:{type:'string'},scene:{type:'string',multiple:true},'new-copy':{type:'boolean'},timeout:{type:'string'},interval:{type:'string'},'dry-run':{type:'boolean'},help:{type:'boolean'},json:{type:'boolean'},'task-id':{type:'string'},apply:{type:'boolean'},reject:{type:'boolean'},note:{type:'string'},artifact:{type:'string'},search:{type:'string'},kind:{type:'string'},sort:{type:'string'},offset:{type:'string'},limit:{type:'string'}}});}catch(e){process.stderr.write(JSON.stringify({error:e.message})+'\n');process.exit(1);}
const {values:flags,positionals:args}=parsed;
const command=flags.help?'help':args[0]||'help';
const base=flags.base||process.env.MUSE_STUDIO_URL||'http://127.0.0.1:3210';
const output=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
async function request(route,method='GET',body) {
  let r;
  try{r=await fetch(base+route,{method,headers:{'Content-Type':'application/json','X-Muse-Client':'studio'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(240000)});}catch{throw Error(`Không kết nối được Web Studio tại ${base}. Chạy muse serve hoặc Start-Muse-Web.cmd.`);}
  const d=await r.json();if(!r.ok)throw Error(`${d.error?.code||r.status}: ${d.error?.message||'Lỗi API'}`);return d;
}
function required(value,name){if(!value)throw Error(`Thiếu ${name}. Xem muse help.`);return value;}
async function stdin(){const chunks=[];for await(const c of process.stdin)chunks.push(c);return Buffer.concat(chunks).toString('utf8');}
async function scriptInput(filename,upload=false){
  const text=filename==='-'?await stdin():await readFile(filename,'utf8');
  let doc=text.trim().replace(/^\uFEFF/,'');
  if(filename.toLowerCase().endsWith('.json') || doc.startsWith('{') || /^\[\s*(?:\{|"|\[|\])/.test(doc))doc=JSON.parse(doc);
  if(Array.isArray(doc))doc={title:flags.title||'Kịch bản mới',scenes:doc};
  if(doc&&typeof doc==='object'&&doc.document&&!doc.scenes)doc=doc.document;
  const images=[];
  if(doc?.scenes)for(const scene of doc.scenes){
    const files=[...(scene.image?[scene.image]:[]),...(scene.images||[])];
    if(!Array.isArray(scene.images||[])||files.some(f=>typeof f!=='string'))throw Error('images phải là danh sách đường dẫn ảnh.');
    if(!files.length)continue;
    scene.references=[...(scene.references||[])];
    for(const name of files){
      const file=path.resolve(filename==='-'?process.cwd():path.dirname(path.resolve(filename)),name);
      const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[path.extname(file).toLowerCase()];
      if(!mime)throw Error('Ảnh phải là PNG/JPEG/WebP.');
      const bytes=await readFile(file);if(bytes.length>12*1024*1024)throw Error('Ảnh tham chiếu lớn hơn 12 MB.');
      const placeholder='asset:'+String(images.length+1).padStart(32,'0');
      scene.references.push(placeholder);images.push({scene,placeholder,data:`data:${mime};base64,${bytes.toString('base64')}`,name:path.basename(file)});
    }
    delete scene.image;delete scene.images;
  }
  normalize(doc,{title:flags.title});
  if(upload)for(const item of images){const asset=await request('/api/assets','POST',{data:item.data,name:item.name});item.scene.references=item.scene.references.map(r=>r===item.placeholder?asset.reference:r);}
  return {document:normalize(doc,{title:flags.title}),images:images.length};
}
try {
  switch(command){
    case 'help':output({name:'muse',version:'0.2.0',usage:'muse <command> [arguments] [--flags]',commands:{...extendedHelp,serve:'Khởi động web local (127.0.0.1:3210)',doctor:'Kiểm tra Web Studio và backend Muse',init:'muse init --out kich-ban.json',schema:'In JSON Schema cho AI',validate:'muse validate kich-ban.json | - (stdin)',import:'muse import kich-ban.json [--title NAME] [--new-copy] [--dry-run]',update:'muse update PROJECT_ID kich-ban.json [--dry-run]',projects:'Liệt kê dự án',show:'muse show PROJECT_ID',run:'muse run PROJECT_ID [--scene s001 --scene s002] [--dry-run]',status:'muse status PROJECT_ID',wait:'muse wait PROJECT_ID [--timeout 1800] [--interval 5]',pause:'muse pause PROJECT_ID',retry:'muse retry JOB_ID (chỉ failed/blocked/cancelled)',cancel:'muse cancel JOB_ID',reconcile:'muse reconcile JOB_ID --task-id MUSE_TASK_ID',export:'muse export PROJECT_ID [--out ket-qua.json]',library:'Liệt kê 48 media mới nhất',tasks:'Các tác vụ gần đây của backend'},flags:{base:'URL Web Studio; mặc định http://127.0.0.1:3210',json:'Được chấp nhận; mọi kết quả luôn là JSON'},notes:['Import chỉ tạo bản nháp. run mới gửi yêu cầu tạo nội dung.','Lặp lại import cùng nội dung trả lại dự án đã có; --new-copy tạo bản sao.','Không tự gửi lại tác vụ unknown. Đối chiếu ID trước để tránh tạo trùng.','Video tải vào data/outputs; media tts/render xử lý lời đọc và dựng thành phẩm.']});break;
    case 'serve':{const{createApp}=await import('../server/index.mjs');const app=await createApp();output({ok:true,url:app.url});for(const s of ['SIGINT','SIGTERM'])process.once(s,async()=>{await app.close();process.exit();});break;}
    case 'doctor':{const health=await request('/api/health');const backend=await request('/api/backend');output({web:health,backend});if(!backend.connected)process.exitCode=1;break;}
    case 'init':{if(flags.out){await writeFile(flags.out,JSON.stringify(template,null,2)+'\n',{flag:'wx'});output({ok:true,file:path.resolve(flags.out)});}else output(template);break;}
    case 'schema':{const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');output(JSON.parse(await readFile(path.join(root,'schema/script.schema.json'),'utf8')));break;}
    case 'validate':{const d=await scriptInput(required(args[1],'file hoặc -'));output({valid:true,title:d.document.title,scenes:d.document.scenes.length,referenceImages:d.images,document:d.document});break;}
    case 'import':{const d=await scriptInput(required(args[1],'file hoặc -'),!flags['dry-run']);output(flags['dry-run']?{dryRun:true,...d}:await request('/api/projects','POST',{document:d.document,newCopy:flags['new-copy']===true}));break;}
    case 'update':{const id=required(args[1],'PROJECT_ID'),d=await scriptInput(required(args[2],'file hoặc -'),!flags['dry-run']);output(flags['dry-run']?{dryRun:true,...d}:await request(`/api/projects/${encodeURIComponent(id)}`,'PUT',d.document));break;}
    case 'projects':output(await request('/api/projects'));break;
    case 'show':case 'status':output(await request('/api/projects/'+encodeURIComponent(required(args[1],'PROJECT_ID'))));break;
    case 'run':{const id=encodeURIComponent(required(args[1],'PROJECT_ID'));if(flags['dry-run']){const p=await request('/api/projects/'+id);output({dryRun:true,projectId:p.id,selected:flags.scene||p.scenes.map(s=>s.id),existing:p.jobs.map(j=>({sceneId:j.scene_id,state:j.state})),message:'Chưa gửi tạo nội dung. Cảnh đã có tác vụ không được tạo trùng.'});}else output(await request(`/api/projects/${id}/run`,'POST',{scenes:flags.scene}));break;}
    case 'pause':output(await request(`/api/projects/${encodeURIComponent(required(args[1],'PROJECT_ID'))}/pause`,'POST',{}));break;
    case 'retry':case 'cancel':case 'reconcile':output(await request(`/api/jobs/${encodeURIComponent(required(args[1],'JOB_ID'))}/${command}`,'POST',command==='reconcile'?{taskId:required(flags['task-id'],'--task-id')} : {}));break;
    case 'export':{const d=await request(`/api/projects/${encodeURIComponent(required(args[1],'PROJECT_ID'))}/export`);if(flags.out){await mkdir(path.dirname(path.resolve(flags.out)),{recursive:true});await writeFile(flags.out,JSON.stringify(d,null,2)+'\n');output({ok:true,file:path.resolve(flags.out),project:d.title});}else output(d);break;}
    case 'library':{const q=new URLSearchParams(Object.fromEntries(['search','kind','sort','offset','limit'].filter(k=>flags[k]!==undefined).map(k=>[k,flags[k]])));output(await request('/api/library?'+q));break;}
    case 'tasks':output(await request('/api/backend/tasks'));break;
    case 'wait':{const id=encodeURIComponent(required(args[1],'PROJECT_ID'));const timeout=Number(flags.timeout||1800),interval=Number(flags.interval||5);if(!Number.isFinite(timeout)||timeout<=0||!Number.isFinite(interval)||interval<1)throw Error('timeout phải >0, interval phải >=1.');const deadline=Date.now()+timeout*1000;
      while(true){const p=await request('/api/projects/'+id);const needsReview=p.jobs.filter(j=>j.state==='completed'&&p.scenes.find(s=>s.id===j.scene_id)?.reviewRequired&&j.review?.state!=='approved');if(needsReview.length){output({finished:false,needsReview:needsReview.map(j=>({jobId:j.id,sceneId:j.scene_id})),project:p});process.exitCode=3;break;}const pending=p.jobs.some(j=>['queued','submitting','running','downloading'].includes(j.state));if(!pending||p.paused){const success=p.jobs.length>0&&p.jobs.every(j=>j.state==='completed');output({finished:!pending,success,project:p});if(!success)process.exitCode=1;break;}if(Date.now()>deadline){output({finished:false,timedOut:true,project:p});process.exitCode=2;break;}await new Promise(r=>setTimeout(r,interval*1000));}break;}
    default:if(!await handleExtended({command,args,flags,request,output,stdin,required,base}))throw Error(`Lệnh không hợp lệ: ${command}. Xem muse help.`);
  }
}catch(e){process.stderr.write(JSON.stringify({error:e.message})+'\n');process.exitCode=1;}
