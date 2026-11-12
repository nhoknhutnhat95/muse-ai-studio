import path from 'node:path';
import {createAdminService} from './admin.mjs';
import {createAffiliateService,parseAffiliateInfo} from './affiliate.mjs';
import {createMediaService} from './media.mjs';
import {workflowOptions,planWorkflow} from './workflows.mjs';
import {createAffiliateQC} from './affiliate-qc.mjs';

export function createFeatures({store,backend,dataDir,autoStart,body,json,file}){
  const admin=createAdminService({store,backend,dataDir}),affiliate=createAffiliateService({store,backend}),media=createMediaService({store,dataDir,autoStart});
  const qc=createAffiliateQC({store,dataDir});
  async function inspectImages(input){const report=await qc.inspect(input);for(const image of report.images){store.db.prepare('INSERT OR REPLACE INTO image_qc VALUES(?,?,?)').run(image.jobId,JSON.stringify({...image,engine:report.engine,checkedAt:report.checkedAt}),report.checkedAt);if(input.apply===true){const p=store.get(input.projectId),scene=p.scenes.find(s=>s.id===image.sceneId),job=p.jobs.find(j=>j.id===image.jobId);if(scene.reviewRequired&&!job.review)store.review(image.jobId,{state:image.flags.length?'rejected':'approved',note:image.flags.length?image.flags.map(f=>f.message).join(' ').slice(0,2000):'Đã qua kiểm tra pixel local; chưa xác minh nội dung ngữ nghĩa.'});}}return report;}
  async function route(req,res,url){
    const p=url.pathname,m=req.method,query=Object.fromEntries(url.searchParams);
    const send=data=>{json(res,200,data);return true;};
    if(p==='/api/settings'&&m==='GET')return send(admin.settings());
    if(p==='/api/settings'&&m==='PUT')return send(admin.updateSettings(await body(req)));
    if(p==='/api/workflows/options'&&m==='GET')return send(workflowOptions());
    if(p==='/api/workflows/plan'&&m==='POST')return send(planWorkflow(await body(req)));
    if(p==='/api/affiliate/options'&&m==='GET')return send(affiliate.options());
    if(p==='/api/affiliate/presets'&&m==='GET')return send(affiliate.presets());
    const preset=/^\/api\/affiliate\/presets\/([\w-]+)\/(image|import)$/.exec(p);
    if(preset&&((preset[2]==='image'&&m==='GET')||(preset[2]==='import'&&m==='POST'))){const a=await affiliate.presetAsset(preset[1]);if(preset[2]==='import')return send(media.importAsset({name:a.name,mime:a.mime,base64:a.data.toString('base64')}));res.writeHead(200,{'Content-Type':a.mime,'Content-Length':a.data.length});res.end(a.data);return true;}
    if(p==='/api/affiliate/plan'&&m==='POST')return send(await affiliate.plan(await body(req)));
    if(p==='/api/affiliate/batch'&&m==='POST')return send(await affiliate.batch(await body(req)));
    if(p==='/api/affiliate/info'&&m==='POST')return send(parseAffiliateInfo((await body(req)).text));
    if(p==='/api/affiliate/qc'&&m==='POST')return send(await inspectImages(await body(req)));
    if(p==='/api/admin/accounts'&&m==='GET')return send(await admin.accounts(query));
    if(p==='/api/admin/accounts'&&m==='POST')return send(await admin.addAccount(await body(req)));
    if(p==='/api/admin/accounts/keepalive'&&m==='POST')return send(await admin.keepaliveAll());
    const account=/^\/api\/admin\/accounts\/([^/]+)(?:\/(cookies|test|quota|keepalive))?$/.exec(p);
    if(account){const id=decodeURIComponent(account[1]),action=account[2];
      if(!action&&m==='GET')return send(await admin.account(id));
      if(!action&&m==='PATCH')return send(await admin.updateAccount(id,await body(req)));
      if(!action&&m==='DELETE')return send(await admin.deleteAccount(id));
      if(m==='POST'&&action==='cookies')return send(await admin.updateCookies(id,await body(req)));
      if(m==='POST'&&action==='test')return send(await admin.testAccount(id));
      if(m==='POST'&&action==='quota')return send(await admin.quota(id));
      if(m==='POST'&&action==='keepalive')return send(await admin.keepaliveAccount(id));
    }
    if(p==='/api/admin/proxies'&&m==='GET')return send(await admin.proxies());
    if(p==='/api/admin/proxies'&&m==='POST')return send(await admin.addProxy(await body(req)));
    if(p==='/api/admin/proxies/test'&&m==='POST')return send(await admin.testProxyDraft(await body(req)));
    const proxy=/^\/api\/admin\/proxies\/([^/]+)(?:\/(test))?$/.exec(p);
    if(proxy){const id=decodeURIComponent(proxy[1]);
      if(!proxy[2]&&m==='PATCH')return send(await admin.updateProxy(id,await body(req)));
      if(!proxy[2]&&m==='DELETE')return send(await admin.deleteProxy(id));
      if(proxy[2]==='test'&&m==='POST')return send(await admin.testProxy(id));
    }
    if(p==='/api/library'&&m==='GET'){const result=await admin.library({...query,kind:query.kind||undefined});result.media=result.media.map(x=>({...x,url:`/api/library/media/${encodeURIComponent(x.name)}`}));return send(result);}
    if(p==='/api/library/delete'&&m==='POST')return send(await admin.deleteMedia((await body(req)).names));
    if(p==='/api/local-library'&&m==='GET'){const results=store.list().flatMap(p=>p.jobs.filter(j=>j.state==='completed'&&j.result?.file).map(j=>({id:j.id,projectId:p.id,project:p.title,name:p.scenes.find(s=>s.id===j.scene_id)?.title,kind:p.scenes.find(s=>s.id===j.scene_id)?.kind,mtime:j.updated,url:`/api/jobs/${j.id}/media`,file:j.result.file})));return send({media:[...media.list().filter(j=>j.state==='completed').map(j=>({id:j.id,projectId:j.project_id,name:`${j.kind} · ${j.created}`,kind:j.result.mime?.startsWith('image/')?'image':j.result.mime?.startsWith('audio/')?'audio':'video',bytes:j.result.bytes,mtime:j.updated,url:`/api/media/jobs/${j.id}/file`,file:j.result.file})),...results]});}
    if(p==='/api/media/capabilities'&&m==='GET')return send(media.capabilities());
    if(p==='/api/media/voices'&&m==='GET')return send(media.voices());
    if(p==='/api/media/jobs'&&m==='GET')return send(media.list(query));
    if(p==='/api/media/tts'&&m==='POST')return send(media.synthesize(await body(req)));
    if(p==='/api/media/render'&&m==='POST')return send(media.render(await body(req)));
    if(p==='/api/media/frame'&&m==='POST')return send(media.frame(await body(req)));
    if(p==='/api/media/references'&&m==='POST')return send(media.prepareAffiliateReferences(await body(req)));
    if(p==='/api/media/assets'&&m==='POST')return send(media.importAsset(await body(req,350*1024*1024)));
    const job=/^\/api\/media\/jobs\/([a-f0-9-]+)(?:\/(cancel|retry|file))?$/.exec(p);
    if(job){const[,id,action]=job;
      if(!action&&m==='GET')return send(media.get(id));
      if(action==='cancel'&&m==='POST')return send(media.cancel(id));
      if(action==='retry'&&m==='POST')return send(media.retry(id));
      if(action==='file'&&['GET','HEAD'].includes(m)){const result=media.resolveFile(id,query.artifact||'media');if(query.download||query.artifact)res.setHeader('Content-Disposition',`attachment; filename="${path.basename(result.file)}"`);await file(res,req,result.file);return true;}
    }
    return false;
  }
  return {route,admin,affiliate,media,inspectImages,close:()=>media.close()};
}
