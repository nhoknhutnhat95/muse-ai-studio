import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {discoverAffiliateFolder} from '../server/affiliate.mjs';

export const extendedHelp={
  workflow:'muse workflow spec.json [--out draft.json] · plan only (kind image/video/character)',
  affiliate:'muse affiliate options | qc PROJECT_ID [--apply] | presets | preset ID | plan spec.json | batch batch.json | folder PRODUCT_ROOT [--out plans.json] | import-batch plans.json · imports drafts only',
  review:'muse review JOB_ID [--reject] [--note TEXT] · approve image or request regeneration',
  media:'muse media capabilities | voices | jobs [PROJECT_ID] | status ID | wait ID | cancel ID | retry ID | tts spec.json | render spec.json | frame spec.json | references spec.json | upload FILE | download ID --out FILE [--artifact subtitle]',
  accounts:'muse accounts list | show ID | add input.json | login input.json | login-status [JOB_ID] | login-cancel JOB_ID | login-capabilities | update ID input.json | cookies ID input.json | test ID | quota ID | keepalive [ID] | delete ID',
  proxies:'muse proxies list | add input.json | update ID input.json | test ID | test-draft input.json | delete ID',
  settings:'muse settings [update input.json]',
  'local-library':'muse local-library · originals and rendered media on this machine',
  'library-delete':'muse library-delete names.json · explicitly delete named backend cache files'
  ,'task-cancel':'muse task-cancel MUSE_TASK_ID · cancel an active Muse task'
};
const mimeOf=file=>({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.aac':'audio/aac','.ogg':'audio/ogg','.flac':'audio/flac','.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.mkv':'video/x-matroska','.srt':'application/x-subrip'})[path.extname(file).toLowerCase()];
export async function handleExtended({command,args,flags,request,output,stdin,required,base}){
  if(!Object.hasOwn(extendedHelp,command))return false;
  const encode=v=>encodeURIComponent(required(v,'ID'));
  const input=async file=>{const text=(file==='-'?await stdin():await readFile(required(file,'JSON file hoặc -'),'utf8')).replace(/^\uFEFF/,'');try{return JSON.parse(text);}catch(error){if(['accounts','proxies'].includes(command))throw Error('JSON quản trị không hợp lệ. Kiểm tra định dạng file; nội dung nhạy cảm không được in ra.');throw error;}};
  const emit=async data=>{if(flags.out){await writeFile(flags.out,JSON.stringify(data,null,2)+'\n');output({ok:true,file:path.resolve(flags.out)});}else output(data);};
  const upload=async(file,imageOnly=false)=>{const mime=mimeOf(file);if(!mime||imageOnly&&!mime.startsWith('image/'))throw Error('Định dạng asset không được hỗ trợ.');const bytes=await readFile(file);return request(imageOnly?'/api/assets':'/api/media/assets','POST',imageOnly?{name:path.basename(file),data:`data:${mime};base64,${bytes.toString('base64')}`}:{name:path.basename(file),mime,base64:bytes.toString('base64')});};
  if(command==='workflow'){const doc=await input(args[1]);for(const slot of doc.slots||[])if(slot.image){slot.reference=(await upload(path.resolve(path.dirname(path.resolve(args[1])),slot.image),true)).reference;delete slot.image;}await emit(await request('/api/workflows/plan','POST',doc));}
  if(command==='affiliate'){
    const op=args[1]||'options';
    if(op==='options')await emit(await request('/api/affiliate/options'));
    else if(op==='qc')await emit(await request('/api/affiliate/qc','POST',{projectId:required(args[2],'PROJECT_ID'),apply:flags.apply===true}));
    else if(op==='presets')await emit(await request('/api/affiliate/presets'));
    else if(op==='preset')await emit(await request(`/api/affiliate/presets/${encode(args[2])}/import`,'POST',{}));
    else if(op==='import-batch'){const data=await input(args[2]);if(!Array.isArray(data.plans))throw Error('Cần file có plans[].');const projects=[],errors=[];for(const [i,plan]of data.plans.entries()){try{projects.push(await request('/api/projects','POST',{document:plan.document||plan.plan?.document||plan,newCopy:flags['new-copy']===true}));}catch(e){errors.push({index:i,error:e.message});}}await emit({projects,errors});}
    else if(['plan','batch'].includes(op))await emit(await request(`/api/affiliate/${op}`,'POST',await input(args[2])));
    else if(op==='folder'){
      const manifest=await discoverAffiliateFolder(path.resolve(required(args[2],'PRODUCT_ROOT')));
      const products=[];for(const p of manifest.products){const refs={};for(const [role,file]of Object.entries(p.files))if(file)refs[role]=(await upload(file,true)).reference;const {files,folder,...spec}=p;products.push({...spec,references:refs});}
      const result=await request('/api/affiliate/batch','POST',{products,defaults:{mode:'template'}});await emit({...result,discoveryErrors:manifest.errors});
    }else throw Error('affiliate: options | plan | batch | folder');
  }
  if(command==='review')await emit(await request(`/api/jobs/${encode(args[1])}/review`,'POST',{state:flags.reject?'rejected':'approved',note:flags.note||''}));
  if(command==='media'){
    const op=args[1]||'jobs',id=args[2];
    if(['capabilities','voices'].includes(op))await emit(await request(`/api/media/${op}`));
    else if(op==='jobs')await emit(await request('/api/media/jobs'+(id?`?projectId=${encode(id)}`:'')));
    else if(op==='status')await emit(await request(`/api/media/jobs/${encode(id)}`));
    else if(['cancel','retry'].includes(op))await emit(await request(`/api/media/jobs/${encode(id)}/${op}`,'POST',{}));
    else if(['tts','render','frame','references'].includes(op))await emit(await request(`/api/media/${op}`,'POST',await input(id)));
    else if(op==='upload')await emit(await upload(required(id,'FILE')));
    else if(op==='download'){required(flags.out,'--out FILE');const r=await fetch(`${base}/api/media/jobs/${encode(id)}/file?artifact=${encodeURIComponent(flags.artifact||'media')}`,{signal:AbortSignal.timeout(300000)});if(!r.ok)throw Error(`Download HTTP ${r.status}`);await writeFile(flags.out,Buffer.from(await r.arrayBuffer()));output({ok:true,file:path.resolve(flags.out)});}
    else if(op==='wait'){const timeout=Number(flags.timeout||1800),interval=Number(flags.interval||2);if(!Number.isFinite(timeout)||timeout<=0||!Number.isFinite(interval)||interval<1)throw Error('timeout >0, interval >=1.');const deadline=Date.now()+timeout*1000;while(true){const job=await request(`/api/media/jobs/${encode(id)}`);if(!['queued','running','cancelling'].includes(job.state)){output(job);if(job.state!=='completed')process.exitCode=1;break;}if(Date.now()>deadline){output({timedOut:true,job});process.exitCode=2;break;}await new Promise(r=>setTimeout(r,interval*1000));}}
    else throw Error('Xem muse help: media.');
  }
  if(command==='accounts'||command==='proxies'){
    const group=command,op=args[1]||'list',id=args[2],route=`/api/admin/${group}`;
    if(op==='list')await emit(await request(route));
    else if(op==='show'&&group==='accounts')await emit(await request(`${route}/${encode(id)}`));
    else if(op==='login'&&group==='accounts')await emit(await request('/api/admin/account-login','POST',await input(id)));
    else if(op==='login-status'&&group==='accounts')await emit(await request('/api/admin/account-login'+(id?'/'+encode(id):'')));
    else if(op==='login-cancel'&&group==='accounts')await emit(await request('/api/admin/account-login/'+encode(id)+'/cancel','POST',{}));
    else if(op==='login-capabilities'&&group==='accounts')await emit(await request('/api/admin/account-login/capabilities'));
    else if(op==='add')await emit(await request(route,'POST',await input(id)));
    else if(op==='update')await emit(await request(`${route}/${encode(id)}`,'PATCH',await input(args[3])));
    else if(op==='delete')await emit(await request(`${route}/${encode(id)}`,'DELETE'));
    else if(op==='cookies'&&group==='accounts')await emit(await request(`${route}/${encode(id)}/cookies`,'POST',await input(args[3])));
    else if(['test','quota','keepalive'].includes(op))await emit(await request(`${route}${op==='keepalive'&&!id?'':`/${encode(id)}`}/${op}`,'POST',{}));
    else if(op==='test-draft'&&group==='proxies')await emit(await request(route+'/test','POST',await input(id)));
    else throw Error(`Xem muse help: ${group}.`);
  }
  if(command==='settings')await emit(await request('/api/settings',args[1]==='update'?'PUT':'GET',args[1]==='update'?await input(args[2]):undefined));
  if(command==='local-library')await emit(await request('/api/local-library'));
  if(command==='library-delete')await emit(await request('/api/library/delete','POST',{names:await input(args[1])}));
  if(command==='task-cancel')await emit(await request(`/api/backend/tasks/${encode(args[1])}/cancel`,'POST',{}));
  return true;
}
