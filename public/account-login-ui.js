export function createAccountLoginUI({api,esc,editor,button,proxyOptions,toast,onSaved}) {
  let timer=null,observedId=null,finishedId=null,mode='batch',cap=null;
  const active=job=>['queued','running','cancelling'].includes(job?.state);
  const labels={queued:'Đang chờ',running:'Đang đăng nhập',saving:'Đang lưu',completed:'Đã thêm',completed_with_errors:'Đã xong, có lỗi',failed:'Không thành công',cancelled:'Đã dừng',cancelling:'Đang dừng',skipped:'Đã có sẵn',unknown:'Cần đối chiếu',attention:'Cần đối chiếu',interrupted:'Đã gián đoạn'};
  function panel(job) {
    const done=job.rows.filter(r=>r.state==='completed').length;
    return `<div class="login-progress-heading"><div><span class="eyebrow">THÊM TÀI KHOẢN</span><h3>${esc(job.state==='completed'?'Đã hoàn tất':labels[job.state]||job.state)}</h3><p class="muted">${done}/${job.rows.length} tài khoản đã thêm · ${job.mode==='manual'?'Đăng nhập thủ công':'Đăng nhập tự động'}</p></div>${active(job)?button('login-stop','Dừng đăng nhập',job.id,job.state==='cancelling'?'disabled':''):button('account-add','＋ Thêm tài khoản')}</div>${job.message?`<p class="notice">${esc(job.message)}</p>`:''}<div class="login-results" aria-live="polite">${job.rows.map((row,i)=>`<div class="login-result"><span class="muted">${i+1}</span><div><strong>${esc(row.label)}</strong><small>${esc(row.message||'')}</small></div><span class="tag ${row.state==='completed'?'completed':row.state==='failed'||row.state==='unknown'?'failed':''}">${esc(labels[row.state]||row.state)}</span></div>`).join('')}</div>`;
  }
  async function refresh() {
    clearTimeout(timer);const target=document.querySelector('#accountLoginProgress');if(!target)return;
    try {
      const data=await api('/api/admin/account-login');if(!target.isConnected)return;
      const job=data.jobs.find(active)||data.jobs[0];
      if(!job){target.hidden=true;return;}
      target.hidden=false;target.innerHTML=panel(job);observedId=job.id;
      if(active(job))timer=setTimeout(refresh,1500);
      else if(finishedId!==job.id){finishedId=job.id;if(job.rows.some(r=>r.state==='completed'))await onSaved();}
    } catch {if(target.isConnected){target.hidden=false;target.textContent='Chưa đọc được tiến độ đăng nhập. Tải lại danh sách trước khi thử thêm lần nữa.';timer=setTimeout(refresh,5000);}}
  }
  async function open() {
    cap=await api('/api/admin/account-login/capabilities');
    const data=await api('/api/admin/account-login');
    if(!document.querySelector('[data-adm-view="accounts"]'))return;
    if(data.jobs.some(active)){toast('Đang có tiến trình đăng nhập. Xem bảng tiến độ ở đầu danh sách.');await refresh();return;}
    const id=crypto.randomUUID();
    editor(`<div class="login-editor-heading"><span class="eyebrow">TÀI KHOẢN MUSE</span><h2>Thêm tài khoản</h2><p class="muted">Đăng nhập rồi lưu tài khoản vào Muse trên máy này.</p></div>
      ${!cap.available?`<div class="notice">${!cap.runtime?'Chưa cài thành phần đăng nhập. Chạy lại Start-Muse-Web.cmd để chuẩn bị. ':''}${!cap.browser?'Cần cài Chrome hoặc Microsoft Edge trên máy chạy Muse Web.':''} Bạn vẫn có thể nhập cookie.</div>`:''}
      <form data-adm-form="login-start" data-request-id="${id}" autocomplete="off">
      <div class="login-methods" role="group" aria-label="Cách thêm tài khoản"><button type="button" class="${mode==='batch'?'primary':'ghost'}" data-adm-action="login-mode" data-login-mode="batch">Dán dữ liệu đăng nhập</button><button type="button" class="${mode==='manual'?'primary':'ghost'}" data-adm-action="login-mode" data-login-mode="manual">Tự đăng nhập trong trình duyệt</button>${button('account-cookie-add','Nhập cookie')}</div>
      <div data-login-panel="batch" ${mode==='batch'?'':'hidden'}><label>Mã nhập hoặc tài khoản<textarea name="credentials" rows="6" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Mỗi dòng một tài khoản hoặc mã nhập"></textarea></label><p class="muted small">Nhận mã nhập Muse Studio, email|mật_khẩu|2FA, email|mật_khẩu hoặc email|link_OTP. Tối đa 100 dòng. Bạn cũng có thể chọn file TXT.</p><label>File tài khoản<input name="file" type="file" accept=".txt,text/plain"></label></div>
      <div data-login-panel="manual" ${mode==='manual'?'':'hidden'}><label>Tên tài khoản<input name="label" maxlength="200" autocomplete="off" placeholder="Email hoặc tên để dễ nhận biết"></label><p class="muted">Một cửa sổ trình duyệt riêng sẽ mở trên máy đang chạy Muse Web. Bạn tự đăng nhập, nhập OTP hoặc xác minh. Khi phiên hợp lệ, web tự lưu tài khoản; đóng cửa sổ để hủy.</p></div>
      <label>Proxy khi đăng nhập<select name="proxy_id">${proxyOptions()}</select></label><p class="muted small">Mật khẩu và mã 2FA chỉ dùng trong lần đăng nhập này. Tài khoản trùng tên/email sẽ được bỏ qua để giữ phiên hiện tại.</p>
      <div class="page-actions"><button type="submit" class="primary" ${cap.available?'':'disabled'}>${mode==='manual'?'Mở trình duyệt đăng nhập':'Bắt đầu thêm tài khoản'}</button>${button('editor-close','Hủy')}</div><p class="notice" data-login-submit-status hidden></p></form>`);
  }
  async function handleClick(b) {
    const action=b.dataset.admAction;
    if(action==='account-add'){await open();return true;}
    if(action==='login-mode') {
      mode=b.dataset.loginMode;const form=b.closest('form');
      // Do not keep credentials hidden in a different mode.
      form.querySelector('[name="credentials"]').value='';form.querySelector('[name="file"]').value='';
      form.querySelectorAll('[data-login-panel]').forEach(p=>{p.hidden=p.dataset.loginPanel!==mode;});
      form.querySelectorAll('[data-login-mode]').forEach(p=>{p.className=p.dataset.loginMode===mode?'primary':'ghost';});
      form.querySelector('[type="submit"]').textContent=mode==='manual'?'Mở trình duyệt đăng nhập':'Bắt đầu thêm tài khoản';return true;
    }
    if(action==='login-stop'){await api(`/api/admin/account-login/${b.dataset.admId||observedId}/cancel`,{method:'POST',body:{}});await refresh();return true;}
    return false;
  }
  async function handleSubmit(form) {
    if(form.dataset.admForm!=='login-start')return false;
    const submit=form.querySelector('[type="submit"]');submit.disabled=true;
    try {
      const field=form.querySelector('[name="credentials"]'),file=form.querySelector('[name="file"]');
      let text=field.value.trim();if(mode==='batch'&&!text&&file.files[0]){if(file.files[0].size>100000)throw Error('File tối đa 100 KB.');text=(await file.files[0].text()).trim();}
      const label=form.querySelector('[name="label"]').value.trim();if(mode==='batch'&&!text)throw Error('Dán tài khoản hoặc chọn file TXT.');if(mode==='manual'&&!label)throw Error('Nhập tên để nhận biết tài khoản.');
      const body={requestId:form.dataset.requestId,mode,proxy_id:form.querySelector('[name="proxy_id"]').value,...(mode==='manual'?{label}:{text})};
      field.value='';file.value='';
      try {
        const job=await api('/api/admin/account-login',{method:'POST',body});observedId=job.id;finishedId=null;
        document.querySelector('#admEditor')?.remove();toast('Đã bắt đầu thêm tài khoản.');await refresh();
      } catch(error) {
        // Same request ID can be reconciled without resending the password batch.
        let recovered;try{recovered=await api(`/api/admin/account-login/${body.requestId}`);}catch{}
        if(recovered){document.querySelector('#admEditor')?.remove();observedId=recovered.id;finishedId=null;await refresh();}
        else {const status=form.querySelector('[data-login-submit-status]');status.hidden=false;status.textContent=error.message+' Kiểm tra bảng tiến độ trước khi gửi lại.';await refresh();}
      }
    } finally {submit.disabled=!cap?.available;}
    return true;
  }
  return {refresh,handleClick,handleSubmit};
}
