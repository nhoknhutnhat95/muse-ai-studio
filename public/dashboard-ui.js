import {projectSummary} from './project-panels.js';

// Small local SVG set: consistent line icons, no font or CDN dependency.
const paths = {
  dashboard:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  script:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5"/>',
  affiliate:'<path d="m12 3 9 9-9 9-9-9zM8 12h8M12 8v8"/>',
  video:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/>',
  character:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m4 18 5-5 4 4 4-7 4 6"/>',
  production:'<path d="M4 9v6M8 5v14M12 3v18M16 7v10M20 10v4"/>',
  queue:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  library:'<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  accounts:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  proxies:'<path d="M3 7h17l-4-4M21 17H4l4 4M20 7l-4 4M4 17l4-4"/>',
  settings:'<path d="M4 7h16M4 17h16"/><rect x="7" y="4" width="4" height="6" rx="1"/><rect x="14" y="14" width="4" height="6" rx="1"/>',
  connection:'<path d="m8 13 6-6M7 9 5 11a5 5 0 0 0 7 7l2-2M10 8l2-2a5 5 0 0 1 7 7l-2 2"/>',
  panel:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  terminal:'<path d="m5 6 5 6-5 6M13 18h6"/>',
  moon:'<path d="M20.5 14a8.5 8.5 0 0 1-10.5-10.5A9 9 0 1 0 20.5 14Z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1"/>',
  refresh:'<path d="M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  alert:'<path d="m12 3 10 18H2zM12 9v4M12 17h.01"/>',
};
export const icon = name => `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.script}</svg>`;

export function createStudioChrome() {
  const $ = s => document.querySelector(s);
  document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
  const root=document.documentElement, tools=$('#toolSidebar'), projects=$('#projectSidebar'), shell=$('.shell');
  const toggleTools=$('#toggleNavigation'), toggleProjects=$('#toggleProjects'), theme=$('#toggleTheme');
  const backdrop=$('#projectsBackdrop'), mobile=matchMedia('(max-width:767px)'), narrow=matchMedia('(max-width:1179px)');
  let drawer=null;
  const save=(key,value)=>{try{localStorage.setItem(key,value);}catch{}};
  function syncTheme() {
    const dark=root.dataset.theme==='dark';
    theme.innerHTML=icon(dark?'sun':'moon');
    theme.setAttribute('aria-label',dark?'Chuyển sang giao diện sáng':'Chuyển sang giao diện tối');
    theme.title=theme.getAttribute('aria-label');
    $('meta[name="theme-color"]').content=dark?'#101010':'#ffffff';
  }
  theme.addEventListener('click',()=>{root.dataset.theme=root.dataset.theme==='dark'?'light':'dark';save('muse-theme',root.dataset.theme);syncTheme();});
  function sync() {
    if(drawer==='tools'&&!mobile.matches||drawer==='projects'&&!narrow.matches)drawer=null;
    const toolsOpen=drawer==='tools', projectsOpen=drawer==='projects';
    document.body.classList.toggle('tools-open',toolsOpen);
    document.body.classList.toggle('projects-open',projectsOpen);
    document.body.classList.toggle('drawer-open',!!drawer);
    backdrop.hidden=!drawer;
    backdrop.setAttribute('aria-label',toolsOpen?'Đóng điều hướng':'Đóng danh sách dự án');
    shell.inert=!!drawer;
    $('.skip-link').inert=!!drawer;
    tools.inert=projectsOpen||(mobile.matches&&!toolsOpen);
    projects.inert=toolsOpen||(narrow.matches&&!projectsOpen);
    for(const [panel,isDrawer,isOpen] of [[tools,mobile.matches,toolsOpen],[projects,narrow.matches,projectsOpen]]) {
      panel.setAttribute('role',isDrawer?'dialog':'complementary');
      if(isOpen)panel.setAttribute('aria-modal','true');else panel.removeAttribute('aria-modal');
      if(isDrawer&&!isOpen)panel.setAttribute('aria-hidden','true');else panel.removeAttribute('aria-hidden');
    }
    const expanded=mobile.matches?toolsOpen:!root.classList.contains('nav-collapsed');
    toggleTools.setAttribute('aria-expanded',String(expanded));
    toggleTools.setAttribute('aria-label',expanded?'Thu gọn điều hướng':'Mở điều hướng');
    toggleTools.title=toggleTools.getAttribute('aria-label');
    toggleProjects.setAttribute('aria-expanded',String(!narrow.matches||projectsOpen));
  }
  function dismiss(restore=true) {
    const was=drawer;drawer=null;sync();
    if(restore&&was)(was==='tools'?toggleTools:toggleProjects).focus();
  }
  function focusDrawer() { requestAnimationFrame(()=>{if(drawer==='tools')$('#closeNavigation').focus();if(drawer==='projects')$('#projectSearch').focus();}); }
  toggleTools.addEventListener('click',()=>{
    if(mobile.matches){drawer='tools';sync();focusDrawer();}
    else {root.classList.toggle('nav-collapsed');save('muse-nav-collapsed',String(root.classList.contains('nav-collapsed')));sync();}
  });
  toggleProjects.addEventListener('click',()=>{if(!narrow.matches)return;drawer='projects';sync();focusDrawer();});
  $('#closeNavigation').addEventListener('click',()=>dismiss());
  $('#closeProjects').addEventListener('click',()=>dismiss());
  backdrop.addEventListener('click',()=>dismiss());
  for(const panel of [tools,projects])panel.addEventListener('click',e=>{if(e.target.closest('[data-view],[data-project],[data-import],#newProject')&&drawer)dismiss();});
  document.addEventListener('keydown',e=>{
    if(!drawer||document.querySelector('dialog[open]'))return;
    if(e.key==='Escape'){e.preventDefault();dismiss();return;}
    if(e.key!=='Tab')return;
    const panel=drawer==='tools'?tools:projects;
    const items=[...panel.querySelectorAll('button:not(:disabled),input:not(:disabled),a[href]')].filter(el=>el.getClientRects().length);
    const first=items[0],last=items.at(-1);
    if(!panel.contains(document.activeElement)){e.preventDefault();(e.shiftKey?last:first)?.focus();}
    else if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
  });
  function resize(){const focused=document.activeElement;drawer=null;sync();if(focused.closest?.('[inert]'))toggleTools.focus();}
  mobile.addEventListener('change',resize);narrow.addEventListener('change',resize);
  syncTheme();sync();
}

export function dashboardStats(projects) {
  let scenes=0,done=0,active=0,attention=0;
  for(const p of projects){
    scenes+=p.scenes.length;
    const jobs=p.jobs||[];
    done+=jobs.filter(j=>j.state==='completed').length;
    active+=jobs.filter(j=>['queued','submitting','running','downloading'].includes(j.state)).length;
    // A completed reference awaiting review and a blocked job each count once.
    attention+=jobs.filter(j=>['failed','unknown','blocked'].includes(j.state)||(j.state==='completed'&&p.scenes.find(s=>s.id===j.scene_id)?.reviewRequired&&j.review?.state!=='approved')).length;
  }
  return {projects:projects.length,scenes,done,active,attention};
}

export function dashboardMarkup({projects,backend,esc}) {
  const stats=dashboardStats(projects),num=n=>n.toLocaleString('vi-VN');
  const recent=[...projects].sort((a,b)=>String(b.updated||b.created).localeCompare(String(a.updated||a.created))).slice(0,5);
  const card=(name,value,note,glyph)=>`<article class="metric-card"><div class="metric-label">${name}${icon(glyph)}</div><strong>${num(value)}</strong><small>${note}</small></article>`;
  const connected=backend?.connected;
  return `<div class="page-heading dashboard-heading"><div><div class="eyebrow">KHÔNG GIAN SÁNG TẠO</div><h1>Tổng quan studio</h1><p>Kịch bản, tiến độ và thành phẩm — trong cùng một không gian.</p></div><button class="primary" data-import>${icon('plus')} Nhập kịch bản</button></div>
    <div class="dashboard-metrics">
      ${card('Dự án',stats.projects,`${num(stats.scenes)} cảnh trong studio`,'library')}
      ${card('Cảnh đã tạo',stats.done,'Đã tải kết quả về máy','check')}
      ${card('Trong hàng đợi',stats.active,'Đang chờ hoặc đang xử lý','queue')}
      ${card('Cần xem lại',stats.attention,'Chờ duyệt ảnh hoặc có lỗi','alert')}
    </div>
    <div class="dashboard-split">
      <section class="dashboard-panel progress-panel"><div class="panel-heading"><div><h2>Tiến độ sản xuất</h2><p>Các dự án cập nhật gần đây</p></div><button class="ghost small" data-view="queue">Hàng đợi ${icon('arrow')}</button></div>
      ${recent.length?`<div class="project-progress-list">${recent.map(p=>{const s=projectSummary(p);return `<button class="project-progress-row" data-project="${esc(p.id)}"><span class="progress-row-title">${esc(p.title)}</span><span class="progress-row-count">${s.done}<span> / ${p.scenes.length}</span></span><progress value="${s.done}" max="${Math.max(1,p.scenes.length)}" aria-label="${esc(p.title)}: ${s.done}/${p.scenes.length} cảnh đã tạo"></progress></button>`;}).join('')}</div>`:'<div class="dashboard-empty">Chưa có dự án.<br>Nhập kịch bản đầu tiên để bắt đầu.</div>'}
      <p class="panel-footnote">Tiến độ tạo cảnh; chất lượng nội dung cần được xem duyệt riêng.</p></section>
      <section class="dashboard-panel quick-panel"><div class="panel-heading"><div><h2>Bắt đầu sáng tạo</h2><p>Chọn công đoạn tiếp theo</p></div>${icon('plus')}</div><div class="quick-links">${[['script','Kịch bản','Biên tập prompt và lời đọc'],['video','Xưởng video','Tạo clip từ chữ hoặc ảnh'],['production','Lồng tiếng & dựng phim','Hoàn thiện video của bạn']].map(([v,title,note])=>`<button data-view="${v}" class="quick-link"><span class="quick-icon">${icon(v)}</span><span><b>${title}</b><small>${note}</small></span>${icon('arrow')}</button>`).join('')}</div><div class="dashboard-connection"><span class="status-dot ${connected?'':'is-offline'}"></span><div><b>${connected?'Muse đã kết nối':'Muse chưa kết nối'}</b><small>${connected?'Sẵn sàng cho công đoạn tiếp theo':'Kiểm tra kết nối trước khi tạo media'}</small></div><button class="icon-button" data-view="connection" aria-label="Xem kết nối Muse">${icon('arrow')}</button></div></section>
    </div>
    <section class="dashboard-panel recent-panel"><div class="panel-heading"><div><h2>Dự án gần đây <span class="count-badge">${projects.length}</span></h2><p>Mở dự án để xem storyboard và thành phẩm.</p></div><button class="ghost small" data-view="library">${icon('library')} Thư viện</button></div>
    ${recent.length?`<div class="table-wrap"><table class="recent-table"><thead><tr><th>Dự án</th><th>Trạng thái</th><th>Cảnh</th><th>Cập nhật</th><th><span class="sr-only">Thao tác</span></th></tr></thead><tbody>${recent.map(p=>{const s=projectSummary(p);return `<tr><td><button class="project-table-link" data-project="${esc(p.id)}">${icon('script')}<span>${esc(p.title)}</span></button></td><td><span class="tag ${s.state}">${esc(s.label)}</span></td><td class="numeric">${s.done}/${p.scenes.length}</td><td class="date-cell">${new Date(p.updated||p.created).toLocaleDateString('vi-VN')}</td><td><button class="icon-button" data-project="${esc(p.id)}" aria-label="Mở ${esc(p.title)}">${icon('arrow')}</button></td></tr>`;}).join('')}</tbody></table></div>`:'<div class="dashboard-empty">Kịch bản được nhập từ web hoặc CLI sẽ xuất hiện tại đây.</div>'}
    <div class="panel-footnote">Đồng bộ tự động từ web và CLI <span>Toàn bộ dữ liệu lưu trên máy của bạn</span></div></section>`;
}
