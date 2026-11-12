export function projectSummary(project) {
  const jobs=project.jobs||[],done=jobs.filter(j=>j.state==='completed').length;
  const waitingReview=jobs.some(j=>j.state==='completed'&&project.scenes.find(s=>s.id===j.scene_id)?.reviewRequired&&j.review?.state!=='approved');
  if(waitingReview)return {state:'blocked',label:'Chờ duyệt ảnh',done};
  if(jobs.some(j=>['failed','unknown','blocked'].includes(j.state)))return {state:'failed',label:'Cần kiểm tra',done};
  if(done===project.scenes.length&&done>0)return {state:'completed',label:'Đã tạo đủ cảnh',done};
  if(project.paused)return {state:'paused',label:jobs.length?'Đang tạm dừng':'Bản nháp',done};
  if(jobs.some(j=>['queued','submitting','running','downloading'].includes(j.state)))return {state:'running',label:'Đang tạo',done};
  return {state:'draft',label:jobs.length?'Chưa hoàn tất':'Bản nháp',done};
}

export function createProjectSidebar() {
  const panel=document.querySelector('#projectSidebar'),toggle=document.querySelector('#toggleProjects'),close=document.querySelector('#closeProjects'),backdrop=document.querySelector('#projectsBackdrop');
  const narrow=window.matchMedia('(max-width:1179px)'),background=[document.querySelector('.sidebar'),document.querySelector('.shell')];
  let open=false;
  function sync() {
    const modal=narrow.matches&&open;
    document.body.classList.toggle('projects-open',modal);
    panel.inert=narrow.matches&&!open;
    panel.setAttribute('role',narrow.matches?'dialog':'complementary');
    if(modal)panel.setAttribute('aria-modal','true');else panel.removeAttribute('aria-modal');
    if(narrow.matches&&!open)panel.setAttribute('aria-hidden','true');else panel.removeAttribute('aria-hidden');
    backdrop.hidden=!modal;toggle.setAttribute('aria-expanded',String(!narrow.matches||open));
    background.forEach(el=>el.inert=modal);
  }
  function dismiss() {if(!narrow.matches||!open)return;open=false;sync();toggle.focus();}
  toggle.addEventListener('click',()=>{open=!open;sync();if(open)requestAnimationFrame(()=>{if(open)document.querySelector('#projectSearch').focus();});});
  close.addEventListener('click',dismiss);backdrop.addEventListener('click',dismiss);
  panel.addEventListener('click',event=>{if(event.target.closest('[data-project],#newProject'))dismiss();});
  document.addEventListener('keydown',event=>{
    if(!narrow.matches||!open)return;
    if(event.key==='Escape'){event.preventDefault();dismiss();return;}
    if(event.key!=='Tab')return;
    const focusable=[...panel.querySelectorAll('button:not(:disabled),input:not(:disabled),a[href]')].filter(el=>el.getClientRects().length);
    const first=focusable[0],last=focusable.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  });
  narrow.addEventListener('change',()=>{open=false;sync();if(panel.contains(document.activeElement)&&narrow.matches)toggle.focus();});
  sync();
}

export function createProjectResults({api,esc,getCurrent}) {
  let lastHost=null,lastSignature='';
  const states={queued:'Đang chờ dựng',running:'Đang dựng video',cancelling:'Đang hủy',cancelled:'Đã hủy',interrupted:'Bản dựng bị gián đoạn',failed:'Dựng video bị lỗi'};
  async function refresh() {
    const host=document.querySelector('#projectResults'),project=getCurrent();
    if(!host||!project)return;
    const id=project.id;
    try {
      const jobs=await api(`/api/media/jobs?projectId=${encodeURIComponent(id)}`);
      if(document.querySelector('#projectResults')!==host||getCurrent()?.id!==id)return;
      const renders=jobs.filter(j=>j.project_id===id&&j.kind==='render').sort((a,b)=>b.created.localeCompare(a.created));
      const signature=JSON.stringify(renders);
      if(host===lastHost&&signature===lastSignature)return;
      if([...host.querySelectorAll('video')].some(v=>!v.paused))return;
      lastHost=host;lastSignature=signature;
      const done=renders.filter(j=>j.state==='completed'&&j.result?.file),latest=done[0];
      const unfinished=renders.filter(j=>j.state!=='completed');
      const status=unfinished.length?`<p class="muted">${esc(states[unfinished[0].state]||unfinished[0].state)}${unfinished[0].error?` · ${esc(unfinished[0].error)}`:''}</p>`:'';
      const actions='<button class="ghost small" data-project-production>Mở lồng tiếng & dựng phim ↗</button>';
      if(!latest){
        host.innerHTML=`<div class="project-results-empty"><div><h2>Video thành phẩm</h2><p>Chưa có bản dựng. Xem từng clip nguồn trong storyboard bên dưới.</p>${status}</div>${actions}</div>`;
        return;
      }
      const url=`/api/media/jobs/${encodeURIComponent(latest.id)}/file`,r=latest.result;
      const details=[Number.isFinite(r.duration)?`${r.duration.toLocaleString('vi-VN',{maximumFractionDigits:1})} giây`:null,r.width&&r.height?`${r.width} × ${r.height}`:null,Number.isFinite(r.fps)?`${Math.round(r.fps)} fps`:null].filter(Boolean).join(' · ');
      host.innerHTML=`<div class="project-results-heading"><div><span class="eyebrow">VIDEO THÀNH PHẨM</span><h2>Bản dựng mới nhất</h2></div><span class="tag completed">Đã xuất video</span></div>
        <div class="project-delivery"><video src="${url}" controls preload="metadata" playsinline aria-label="Video thành phẩm của ${esc(project.title)}"></video>
        <div class="project-delivery-info"><h3>${esc(project.title)}</h3><p>${esc(details)}</p><p class="muted">Xuất ${new Date(latest.updated||latest.created).toLocaleString('vi-VN')}</p><div class="button-row"><a class="button primary" href="${url}?download=1" download>Tải video MP4 ↓</a><a class="button ghost" href="#storyboard">Xem từng cảnh ↓</a></div>${status}<p class="project-result-note">Video được dựng từ dự án này. Các clip nguồn được giữ ở storyboard.</p>${actions}
        ${done.length>1?`<details><summary>${done.length-1} bản dựng trước</summary>${done.slice(1).map(j=>`<a class="previous-render" href="/api/media/jobs/${encodeURIComponent(j.id)}/file" target="_blank" rel="noopener">${new Date(j.created).toLocaleString('vi-VN')} · Xem video ↗</a>`).join('')}</details>`:''}</div></div>`;
    } catch(error) {
      if(document.querySelector('#projectResults')!==host||getCurrent()?.id!==id)return;
      if(host===lastHost)return;
      host.innerHTML=`<div class="notice">Chưa đọc được bản dựng: ${esc(error.message)} <button class="ghost small" id="refreshProjectResults">Thử lại</button></div>`;
    }
  }
  return {refresh};
}
