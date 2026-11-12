import { readFile, mkdir, rename } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { AppError, referencesOf } from './schema.mjs';

const activeStates=['submitting','running','downloading'];
export class Queue {
  constructor(store,backend,{interval=2500}={}) {this.store=store;this.backend=backend;this.interval=interval;this.busy=false;this.stopped=false;this.polling=new Set();}
  start(){this.timer=setInterval(()=>this.tick().catch(e=>console.error('Queue:',e.message)),this.interval);this.timer.unref();return this;}
  stop(){this.stopped=true;clearInterval(this.timer);}
  async reference(scene,project) {
    if(!scene.reference)return null;
    if(scene.reference.startsWith('asset:')) {
      const a=this.store.db.prepare('SELECT * FROM assets WHERE id=?').get(scene.reference.slice(6));
      if(!a)throw new AppError('Không tìm thấy ảnh tham chiếu.');
      if(!a.mime.startsWith('image/'))throw new AppError('Tham chiếu phải là ảnh.');
      return `data:${a.mime};base64,${(await readFile(path.resolve(this.store.dir,a.file))).toString('base64')}`;
    }
    const source=project.jobs.find(j=>j.scene_id===scene.reference.slice(6));
    if(source?.state!=='completed')throw new AppError('Ảnh tham chiếu chưa hoàn tất.');
    const file=source.result?.file;
    if(!file)throw new AppError('Ảnh tham chiếu chưa được tải về.');
    const mime=file.endsWith('.png')?'image/png':file.endsWith('.jpg')?'image/jpeg':'image/webp';
    return `data:${mime};base64,${(await readFile(path.join(this.store.dir,file))).toString('base64')}`;
  }
  async submit(job,project,scene) {
    if(this.store.job(job.id).state!=='queued'||this.store.get(project.id).paused)return;
    // Preparing references is local. Only mark submitting immediately before the network write.
    let refs;
    try{refs=await Promise.all(referencesOf(scene).map(reference=>this.reference({...scene,reference},project)));}catch(e){if(this.store.job(job.id).state==='queued')this.store.setJob(job.id,{state:'failed',error:e.message});return;}
    if(this.stopped||this.store.job(job.id).state!=='queued'||this.store.get(project.id).paused)return;
    const fresh=this.store.get(project.id);
    for(const ref of referencesOf(scene).filter(r=>r.startsWith('scene:'))){const dep=fresh.jobs.find(j=>j.scene_id===ref.slice(6)),source=fresh.scenes.find(s=>s.id===ref.slice(6));if(dep?.state!=='completed'||source?.reviewRequired&&dep.review?.state!=='approved')return;}
    this.store.setJob(job.id,{state:'submitting',error:null});
    const timeout=this.settings?.().taskTimeoutSeconds||600;
    const body={prompt:scene.prompt,size:scene.size,timeout:scene.kind==='image'?Math.min(timeout,600):timeout,...(scene.kind==='video'?{duration:scene.duration}:{keep_text:true,response_format:'url'}),...(refs.length===1?{image:refs[0]}:refs.length?{reference_image:refs}:{}),...(scene.referenceMode==='identity'?{reference_mode:'identity'}:{}),...(scene.accountId?{account_id:scene.accountId}:{})};
    try {
      const result=await this.backend.request(this.backend.route(scene.kind),{method:'POST',body,timeout:60000});
      if(!result.id)throw new AppError('Muse không trả task ID; cần đối chiếu thủ công.',502,'SUBMISSION_UNKNOWN');
      this.store.setJob(job.id,{state:'running',task_id:result.id});this.store.event(project.id,`${scene.title}: đã gửi Muse (${result.id}).`);
    } catch(e) {const state=e.code==='SUBMISSION_UNKNOWN'?'unknown':'failed';this.store.setJob(job.id,{state,error:e.message});this.store.event(project.id,`${scene.title}: ${state==='unknown'?'chưa rõ kết quả gửi, không tự gửi lại':e.message}.`);}
  }
  async poll(job,scene) {
    if(this.polling.has(job.id))return;
    this.polling.add(job.id);
    try {
      const d=await this.backend.request(this.backend.route(scene.kind,job.task_id));
      if(this.store.job(job.id).state==='cancelled')return;
      if(['succeeded','completed'].includes(d.status)) {
        const raw=d.result?.url||d.url||d.video?.url||d.data?.[0]?.url;
        if(!raw)throw new AppError('Muse đã xong nhưng chưa trả URL media.');
        this.store.setJob(job.id,{state:'downloading',result:{url:raw},error:null});
        await this.download(this.store.job(job.id),scene);
      } else if(d.status==='unknown') {
        this.store.setJob(job.id,{state:'unknown',error:'Chưa rõ kết quả trên Muse; giữ task ID để đối chiếu, không gửi lại tự động.'});
      } else if(['failed','error','cancelled','canceled'].includes(d.status)) {
        this.store.setJob(job.id,{state:d.status.startsWith('cancel')?'cancelled':'failed',error:typeof d.error==='string'?d.error:'Muse không hoàn thành tác vụ.'});
        this.store.event(job.project_id,`${scene.title}: ${d.status}.`);
      } else this.store.setJob(job.id,{state:'running',error:null,result:{progress:d.progress||0,backendStatus:d.status}});
    }catch(e){this.store.setJob(job.id,{error:`Đang chờ đồng bộ: ${e.message}`});}
    finally{this.polling.delete(job.id);}
  }
  async download(job,scene) {
    try {
      const route=this.backend.mediaRoute(job.result.url);
      const ext=path.extname(route).toLowerCase();
      if(!['.mp4','.webm','.png','.jpg','.jpeg','.webp'].includes(ext))throw new AppError('Định dạng media không được hỗ trợ.');
      const relative=`outputs/${job.project_id}/${scene.id}-${job.id.slice(0,8)}${job.attempt>1?`-a${job.attempt}`:''}${ext}`;
      const file=path.join(this.store.dir,relative);await mkdir(path.dirname(file),{recursive:true});
      const r=await this.backend.media(route);
      await pipeline(Readable.fromWeb(r.body),createWriteStream(file+'.part'));
      await rename(file+'.part',file);
      this.store.setJob(job.id,{state:'completed',error:null,result:{...job.result,file:relative,bytes:Number(r.headers.get('content-length'))||null}});
      this.store.event(job.project_id,`${scene.title}: đã hoàn tất và lưu media.`);
    }catch(e){this.store.setJob(job.id,{state:'downloading',error:`Đang chờ tải lại: ${e.message}`});}
  }
  async cancel(id) {
    const j=this.store.job(id);const p=this.store.get(j.project_id);const s=p.scenes.find(s=>s.id===j.scene_id);
    if(['submitting','unknown'].includes(j.state))throw new AppError('Chưa rõ tác vụ từ xa. Đối chiếu task ID trước khi hủy.',409);
    if(['completed','downloading'].includes(j.state))throw new AppError('Muse đã hoàn tất tác vụ này.',409);
    if(j.task_id&&j.state==='running'){
      const response=await this.backend.request(this.backend.route(s.kind,j.task_id)+'/cancel',{method:'POST',body:{}});
      // Cancellation can race completion. A completed remote result must still be downloaded.
      if(this.store.job(id).state==='completed')return this.store.job(id);
      if(['cancelled','canceled'].includes(response.status))return this.store.setJob(id,{state:'cancelled',error:'Muse đã xác nhận hủy.'});
      await this.poll(this.store.job(id),s);
      return this.store.job(id);
    }
    return this.store.setJob(id,{state:'cancelled',error:'Đã hủy trước khi gửi Muse.'});
  }
  async reconcile(id,taskId) {
    const j=this.store.job(id);if(j.state!=='unknown')throw new AppError('Chỉ đối chiếu tác vụ chưa rõ kết quả.',409);
    const p=this.store.get(j.project_id),s=p.scenes.find(s=>s.id===j.scene_id);
    const d=await this.backend.request(this.backend.route(s.kind,taskId));
    if(d.prompt!==s.prompt)throw new AppError('Prompt tác vụ Muse không trùng cảnh; không gắn tự động.',409);
    this.store.setJob(id,{task_id:taskId,state:'running',error:null});await this.poll(this.store.job(id),s);return this.store.job(id);
  }
  async tick() {
    if(this.busy||this.stopped)return;this.busy=true;
    try {
      let projects=this.store.list();
      for(const p of projects)for(const j of p.jobs) {
        const s=p.scenes.find(s=>s.id===j.scene_id);
        if(j.state==='running')await this.poll(j,s);
        else if(j.state==='downloading')await this.download(j,s);
      }
      projects=this.store.list();
      if(this.reviewCompleted)for(const p of projects)for(const j of p.jobs.filter(j=>j.state==='completed'&&!j.review&&p.scenes.find(s=>s.id===j.scene_id)?.reviewRequired))await this.reviewCompleted(p,j);
      projects=this.store.list();
      let globalActive=projects.flatMap(p=>p.jobs).filter(j=>activeStates.includes(j.state)).length;
      for(const p of projects) {
        if(p.paused)continue;
        let count=p.jobs.filter(j=>activeStates.includes(j.state)).length;
        for(const j of p.jobs.filter(j=>j.state==='queued')) {
          if(count>=p.settings.concurrency||globalActive>=(this.settings?.().maxParallel||8)||this.stopped)break;
          const scene=p.scenes.find(s=>s.id===j.scene_id);
          let ready=true;
          for(const ref of referencesOf(scene).filter(r=>r.startsWith('scene:'))){
            const dep=p.jobs.find(x=>x.scene_id===ref.slice(6));
            if(!dep||['failed','cancelled','blocked','unknown'].includes(dep.state)){this.store.setJob(j.id,{state:'blocked',error:'Cảnh ảnh tham chiếu cần được chạy thành công trước.'});continue;}
            if(dep.state!=='completed')ready=false;
            const depScene=p.scenes.find(s=>s.id===dep.scene_id);
            if(dep.state==='completed'&&depScene?.reviewRequired&&dep.review?.state!=='approved'){ready=false;this.store.setJob(j.id,{error:'Chờ duyệt ảnh tham chiếu trước khi tạo video.'});}
          }
          if(!ready||this.store.job(j.id).state!=='queued')continue;
          await this.submit(j,p,scene);count++;globalActive++;
        }
      }
    } finally {this.busy=false;}
  }
}
