import {createAccountLoginUI} from './account-login-ui.js';
export function createAdminUI({api,esc,heading,toast}) {
  const $=selector=>document.querySelector(selector);
  const stateLabels={healthy:'Phiên hợp lệ',error:'Cần đăng nhập lại',disabled:'Đã tắt',expired:'Hết hạn phiên',unchecked:'Chưa kiểm tra phiên'};
  let currentView='accounts',accounts=[],proxies=[],filter={search:'',state:'all',quota:'all',sort:'remaining',offset:0,limit:100},epoch=0,quotaRefresh=null;
  const date=value=>value?new Date(value*1000).toLocaleString('vi-VN'):'—';
  const opt=(value,label,selected)=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`;
  const button=(action,label,aid='',extra='')=>`<button type="button" class="ghost small" data-adm-action="${action}" ${aid?`data-adm-id="${esc(aid)}"`:''} ${extra}>${label}</button>`;
  const proxyOptions=(selected='')=>opt('','Không dùng proxy',selected)+proxies.map(p=>opt(p.id,`${p.name||'Proxy'} · ${p.display||'Đã lưu'}`,selected)).join('');
  const field=(name,label,value='',type='text',attrs='')=>`<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
  const pct=value=>value.toLocaleString('vi-VN',{maximumFractionDigits:2});
  const tokens=value=>{const scale=value>=1e9?[1e9,' tỷ']:value>=1e6?[1e6,' triệu']:value>=1e3?[1e3,' nghìn']:[1,''];return pct(value/scale[0])+scale[1]+' token';};
  const quota=(q,v)=>{
    v||={status:'unknown',weeklyRemainingPct:null,extraState:'unknown',stale:true};
    const labels={available:`Còn ${v.weeklyRemainingPct===null?'—':pct(v.weeklyRemainingPct)}% tuần`,extra_only:'Hết tuần · còn bổ sung',exhausted:'Hết hạn mức',weekly_exhausted:'Hết tuần · bổ sung chưa rõ',unknown:'Chưa xác định'};
    const extra=v.extraExpired?'Bổ sung đã hết hạn':v.extraState==='available'?`Bổ sung còn ${tokens(v.extraRemainingTokens)}`:v.extraState==='exhausted'?'Bổ sung: đã hết':v.conflict?'Bổ sung: số liệu không khớp, cần đọc lại':'Bổ sung: chưa xác định';
    return `<div class="quota-cell"><strong class="quota-badge ${v.status}">${esc(labels[v.status])}</strong>${v.weeklyRemainingPct!==null?`<meter class="quota-meter" min="0" max="100" value="${v.weeklyRemainingPct}" aria-label="Hạn mức tuần còn ${pct(v.weeklyRemainingPct)}%">${pct(v.weeklyRemainingPct)}%</meter><small>Tuần: còn <b>${pct(v.weeklyRemainingPct)}%</b> · đã dùng ${pct(100-v.weeklyRemainingPct)}%</small>`:'<small>Chưa đọc được phần hạn mức tuần.</small>'}<small class="quota-extra">${esc(extra)}</small>${q?.weekly_reset?`<small class="muted">Đặt lại tuần: ${esc(q.weekly_reset)}</small>`:''}<small class="${v.stale?'quota-stale':'muted'}">${v.stale?'⚠ Số liệu cũ / cần cập nhật':'Đã cập nhật'}${v.checkedAt?' · '+esc(date(v.checkedAt)):''}</small></div>`;
  };
  const loading=view=>{currentView=view;$('#main').innerHTML=`<div data-adm-view="${view}">${heading(view==='accounts'?'Tài khoản Muse':view==='proxies'?'Proxy':'Cài đặt studio','Đang tải dữ liệu trên máy…')}<div class="loading">Đang tải…</div></div>`;};
  const live=view=>$(`[data-adm-view="${view}"]`)!==null;
  function editor(html){$('#admEditor')?.remove();$('[data-adm-view]')?.insertAdjacentHTML('beforeend',`<section class="connection-card" id="admEditor" tabindex="-1">${html}</section>`);$('#admEditor')?.scrollIntoView({behavior:'smooth',block:'start'});$('#admEditor')?.focus();}
  const loginUI=createAccountLoginUI({api,esc,editor,button,proxyOptions,toast,onSaved:()=>document.querySelector('[data-adm-form="login-start"]')?undefined:render('accounts')});
  function selected(){return [...document.querySelectorAll('input[data-adm-select]:checked')].map(input=>input.value);}
  function renderAccounts(data){
    const stats=data.stats,q=stats.quota;
    return `${heading('Tài khoản Muse','Nhìn riêng hạn mức tuần, token bổ sung và tình trạng đăng nhập.',button('quota-refresh-all','↻ Cập nhật quota tất cả','',quotaRefresh?.running?'disabled':'')+button('refresh','Tải lại danh sách')+button('account-add','＋ Thêm tài khoản'))}
      <section id="accountLoginProgress" class="connection-card" hidden></section>
      <div class="quota-summary"><button class="quota-summary-card available ${filter.quota==='available'?'selected':''}" data-adm-action="quota-filter" data-adm-quota="available"><span>CÒN HẠN MỨC TUẦN</span><strong>${q.available}</strong><small>tài khoản còn trên 0% tuần</small></button><button class="quota-summary-card extra_only ${filter.quota==='extra_only'?'selected':''}" data-adm-action="quota-filter" data-adm-quota="extra_only"><span>CHỈ CÒN BỔ SUNG</span><strong>${q.extra_only}</strong><small>hết tuần, còn token bổ sung</small></button><button class="quota-summary-card exhausted ${filter.quota==='exhausted'?'selected':''}" data-adm-action="quota-filter" data-adm-quota="exhausted"><span>HẾT HẠN MỨC</span><strong>${q.exhausted}</strong><small>tuần và bổ sung đều hết</small></button><button class="quota-summary-card unknown ${filter.quota==='unknown'?'selected':''}" data-adm-action="quota-filter" data-adm-quota="unknown"><span>CHƯA XÁC ĐỊNH</span><strong>${q.unknown}</strong><small>thiếu dữ liệu, cần đọc quota</small></button></div>
      <p class="quota-explanation">${stats.total} tài khoản · <b>${q.weeklyExhausted} đã hết hạn mức tuần</b> · ${stats.healthy} phiên hợp lệ · ${stats.disabled} đã tắt. Nhãn “Phiên hợp lệ” chỉ nói về đăng nhập. Hạn mức hiển thị theo lần đọc gần nhất; token không quy đổi thành số video.</p>
      ${q.stale?`<div class="notice">${q.stale} tài khoản có số liệu quá 1 giờ hoặc chưa được đọc. Bấm <b>Cập nhật quota tất cả</b> để biết hạn mức mới nhất; thao tác này không tạo video.</div>`:''}
      <div id="admQuotaRefreshStatus" class="notice success" ${quotaRefresh?.running?'':'hidden'}>${quotaRefresh?.running?`Đang cập nhật ${quotaRefresh.done}/${quotaRefresh.total} tài khoản…`:''}</div>${quotaRefresh?.running?button('quota-refresh-stop','Dừng sau tài khoản hiện tại'):''}
      <form id="admAccountFilter" class="account-filter" data-adm-form="filter">${field('search','Tìm tài khoản',filter.search,'search','maxlength="200" placeholder="Tên hoặc ID"')}<label>Hạn mức<select name="quota">${[['all','Tất cả hạn mức'],['remaining','Còn tuần hoặc bổ sung'],['available','Còn hạn mức tuần'],['extra_only','Chỉ còn bổ sung'],['exhausted','Hết cả tuần và bổ sung'],['weekly_exhausted','Hết tuần, bổ sung chưa rõ'],['unknown','Chưa xác định'],['stale','Cần cập nhật quota']].map(([v,l])=>opt(v,l,filter.quota)).join('')}</select></label><label>Phiên đăng nhập<select name="state">${opt('all','Tất cả phiên',filter.state)+Object.entries(stateLabels).map(([v,label])=>opt(v,label,filter.state)).join('')}</select></label><label>Sắp xếp<select name="sort">${[['remaining','Còn nhiều hạn mức trước'],['exhausted','Hết hạn mức trước'],['name','Tên tài khoản'],['oldest_quota','Quota cũ nhất trước']].map(([v,l])=>opt(v,l,filter.sort)).join('')}</select></label><button class="ghost small" type="submit">Lọc</button>${button('filter-reset','Bỏ lọc')}</form>
      <div class="toolbar"><div class="left">${button('select-all','Chọn / bỏ chọn trang')}${button('bulk-enable','Bật đã chọn')}${button('bulk-disable','Tắt đã chọn')}${button('bulk-proxy','Gán proxy')}${button('bulk-quota','Cập nhật quota đã chọn')}${button('bulk-delete','Xóa đã chọn')}</div><span class="muted small">${data.total} tài khoản phù hợp</span></div>
      <div class="table-wrap"><table class="accounts-table"><thead><tr><th>CHỌN</th><th>TÀI KHOẢN</th><th>HẠN MỨC CÒN LẠI</th><th>PHIÊN ĐĂNG NHẬP</th><th>THAO TÁC</th></tr></thead><tbody>${accounts.map(a=>`<tr data-quota-state="${a.quotaAvailability.status}"><td><input type="checkbox" data-adm-select value="${esc(a.id)}" aria-label="Chọn ${esc(a.label||a.id)}"></td><td><b>${esc(a.label||'Chưa đặt tên')}</b><br><small class="muted">${esc(a.id)}</small><br><small>${esc(a.quota?.plan||a.login_type||'')}</small><br><small class="muted">Proxy: ${esc(proxies.find(p=>p.id===a.proxy_id)?.name||(a.proxy_id?'Đã gán':'Không dùng'))}</small></td><td>${quota(a.quota,a.quotaAvailability)}</td><td><span class="tag ${a.state==='healthy'?'completed':a.state==='error'||a.state==='expired'?'failed':''}">${esc(stateLabels[a.state]||a.state)}</span><br><small class="muted">Hạn phiên${a.expires_estimated?' (ước tính)':''}: ${esc(date(a.expires_at))}</small><br><small>${a.video_24h_count} video trong 24h</small></td><td><div class="account-actions">${button('account-quota','↻ Đọc quota',a.id)}${button('account-detail','Chi tiết',a.id)}${button('account-edit','Sửa',a.id)}${button('account-test','Kiểm tra phiên',a.id)}${button('account-toggle',a.enabled?'Tắt':'Bật',a.id)}${button('account-delete','Xóa',a.id)}</div></td></tr>`).join('')||'<tr><td colspan="5" class="muted">Không có tài khoản phù hợp với bộ lọc.</td></tr>'}</tbody></table></div>
      <div class="toolbar">${button('page-prev','← Trang trước','',filter.offset===0?'disabled':'')}<span class="muted small">${data.total?filter.offset+1:0}–${Math.min(filter.offset+filter.limit,data.total)} / ${data.total}</span>${button('page-next','Trang sau →','',filter.offset+filter.limit>=data.total?'disabled':'')}${button('keepalive-all','Làm mới tất cả phiên')}</div>
      <details><summary>Đăng nhập và khôi phục tài khoản</summary><p class="muted">Bấm Thêm tài khoản để nhập mã Muse Studio, email/mật khẩu/2FA, link OTP hoặc tự đăng nhập trong trình duyệt. Tài khoản đã có được bỏ qua; có thể thay cookie ở mục Sửa. Sau khi thêm thành công, bấm Đọc quota để cập nhật hạn mức.</p><p class="muted">Cookie, mật khẩu và mã 2FA là dữ liệu chỉ nhập; không hiển thị lại hoặc lưu trong trình duyệt.</p></details>`;
  }
  function renderProxies(){
    return `${heading('Danh mục proxy','Gán proxy đã lưu cho một hoặc nhiều tài khoản Muse.',button('refresh','↻ Làm mới')+button('proxy-add','＋ Thêm proxy'))}<div class="table-wrap"><table><thead><tr><th>TÊN</th><th>ĐỊA CHỈ</th><th>ĐĂNG NHẬP</th><th>THAO TÁC</th></tr></thead><tbody>${proxies.map(p=>`<tr><td><b>${esc(p.name||'Chưa đặt tên')}</b><br><small class="muted">${esc(p.id)}</small></td><td>${esc(p.scheme.toUpperCase())} · ${esc(p.display||'Địa chỉ đã lưu')}</td><td>${p.hasCredentials?'Có thông tin đăng nhập':'Không có'}</td><td>${button('proxy-edit','Sửa',p.id)} ${button('proxy-test','Kiểm tra',p.id)} ${button('proxy-delete','Xóa',p.id)}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">Chưa có proxy. Tài khoản đang dùng kết nối trực tiếp.</td></tr>'}</tbody></table></div><div class="connection-card"><h3>Cách gán proxy</h3><p class="muted">Thêm proxy tại đây, sau đó mở Tài khoản và chọn Sửa hoặc Gán proxy. Backend Muse kiểm tra proxy và áp dụng cho các tác vụ mới. Nếu cần đăng nhập lại qua proxy vừa đổi, thực hiện trong app Muse trên máy.</p></div>`;
  }
  function renderSettings(settings){
    return `${heading('Cài đặt studio','Tùy chọn cho bản web, được lưu trên máy.')}
      <form class="connection-card" data-adm-form="settings">
        <h2>Mặc định cho kịch bản mới</h2><p class="muted">Các dự án đã nhập giữ nguyên thông số.</p>
        <div class="form-row"><label>Tỷ lệ khung hình<select name="size">${['16:9','9:16','1:1','4:3','3:4'].map(v=>opt(v,v,settings.defaults.size)).join('')}</select></label>${field('duration','Thời lượng mỗi video (giây)',settings.defaults.duration,'number','min="1" max="30" required')}${field('concurrency','Tác vụ song song / dự án',settings.defaults.concurrency,'number','min="1" max="8" required')}</div>
        <p class="muted small">Video hỗ trợ 16:9 và 9:16. Tỷ lệ vuông, 4:3 và 3:4 dành cho ảnh.</p>
        <h2>Hàng đợi của web</h2><div class="form-row">${field('maxParallel','Tổng tác vụ song song',settings.queue.maxParallel,'number','min="1" max="8" required')}${field('taskTimeoutSeconds','Thời gian chờ tác vụ (giây)',settings.queue.taskTimeoutSeconds,'number','min="60" max="1800" required')}</div><p class="muted small">Giới hạn tổng áp dụng cho tất cả dự án trên web. Mỗi dự án còn tuân theo giới hạn riêng. Thời gian chờ cho phép từ 1 đến 30 phút.</p>
        <h2>Thư viện</h2><div class="form-row"><label>Sắp xếp<select name="sort">${[['newest','Mới nhất'],['oldest','Cũ nhất'],['name','Tên tệp'],['largest','Dung lượng lớn nhất'],['smallest','Dung lượng nhỏ nhất']].map(([v,label])=>opt(v,label,settings.library.sort)).join('')}</select></label><label>Loại media<select name="kind">${[['all','Tất cả'],['video','Video'],['image','Ảnh']].map(([v,label])=>opt(v,label,settings.library.kind)).join('')}</select></label>${field('pageSize','Số tệp mỗi trang',settings.library.pageSize,'number','min="1" max="500" required')}</div><button type="submit" class="primary">Lưu cài đặt</button>
      </form>
      <div class="connection-card"><h3>Lưu và xuất kết quả</h3><p class="muted">Chọn Tải về trên media để lưu qua trình duyệt. CLI xuất danh sách kết quả cùng trạng thái và đường dẫn media thành JSON:</p><pre>node D:/muse-studio-ai/bin/muse.mjs export PROJECT_ID --out ket-qua.json</pre></div>
      <div class="connection-card"><h3>Dữ liệu của web</h3><p class="muted">Dự án, tài khoản và media lưu riêng trong thư mục data của web. Giới hạn hàng đợi và thời gian chờ ở trên áp dụng cho các tác vụ mới.</p></div>`;
  }
  async function render(view){
    if(!['accounts','proxies','settings'].includes(view))return false;
    const token=++epoch;loading(view);
    try {
      let html;
      if(view==='accounts'){const [data,p]=await Promise.all([api(`/api/admin/accounts?${new URLSearchParams(filter)}`),api('/api/admin/proxies')]);if(token!==epoch||!live(view))return true;accounts=data.accounts;proxies=p.proxies;html=renderAccounts(data);}
      if(view==='proxies'){const data=await api('/api/admin/proxies');if(token!==epoch||!live(view))return true;proxies=data.proxies;html=renderProxies();}
      if(view==='settings'){const settings=await api('/api/settings');if(token!==epoch||!live(view))return true;html=renderSettings(settings);}
      if(token===epoch&&live(view)){$('[data-adm-view]').innerHTML=html;if(view==='accounts')await loginUI.refresh();}
    } catch(error){if(token===epoch&&live(view))$('[data-adm-view]').innerHTML=`${heading('Chưa tải được dữ liệu','Kiểm tra mục Kết nối Muse hoặc chạy Restart-Muse-Web.cmd.',button('refresh','↻ Thử lại'))}<div class="notice">${esc(error.message)}</div>`;}
    return true;
  }
  function addAccountEditor(){
    editor(`<h2>Nhập tài khoản bằng cookie</h2><form data-adm-form="account-add" autocomplete="off"><div class="form-row">${field('label','Tên tài khoản (một tài khoản)','','text','maxlength="200"')}<label>Proxy<select name="proxy_id">${proxyOptions()}</select></label></div><label>Kiểu nhập<select name="mode">${opt('single','Một chuỗi Cookie header','single')}${opt('batch','Nhiều tài khoản, mỗi dòng một chuỗi Cookie header','single')}</select></label><label>Cookie<textarea name="credential" rows="5" spellcheck="false" autocomplete="off" placeholder="Dán cookie tại đây"></textarea></label><label>Hoặc chọn file TXT<input type="file" name="file" accept=".txt,text/plain"></label><p class="muted small">Dữ liệu được gửi đến backend Muse khi bạn bấm Nhập tài khoản. Ô nhập sẽ được xóa sau khi gửi.</p><div class="page-actions"><button type="submit" class="primary">Nhập tài khoản</button>${button('editor-close','Hủy')}</div></form>`);
  }
  function accountEditor(a){
    editor(`<h2>Sửa ${esc(a.label||a.id)}</h2><form data-adm-form="account-edit" data-adm-id="${esc(a.id)}"><div class="form-row">${field('label','Tên tài khoản',a.label,'text','maxlength="200"')}<label>Trạng thái<select name="enabled">${opt('true','Bật',String(a.enabled))}${opt('false','Tắt',String(a.enabled))}</select></label><label>Proxy<select name="proxy_id">${proxyOptions(a.proxy_id||'')}</select></label></div><div class="page-actions"><button type="submit" class="primary">Lưu thay đổi</button>${button('editor-close','Đóng')}</div></form><hr><h3>Thay cookie</h3><form data-adm-form="account-cookies" data-adm-id="${esc(a.id)}" autocomplete="off"><label>Cookie mới<textarea name="cookie_header" rows="3" required spellcheck="false" autocomplete="off"></textarea></label><button type="submit" class="ghost">Cập nhật cookie</button></form>`);
  }
  function proxyEditor(p=null){
    editor(`<h2>${p?'Sửa proxy':'Thêm proxy'}</h2><form data-adm-form="proxy-save" ${p?`data-adm-id="${esc(p.id)}"`:''} autocomplete="off"><div class="form-row">${field('name','Tên proxy',p?.name??'','text','maxlength="40" required')}<label>Loại<select name="scheme">${['http','https','socks5'].map(v=>opt(v,v.toUpperCase(),p?.scheme||'http')).join('')}</select></label></div>${field('proxy',p?'Địa chỉ mới (để trống để giữ nguyên)':'Địa chỉ proxy','','password',`maxlength="2048" autocomplete="new-password" ${p?'':'required'}`)}<p class="muted small">Dạng host:port:user:pass hoặc scheme://user:pass@host:port. ${p?'Địa chỉ hiện tại: '+esc(p.display||'đã lưu')+'.':''}</p><div class="page-actions"><button type="submit" class="primary">Lưu proxy</button>${button('proxy-test-draft','Kiểm tra trước khi lưu')}${button('editor-close','Hủy')}</div><p id="admProxyTestResult" class="muted" aria-live="polite"></p></form>`);
  }
  async function bulk(action){
    const ids=selected();if(!ids.length){toast('Chọn ít nhất một tài khoản.',true);return;}
    if(action==='bulk-proxy'){editor(`<h2>Gán proxy cho ${ids.length} tài khoản</h2><form data-adm-form="bulk-proxy" data-adm-ids="${esc(JSON.stringify(ids))}"><label>Proxy<select name="proxy_id">${proxyOptions()}</select></label><p class="muted">Các tác vụ mới sử dụng proxy đã gán. Đăng nhập lại qua proxy mới thực hiện trong Muse trên máy.</p><button type="submit" class="primary">Gán proxy</button> ${button('editor-close','Hủy')}</form>`);return;}
    if(action==='bulk-delete'&&!confirm(`Xóa ${ids.length} tài khoản đã chọn khỏi Muse? Phiên cookie của các tài khoản này sẽ bị xóa.\n${ids.slice(0,5).map(aid=>accounts.find(a=>a.id===aid)?.label||aid).join('\n')}`))return;
    let done=0,failed=0;
    for(const aid of ids){try{if(action==='bulk-quota')await api(`/api/admin/accounts/${encodeURIComponent(aid)}/quota`,{method:'POST'});else await api(`/api/admin/accounts/${encodeURIComponent(aid)}`,{method:action==='bulk-delete'?'DELETE':'PATCH',...(action==='bulk-delete'?{}:{body:{enabled:action==='bulk-enable'}})});done++;}catch{failed++;}}
    toast(`Đã xử lý ${done}/${ids.length} tài khoản${failed?`; ${failed} thao tác chưa thành công, hãy tải lại và kiểm tra.`:'.'}`,failed>0);if(live('accounts'))await render('accounts');
  }
  async function refreshAllQuotas(){
    if(quotaRefresh?.running)return;
    const rows=(await api('/api/admin/accounts?limit=500')).accounts;
    quotaRefresh={running:true,done:0,total:rows.length,failed:0,missing:0,stop:false};
    if(live('accounts'))await render('accounts');
    try{for(const a of rows){if(quotaRefresh.stop)break;try{const result=await api(`/api/admin/accounts/${encodeURIComponent(a.id)}/quota`,{method:'POST'});if(!result.found)quotaRefresh.missing++;}catch{quotaRefresh.failed++;}quotaRefresh.done++;const status=$('#admQuotaRefreshStatus');if(status)status.textContent=`Đang cập nhật ${quotaRefresh.done}/${quotaRefresh.total} tài khoản · ${quotaRefresh.failed} lỗi · ${quotaRefresh.missing} chưa đọc được…`;}}
    finally{quotaRefresh.running=false;toast(`Đã đọc ${quotaRefresh.done}/${quotaRefresh.total} tài khoản; ${quotaRefresh.failed} lỗi, ${quotaRefresh.missing} chưa có quota.`,quotaRefresh.failed+quotaRefresh.missing>0);if(live('accounts'))await render('accounts');}
  }
  async function handleClick(b){
    const action=b.dataset.admAction;if(!action)return false;
    const aid=b.dataset.admId,a=accounts.find(item=>item.id===aid),p=proxies.find(item=>item.id===aid);
    b.disabled=true;
    try {
      if(action==='quota-filter'){filter.quota=b.dataset.admQuota;filter.offset=0;await render('accounts');return true;}
      if(action==='filter-reset'){filter={...filter,search:'',state:'all',quota:'all',sort:'remaining',offset:0};await render('accounts');return true;}
      if(action==='quota-refresh-stop'){if(quotaRefresh)quotaRefresh.stop=true;b.textContent='Đang dừng sau tài khoản hiện tại…';return true;}
      if(action==='quota-refresh-all'){await refreshAllQuotas();return true;}
      if(action==='refresh'){await render(currentView);return true;}
      if(action==='editor-close'){$('#admEditor')?.remove();return true;}
      if(action==='select-all'){const inputs=[...document.querySelectorAll('[data-adm-select]')],value=inputs.some(input=>!input.checked);inputs.forEach(input=>input.checked=value);return true;}
      if(action.startsWith('bulk-')){await bulk(action);return true;}
      if(action==='page-prev'||action==='page-next'){filter.offset=Math.max(0,filter.offset+(action==='page-next'?filter.limit:-filter.limit));await render('accounts');return true;}
      if(await loginUI.handleClick(b))return true;
      if(action==='account-cookie-add'){addAccountEditor();return true;}
      if(action==='account-edit'){accountEditor(a);return true;}
      if(action==='account-detail'){const detail=await api(`/api/admin/accounts/${encodeURIComponent(aid)}`);if(!live('accounts'))return true;editor(`<h2>${esc(detail.label||detail.id)}</h2><div class="details-grid"><div><small>Phiên</small><strong>${esc(stateLabels[detail.state])}</strong></div><div><small>Kiểm tra gần nhất</small><strong>${esc(date(detail.checked_at))}</strong></div><div><small>Lần dùng gần nhất</small><strong>${esc(date(detail.last_used))}</strong></div><div><small>Cookie thiết yếu</small><strong>${detail.essential_ok===null?'Chưa xác định':detail.essential_ok?'Đầy đủ':'Cần cập nhật'}</strong></div><div><small>Số lần dùng</small><strong>${detail.use_count??'—'}</strong></div><div><small>Hạn mức</small>${quota(detail.quota,detail.quotaAvailability)}</div></div><p class="muted">${detail.quota?.weekly_reset?'Đặt lại hạn mức: '+esc(detail.quota.weekly_reset):''}</p><div class="page-actions">${button('account-keepalive','Làm mới phiên',aid)}${button('account-cookies-editor','Thay cookie',aid)}${button('editor-close','Đóng')}</div>`);return true;}
      if(action==='account-cookies-editor'){accountEditor(a);return true;}
      if(action==='proxy-add'){proxyEditor();return true;}
      if(action==='proxy-edit'){proxyEditor(p);return true;}
      if(action==='proxy-test-draft'){
        const form=b.closest('form'),data=new FormData(form);if(!data.get('proxy')?.trim()){toast('Nhập địa chỉ proxy cần kiểm tra.',true);return true;}
        const result=await api('/api/admin/proxies/test',{method:'POST',body:{proxy:data.get('proxy'),scheme:data.get('scheme')}});
        const message=result.ok?`Kết nối thành công · ${result.ip||'IP chưa rõ'} · ${result.ms??'—'} ms`:'Không kết nối được. Kiểm tra địa chỉ và thông tin đăng nhập.';if($('#admProxyTestResult'))$('#admProxyTestResult').textContent=message;toast(message,!result.ok);return true;
      }
      if(action==='account-delete'&&!confirm(`Xóa tài khoản “${a?.label||aid}” khỏi Muse? Phiên cookie của tài khoản này sẽ bị xóa.`))return true;
      if(action==='proxy-delete'&&!confirm(`Xóa proxy “${p?.name||aid}” khỏi Muse? Gỡ proxy khỏi các tài khoản đang sử dụng trước khi xóa.`))return true;
      let result;
      if(action==='account-toggle')result=await api(`/api/admin/accounts/${encodeURIComponent(aid)}`,{method:'PATCH',body:{enabled:!a.enabled}});
      if(action==='account-delete')result=await api(`/api/admin/accounts/${encodeURIComponent(aid)}`,{method:'DELETE'});
      if(action==='account-test'||action==='account-quota'||action==='account-keepalive')result=await api(`/api/admin/accounts/${encodeURIComponent(aid)}/${action.slice(8)}`,{method:'POST'});
      if(action==='keepalive-all')result=await api('/api/admin/accounts/keepalive',{method:'POST'});
      if(action==='proxy-delete')result=await api(`/api/admin/proxies/${encodeURIComponent(aid)}`,{method:'DELETE'});
      if(action==='proxy-test')result=await api(`/api/admin/proxies/${encodeURIComponent(aid)}/test`,{method:'POST'});
      if(result){toast(action==='account-quota'?(result.found?'Đã cập nhật hạn mức mới nhất.':'Chưa đọc được hạn mức. Dữ liệu chưa xác định, không coi là đã hết.'):action==='proxy-test'?(result.ok?`Proxy kết nối được · ${result.ip||'—'} · ${result.ms??'—'} ms`:'Proxy chưa kết nối được.'):result.ok===false?'Phiên chưa hợp lệ. Kiểm tra đăng nhập trong Muse.':result.status==='busy'?'Muse đang làm mới phiên.':'Đã hoàn tất thao tác.',result.ok===false||action==='account-quota'&&!result.found);if(live(currentView))await render(currentView);}
    } finally {b.disabled=false;}
    return true;
  }
  async function handleSubmit(form){
    if(await loginUI.handleSubmit(form))return true;
    const type=form.dataset.admForm;if(!type)return false;
    const data=new FormData(form),aid=form.dataset.admId,submit=form.querySelector('[type="submit"]');if(submit)submit.disabled=true;
    try {
      if(type==='filter'){filter={...filter,search:String(data.get('search')||''),state:data.get('state'),quota:data.get('quota'),sort:data.get('sort'),offset:0};await render('accounts');return true;}
      if(type==='account-add'){
        let credential=String(data.get('credential')||'').trim();const file=data.get('file');if(!credential&&file?.size){if(file.size>1000000)throw Error('File cookie vượt quá 1 MB.');credential=(await file.text()).trim();}
        if(!credential)throw Error('Dán cookie hoặc chọn file TXT.');
        const body={label:String(data.get('label')||''),proxy_id:String(data.get('proxy_id')||''),[data.get('mode')==='batch'?'batch':'cookie_header']:credential};
        form.querySelector('[name="credential"]').value='';form.querySelector('[name="file"]').value='';
        const result=await api('/api/admin/accounts',{method:'POST',body});toast(result.warning?'Muse đã nhận dữ liệu nhưng có cảnh báo. Kiểm tra danh sách tài khoản.':`Đã nhập tài khoản${result.count!==null?' · '+result.count:''}.`);if(live('accounts'))await render('accounts');return true;
      }
      if(type==='account-edit')await api(`/api/admin/accounts/${encodeURIComponent(aid)}`,{method:'PATCH',body:{label:String(data.get('label')||''),enabled:data.get('enabled')==='true',proxy_id:String(data.get('proxy_id')||'')}});
      if(type==='account-cookies'){const cookie_header=String(data.get('cookie_header')||'');form.querySelector('[name="cookie_header"]').value='';await api(`/api/admin/accounts/${encodeURIComponent(aid)}/cookies`,{method:'POST',body:{cookie_header}});}
      if(type==='proxy-save'){
        const body={name:String(data.get('name')||''),scheme:data.get('scheme'),proxy:String(data.get('proxy')||'')};form.querySelector('[name="proxy"]').value='';
        await api(`/api/admin/proxies${aid?'/'+encodeURIComponent(aid):''}`,{method:aid?'PATCH':'POST',body});
      }
      if(type==='bulk-proxy'){
        const ids=JSON.parse(form.dataset.admIds);let done=0;
        for(const id of ids)try{await api(`/api/admin/accounts/${encodeURIComponent(id)}`,{method:'PATCH',body:{proxy_id:String(data.get('proxy_id')||'')}});done++;}catch{}
        toast(`Đã gán proxy cho ${done}/${ids.length} tài khoản.`,done!==ids.length);if(live('accounts'))await render('accounts');return true;
      }
      if(type==='settings')await api('/api/settings',{method:'PUT',body:{defaults:{size:data.get('size'),duration:Number(data.get('duration')),concurrency:Number(data.get('concurrency'))},library:{sort:data.get('sort'),kind:data.get('kind'),pageSize:Number(data.get('pageSize'))},queue:{maxParallel:Number(data.get('maxParallel')),taskTimeoutSeconds:Number(data.get('taskTimeoutSeconds'))}}});
      toast(type==='settings'?'Đã lưu cài đặt web.':'Đã lưu thay đổi.');if(live(currentView))await render(currentView);
    } finally {if(submit)submit.disabled=false;}
    return true;
  }
  return {render,handleClick,handleSubmit};
}
