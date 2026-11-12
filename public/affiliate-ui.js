export function createAffiliateUI({ api, esc, heading, toast, openProject }) {
  let options, tab = 'single', results = [], batchErrors = [], folderWarnings = [];
  let savedSingle = {}, savedBatch = {}, manifestText = JSON.stringify({ products: [] }, null, 2);
  const uploaded = new WeakMap();
  const refs = {};
  const referenceNames = {};
  const preparationJobs = new Map(), preparedReferences = new Map();
  let activePreparation = null;
  const $ = s => document.querySelector(s);
  const select = (items, selected) => items.map(item => `<option value="${esc(item.id ?? item.value)}" ${String(item.id ?? item.value) === String(selected) ? 'selected' : ''}>${esc(item.label)}</option>`).join('');
  const field = (label, name, value = '', extra = '') => `<label>${esc(label)}<input name="${name}" value="${esc(value)}" ${extra}></label>`;
  const textField = (label, name, value = '', rows = 3) => `<label>${esc(label)}<textarea name="${name}" rows="${rows}">${esc(value)}</textarea></label>`;
  const defaults = () => ({ ...options.defaults, ...savedSingle });

  function presetHTML() {
    const presets = options.presetKols || [];
    if (!presets.length) return '';
    return `<details><summary>Chọn KOL mẫu có sẵn trên máy</summary><div class="library-grid">${presets.map(preset => `<article class="media-card"><div class="media-frame"><img src="${esc(preset.url)}" alt="${esc(preset.name)}" loading="lazy"></div><div class="media-details"><strong>${esc(preset.name)}</strong><button type="button" class="ghost small" data-aff="preset" data-aff-preset="${esc(preset.id)}">Dùng KOL này</button></div></article>`).join('')}</div></details>`;
  }
  function preparationHTML(value, prefix) {
    return `<label class="check"><input type="checkbox" name="prepareReferences" ${value.prepareReferences !== false ? 'checked' : ''}>Chuẩn hóa ảnh như app gốc: khung dọc, nền mờ, ghép ảnh chính + chi tiết</label><p class="muted small">Xử lý bằng FFmpeg trên máy; giữ toàn bộ ảnh, không cắt tự động khuôn mặt hoặc sản phẩm.</p><button type="button" class="ghost small" id="${prefix}-stop" data-aff="stop-preparation" hidden>Dừng chuẩn hóa ảnh</button>`;
  }

  function controls(value, prefix) {
    return `<div class="form-row"><label>Chế độ viết lời<select name="mode" id="${prefix}-mode">${select(options.modes, value.mode)}</select></label><label>Mẫu nội dung<select name="template">${select(options.templates, value.template)}</select></label><label>Độ dài<select name="sceneCount">${select(options.sceneCounts, value.sceneCount)}</select></label></div><div class="form-row"><label>Giọng người giới thiệu<select name="voicePersona">${select(options.voices, value.voicePersona)}</select></label><label>Duyệt ảnh<select name="reviewMode">${select(options.reviewModes, value.reviewMode)}</select></label><label>Tạo lại ảnh bị cờ<select name="autoRepairAttempts">${select([{value:0,label:'Thủ công'},{value:1,label:'Tự sửa tối đa 1 lần'},{value:2,label:'Tự sửa tối đa 2 lần'}], value.autoRepairAttempts ?? 0)}</select></label></div><p class="muted small">Tự sửa áp dụng khi chọn duyệt ảnh có cờ; có thể dùng thêm lượt tạo ảnh khi chạy dự án.</p>`;
  }
  function singleHTML() {
    const value = defaults();
    return `<form id="aff-single-form" class="connection-card"><div class="eyebrow">01 / SẢN PHẨM VÀ NGƯỜI GIỚI THIỆU</div><div class="form-row">${field('Tên sản phẩm', 'name', value.name, 'required maxlength="200"')}<label>Ngành hàng<select name="category"><option value="">Tự nhận diện từ tên sản phẩm</option>${select(options.categories, value.category)}</select></label></div>${textField('Điểm nổi bật đã xác minh', 'usp', value.usp)}${textField('Mô tả sản phẩm', 'description', value.description)}<div class="form-row">${field('Ưu đãi có thật (nếu có)', 'offer', value.offer)}${field('Lời kết / CTA (tùy chọn)', 'cta', value.cta)}</div>${textField('Mô tả KOL / người giới thiệu', 'characterDescription', value.characterDescription, 2)}${presetHTML()}<div class="guide-grid">${[['product', 'Ảnh sản phẩm chính *'], ['kol', 'Ảnh KOL / người giới thiệu'], ['detail', 'Ảnh chi tiết sản phẩm']].map(([key, label]) => `<label>${label}<input id="aff-file-${key}" type="file" accept="image/png,image/jpeg,image/webp"><small class="muted" id="aff-ref-${key}">${refs[key] ? esc(referenceNames[key] || 'Đã tải ảnh vào kho local') : 'PNG, JPEG hoặc WebP · tối đa 12 MB'}</small></label>`).join('')}</div>${preparationHTML(value, 'aff-single')}<div class="toolbar"><span class="section-label">02 / KỊCH BẢN VÀ STORYBOARD</span><span class="tag">9:16</span></div>${controls(value, 'aff-single')}${textField('Lời thoại có sẵn · mỗi dòng một câu, đúng 4 hoặc 5 câu', 'manualScript', value.manualScript, 6)}<p class="muted small">Chế độ lời có sẵn giữ nguyên từng câu. Chế độ mẫu dùng thông tin bạn cung cấp. Chế độ AI gửi thông tin sản phẩm đến Muse Chat để viết lời; bạn duyệt lại trước khi tạo media.</p><div class="inline-error" id="aff-single-error"></div><div class="dialog-footer"><span class="muted" id="aff-single-status">Lập storyboard chỉ chuẩn bị bản nháp.</span><button type="submit" class="primary" id="aff-single-submit">${value.mode === 'ai' ? 'Gọi Muse Chat · Lập storyboard' : 'Lập storyboard'}</button></div></form>`;
  }
  function batchHTML() {
    const value = { ...options.defaults, ...savedBatch };
    return `<form id="aff-batch-form" class="connection-card"><div class="eyebrow">BATCH / MỖI SẢN PHẨM MỘT DỰ ÁN</div><h2>Lập hàng loạt từ thư mục hoặc JSON</h2><p class="muted">Mỗi thư mục con chứa ảnh sản phẩm chính, ảnh chi tiết tùy chọn và info.txt. Đặt tên ảnh main/product, detail và kol để nhận diện rõ vai trò.</p>${controls(value, 'aff-batch')}${presetHTML()}<div class="form-row"><label>Ảnh KOL mặc định cho batch<input id="aff-batch-kol" type="file" accept="image/png,image/jpeg,image/webp"><small id="aff-batch-ref-kol">${esc(referenceNames.kol || '')}</small></label><label>Thư mục chứa các sản phẩm<input id="aff-folder" type="file" webkitdirectory multiple></label></div><button type="button" class="ghost" data-aff="folder">Đọc thư mục và tải ảnh tham chiếu</button><p class="muted small">info.txt hỗ trợ name, usp, prod_desc, char_desc, template, persona, scene_count và review_mode. Bước này chỉ tải ảnh vào kho local.</p><div id="aff-folder-status" class="muted small">${folderWarnings.map(esc).join('<br>')}</div>${preparationHTML(value, 'aff-batch')}<label>Manifest JSON · có thể chỉnh trước khi lập storyboard<textarea id="aff-manifest" class="code-input" rows="15" spellcheck="false">${esc(manifestText)}</textarea></label><p class="muted small">Cấu hình defaults và từng sản phẩm trong JSON được ưu tiên hơn lựa chọn chung ở trên. Ảnh tham chiếu dùng asset ID; đường dẫn máy tính dùng qua CLI.</p><div class="inline-error" id="aff-batch-error"></div><div class="dialog-footer"><span class="muted" id="aff-batch-status">Mỗi sản phẩm trả về một bản nháp riêng, chưa tạo ảnh hay video.</span><button type="submit" class="primary" id="aff-batch-submit">Lập batch · Muse Chat nếu chọn AI</button></div></form>`;
  }
  async function render() {
    options ||= await api('/api/affiliate/options');
    $('#main').innerHTML = `${heading('Affiliate Studio', 'Từ thông tin sản phẩm đến lời thoại, ảnh khung và clip có thể duyệt từng bước.')}<div class="toolbar"><div class="filter-group"><button class="ghost small ${tab === 'single' ? 'active' : ''}" data-aff="tab" data-aff-tab="single">Một sản phẩm</button><button class="ghost small ${tab === 'batch' ? 'active' : ''}" data-aff="tab" data-aff-tab="batch">Batch sản phẩm</button></div><span class="tag">DRAFT → DUYỆT ẢNH → VIDEO</span></div>${tab === 'single' ? singleHTML() : batchHTML()}<section id="aff-results"></section>`;
    const form = $('#aff-single-form') || $('#aff-batch-form');
    form.addEventListener('input', capture);
    form.addEventListener('change', () => {
      capture();
      if ($('#aff-single-submit')) $('#aff-single-submit').textContent = form.elements.mode.value === 'ai' ? 'Gọi Muse Chat · Lập storyboard' : 'Lập storyboard';
    });
    showResults();
  }
  function capture() {
    const single = $('#aff-single-form'), batch = $('#aff-batch-form');
    if (single) savedSingle = { ...Object.fromEntries(new FormData(single)), prepareReferences: single.elements.prepareReferences.checked };
    if (batch) { savedBatch = { ...Object.fromEntries(new FormData(batch)), prepareReferences: batch.elements.prepareReferences.checked }; manifestText = $('#aff-manifest').value; }
  }
  function inputFrom(form) {
    const v = Object.fromEntries(new FormData(form));
    return { mode: v.mode, template: v.template, sceneCount: Number(v.sceneCount), voicePersona: v.voicePersona, reviewMode: v.reviewMode, autoRepairAttempts: Number(v.autoRepairAttempts || 0), characterDescription: v.characterDescription || '', cta: v.cta || '' };
  }
  async function upload(file) {
    if (uploaded.has(file)) return uploaded.get(file);
    if (!/\.(png|jpe?g|webp)$/i.test(file.name) || file.size > 12 * 1024 * 1024) throw Error('Ảnh phải là PNG, JPEG hoặc WebP, tối đa 12 MB.');
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(Error('Không đọc được ảnh đã chọn.'));
      reader.readAsDataURL(file);
    });
    const asset = await api('/api/assets', { method: 'POST', body: { data, name: file.name } });
    uploaded.set(file, asset.reference);
    return asset.reference;
  }
  function busy(form, value) { form.querySelectorAll('button,input,select,textarea').forEach(element => element.disabled = value); }
  async function prepareReferences(references, form, status) {
    const key = JSON.stringify(['kol', 'product', 'detail'].map(role => references[role] || null));
    if (preparedReferences.has(key)) return preparedReferences.get(key);
    let job = preparationJobs.has(key) ? await api(`/api/media/jobs/${preparationJobs.get(key)}`) : await api('/api/media/references', { method: 'POST', body: { kolAsset: references.kol, productAsset: references.product, detailAsset: references.detail } });
    preparationJobs.set(key, job.id);
    const pending = activePreparation = { id: job.id, stopped: false };
    const stop = form.querySelector('[data-aff="stop-preparation"]');
    stop.hidden = false; stop.disabled = false;
    const deadline = Date.now() + 180000;
    try {
      while (true) {
        status.textContent = `Chuẩn hóa ảnh local · ${job.state} · tác vụ ${job.id}`;
        if (pending.stopped) throw Error(`Đã dừng chuẩn hóa ảnh. Tác vụ local: ${job.id}. Chưa gọi Muse Chat hay tạo media.`);
        if (job.state === 'completed') {
          if (!job.result?.references?.product) throw Error(`Tác vụ ${job.id} thiếu ảnh sản phẩm đã xử lý.`);
          preparedReferences.set(key, job.result);
          return job.result;
        }
        if (job.state === 'failed' || job.state === 'cancelled') {
          preparationJobs.delete(key);
          throw Error(`Chuẩn hóa ảnh ${job.state === 'cancelled' ? 'đã hủy' : 'thất bại'} (${job.id}). ${job.error || 'Xem hàng đợi media local.'}`);
        }
        if (job.state === 'interrupted') throw Error(`Tác vụ chuẩn hóa ${job.id} bị gián đoạn khi máy chủ dừng. Thử lại thủ công trong hàng đợi media local rồi bấm lập storyboard để theo dõi tiếp.`);
        if (Date.now() >= deadline) throw Error(`Dừng chờ sau 3 phút. Tác vụ local ${job.id} vẫn được lưu; kiểm tra hàng đợi media. Bấm lập lại sẽ theo dõi tác vụ này, không tự gửi lại.`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        job = await api(`/api/media/jobs/${job.id}`);
      }
    } finally { stop.hidden = true; if (activePreparation === pending) activePreparation = null; }
  }
  async function singlePlan(form) {
    capture();
    const fieldInForm = selector => form.querySelector(selector);
    const v = Object.fromEntries(new FormData(form));
    const body = { ...inputFrom(form), product: { name: v.name, usp: v.usp, description: v.description, category: v.category, offer: v.offer }, references: { ...refs }, ...(v.mode === 'manual' ? { manualScript: v.manualScript } : {}) };
    const shouldPrepare = form.elements.prepareReferences.checked;
    busy(form, true);
    fieldInForm('#aff-single-error').textContent = '';
    try {
      for (const key of ['product', 'kol', 'detail']) {
        const file = fieldInForm(`#aff-file-${key}`).files[0];
        if (file) {
          fieldInForm('#aff-single-status').textContent = `Đang lưu ảnh ${file.name}…`;
          refs[key] = body.references[key] = await upload(file);
          referenceNames[key] = file.name;
          fieldInForm(`#aff-ref-${key}`).textContent = file.name;
        }
      }
      if (shouldPrepare && body.references.product) {
        const prepared = await prepareReferences(body.references, form, fieldInForm('#aff-single-status'));
        body.sourceReferences = prepared.sourceReferences;
        body.references = prepared.references;
      }
      fieldInForm('#aff-single-status').textContent = body.mode === 'ai' ? 'Muse Chat đang viết kịch bản…' : 'Đang lập storyboard…';
      const result = await api('/api/affiliate/plan', { method: 'POST', body });
      results = [result]; batchErrors = []; showResults();
      $('#aff-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast('Đã lập storyboard. Chưa tạo media hay gửi hàng đợi.');
    } catch (error) { fieldInForm('#aff-single-error').textContent = error.message; }
    finally { busy(form, false); fieldInForm('#aff-single-status').textContent = 'Duyệt storyboard và lưu bản nháp ở bên dưới.'; }
  }
  async function batchPlan(form) {
    capture();
    const fieldInForm = selector => form.querySelector(selector);
    fieldInForm('#aff-batch-error').textContent = '';
    let body;
    try {
      body = JSON.parse(fieldInForm('#aff-manifest').value);
      if (!body || Array.isArray(body) || typeof body !== 'object' || !Array.isArray(body.products)) throw Error('Manifest cần object có products là mảng.');
      const shared = inputFrom(form);
      const shouldPrepare = form.elements.prepareReferences.checked;
      const kol = fieldInForm('#aff-batch-kol').files[0];
      busy(form, true);
      if (kol) shared.references = { kol: await upload(kol) };
      else if (refs.kol) shared.references = { kol: refs.kol };
      body.defaults = { ...shared, ...(body.defaults || {}), references: { ...(shared.references || {}), ...(body.defaults?.references || {}) } };
      if (shouldPrepare) {
        for (const product of body.products) {
          if (!product || typeof product !== 'object') continue;
          const references = { ...(body.defaults.references || {}), ...(product.references || {}) };
          if (!/^asset:[a-f0-9]{32}$/.test(references.product || '')) continue;
          const prepared = await prepareReferences(references, form, fieldInForm('#aff-batch-status'));
          product.sourceReferences = prepared.sourceReferences;
          product.references = { kol: prepared.references.kol || null, product: prepared.references.product, detail: null };
        }
      }
      const aiCount = body.products.filter(p => (p?.mode ?? body.defaults.mode) === 'ai' || p?.template === 'auto_ai').length;
      fieldInForm('#aff-batch-status').textContent = aiCount ? `Đang lập batch; ${aiCount} sản phẩm gọi Muse Chat. Các cuộc gọi thực hiện lần lượt…` : 'Đang lập các bản nháp…';
      const result = await api('/api/affiliate/batch', { method: 'POST', body });
      results = result.plans; batchErrors = result.errors; showResults();
      $('#aff-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast(`Đã lập ${results.length} storyboard; ${batchErrors.length} sản phẩm cần sửa.`);
    } catch (error) { fieldInForm('#aff-batch-error').textContent = error.message; }
    finally { busy(form, false); fieldInForm('#aff-batch-status').textContent = 'Duyệt và lưu từng dự án ở bên dưới.'; }
  }
  async function folderManifest() {
    const form = $('#aff-batch-form');
    const fieldInForm = selector => form.querySelector(selector);
    const files = [...fieldInForm('#aff-folder').files];
    if (!files.length) throw Error('Chọn thư mục chứa các sản phẩm trước.');
    const grouped = new Map();
    for (const file of files) {
      const parts = file.webkitRelativePath.split('/');
      if (parts.length !== 3) continue;
      if (!grouped.has(parts[1])) grouped.set(parts[1], []);
      grouped.get(parts[1]).push(file);
    }
    if (grouped.size < 1 || grouped.size > 100) throw Error('Cần từ 1 đến 100 thư mục sản phẩm, mỗi thư mục chứa ảnh trực tiếp bên trong.');
    busy(form, true); folderWarnings = [];
    try {
      const common = { ...options.defaults, ...savedBatch, sceneCount: Number(savedBatch.sceneCount || options.defaults.sceneCount), autoRepairAttempts: Number(savedBatch.autoRepairAttempts || 0) }, kolFile = fieldInForm('#aff-batch-kol').files[0];
      if (kolFile) common.references = { kol: await upload(kolFile) };
      else if (refs.kol) common.references = { kol: refs.kol };
      const products = [];
      for (const [key, group] of grouped) {
        fieldInForm('#aff-folder-status').textContent = `Đang đọc và tải ảnh: ${key}…`;
        try {
          const images = group.filter(f => /\.(png|jpe?g|webp)$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
          const kol = images.find(f => /(?:^|[ _-])(kol|presenter|character)(?:[ _.-]|$)/i.test(f.name));
          const photos = images.filter(f => f !== kol);
          const main = photos.find(f => /(?:^|[ _-])(main|product|front|chinh)(?:[ _.-]|$)/i.test(f.name)) || photos[0];
          const detail = photos.find(f => f !== main && /(?:detail|chitiet|chi[_ -]tiet|back)/i.test(f.name)) || photos.find(f => f !== main);
          if (!main) throw Error('không có ảnh sản phẩm');
          const infoFile = group.find(f => f.name.toLowerCase() === 'info.txt');
          if (infoFile && infoFile.size > 65536) throw Error('info.txt vượt 64 KiB');
          const info = infoFile ? await api('/api/affiliate/info', { method: 'POST', body: { text: await infoFile.text() } }) : { data: {}, warnings: [] };
          const { name, usp, description, category, offer, usage, kol: kolLabel, ...settings } = info.data;
          const references = { product: await upload(main) };
          if (detail) references.detail = await upload(detail);
          if (kol) references.kol = await upload(kol);
          products.push({ key, product: { name: name || key, usp, description, category, offer, usage }, ...settings, references });
          folderWarnings.push(...(info.warnings || []).map(message => `${key}: ${message}`));
          if (kolLabel) folderWarnings.push(`${key}: kol trong info.txt là nhãn; dùng ảnh KOL đã chọn.`);
        } catch (error) { folderWarnings.push(`${key}: ${error.message}`); }
      }
      manifestText = JSON.stringify({ defaults: common, products }, null, 2);
      fieldInForm('#aff-manifest').value = manifestText;
      fieldInForm('#aff-folder-status').textContent = `Đã chuẩn bị ${products.length}/${grouped.size} sản phẩm. ${folderWarnings.join(' ')}`;
      toast('Đã chuẩn bị manifest và ảnh local. Bấm Lập batch để xem storyboard.');
    } finally { busy(form, false); }
  }
  function showResults() {
    const host = $('#aff-results');
    if (!host) return;
    host.innerHTML = `${batchErrors.length ? `<div class="notice">${batchErrors.map(e => `Sản phẩm ${Number(e.index) + 1}: ${esc(e.error)}`).join('<br>')}</div>` : ''}${results.length ? `<div class="toolbar"><span class="section-label">STORYBOARD / ${results.length} BẢN NHÁP</span><span class="muted small">Lưu bản nháp chưa tạo ảnh hay video</span></div>` : ''}${results.map((result, index) => {
      const affiliate = result.document.metadata.affiliate;
      return `<article class="connection-card" id="aff-plan-${index}"><div class="page-heading"><div><h2>${esc(result.document.title)}</h2><p>${affiliate.sceneCount} câu · ${affiliate.videoSceneIds.length} clip · khoảng ${affiliate.estimatedDuration}s · ${esc(affiliate.voicePersona)}</p></div><span class="tag">${esc(affiliate.mode.toUpperCase())}</span></div>${(result.warnings || []).map(warning => `<div class="notice">${esc(warning)}</div>`).join('')}<div class="guide-grid">${(result.storyboard || []).map(clip => `<div class="guide-card"><span>CLIP ${clip.index} · ${clip.duration}s</span><h3>${esc(clip.segments.join(' + '))}</h3><p>${esc(clip.visual)}</p></div>`).join('')}</div><div class="toolbar"><span class="section-label">DUYỆT LỜI THOẠI</span><button class="ghost small" data-aff="apply-lines" data-aff-index="${index}">Áp dụng lời sửa vào prompt</button></div>${affiliate.lines.map((line, i) => `<label>${esc(line.segment)}<textarea rows="2" data-aff-line="${i}" data-aff-plan="${index}">${esc(result.editedLines?.[i] ?? line.voice_text)}</textarea></label>`).join('')}<p class="muted small" id="aff-dirty-${index}" ${result.dirty ? '' : 'hidden'}>Lời thoại đã thay đổi. Bấm “Áp dụng lời sửa vào prompt” trước khi lưu.</p><details><summary>JSON bản nháp · chỉnh prompt, thời lượng hoặc xuất cho Codex</summary><textarea class="code-input" id="aff-json-${index}" rows="16" spellcheck="false">${esc(result.rawDocument ?? JSON.stringify(result.document, null, 2))}</textarea></details><div class="inline-error" id="aff-error-${index}"></div><div class="dialog-footer"><button class="ghost" data-aff="download" data-aff-index="${index}">Tải JSON ↓</button>${result.projectId ? `<button class="primary" data-aff="open" data-aff-index="${index}">Mở dự án đã lưu →</button>` : `<button class="primary" data-aff="import" data-aff-index="${index}" id="aff-import-${index}" ${result.dirty ? 'disabled' : ''}>Lưu bản nháp →</button>`}</div></article>`;
    }).join('')}`;
    host.querySelectorAll('[data-aff-line]').forEach(textarea => textarea.addEventListener('input', () => {
      const index = textarea.dataset.affPlan;
      results[index].editedLines ||= results[index].document.metadata.affiliate.lines.map(line => line.voice_text);
      results[index].editedLines[Number(textarea.dataset.affLine)] = textarea.value;
      results[index].dirty = true;
      $(`#aff-dirty-${index}`).hidden = false;
      const button = $(`#aff-import-${index}`);
      if (button) button.disabled = true;
    }));
    results.forEach((result, index) => {
      const editor = $(`#aff-json-${index}`);
      editor.addEventListener('input', () => { result.rawDocument = editor.value; });
      if (result.projectId) {
        editor.readOnly = true;
        host.querySelectorAll(`[data-aff-plan="${index}"]`).forEach(element => element.disabled = true);
        host.querySelector(`[data-aff="apply-lines"][data-aff-index="${index}"]`).disabled = true;
      }
    });
  }
  function currentDocument(index) {
    try { return JSON.parse($(`#aff-json-${index}`).value); }
    catch { throw Error('JSON bản nháp chưa hợp lệ. Sửa JSON trước khi lưu hoặc tải xuống.'); }
  }
  async function applyLines(index) {
    const doc = currentDocument(index), p = doc.metadata?.affiliate;
    if (!p) throw Error('JSON thiếu metadata.affiliate.');
    const lines = p.lines.map((line, i) => ({ ...line, voice_text: document.querySelector(`[data-aff-plan="${index}"][data-aff-line="${i}"]`).value }));
    results[index] = await api('/api/affiliate/plan', { method: 'POST', body: { product: p.product, references: p.references, sourceReferences: p.sourceReferences, title: doc.title, mode: 'manual', manualScript: lines, sceneCount: p.sceneCount, template: p.template, voicePersona: p.voicePersona, reviewMode: p.reviewMode, autoRepairAttempts: p.autoRepairAttempts, characterDescription: p.characterDescription } });
    showResults();
    toast('Đã cập nhật lời thoại và prompt; chưa gọi tạo media.');
  }
  async function handleClick(button) {
    if (!button.dataset.aff) return false;
    const kind = button.dataset.aff, index = Number(button.dataset.affIndex);
    button.disabled = true;
    try {
      if (kind === 'tab') { capture(); tab = button.dataset.affTab; await render(); }
      if (kind === 'folder') { capture(); await folderManifest(); }
      if (kind === 'preset') {
        const id = button.dataset.affPreset;
        const preset = (options.presetKols || []).find(p => p.id === id);
        if (!preset) throw Error('KOL mẫu không còn trong danh sách.');
        const asset = await api(`/api/affiliate/presets/${encodeURIComponent(id)}/import`, { method: 'POST', body: {} });
        setReference('kol', asset.reference, preset.name);
        const form = $('#aff-single-form') || $('#aff-batch-form');
        if (form) form.elements.voicePersona.value = preset.voicePersona;
        capture();
        toast(`Đã chọn KOL mẫu ${preset.name}.`);
      }
      if (kind === 'stop-preparation' && activePreparation) {
        const pending = activePreparation;
        pending.stopped = true;
        await api(`/api/media/jobs/${pending.id}/cancel`, { method: 'POST', body: {} });
        toast(`Đã yêu cầu dừng tác vụ chuẩn hóa ${pending.id}.`);
      }
      if (kind === 'apply-lines') await applyLines(index);
      if (kind === 'import') {
        const draft = await api('/api/projects', { method: 'POST', body: { document: currentDocument(index) } });
        results[index].projectId = draft.id;
        toast('Đã lưu bản nháp. Chưa gửi tạo nội dung.');
        showResults();
      }
      if (kind === 'open') await openProject(results[index].projectId);
      if (kind === 'download') {
        const document = currentDocument(index), url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }));
        const link = globalThis.document.createElement('a'); link.href = url; link.download = `affiliate-${index + 1}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
    } catch (error) { const target = $(`#aff-error-${index}`); if (target) target.textContent = error.message; else toast(error.message, true); }
    finally { button.disabled = false; }
    return true;
  }
  async function handleSubmit(form) {
    if (form.id === 'aff-single-form') { await singlePlan(form); return true; }
    if (form.id === 'aff-batch-form') { await batchPlan(form); return true; }
    return false;
  }
  function setReference(role, reference, name = '') {
    if (!['kol', 'product', 'detail'].includes(role) || !/^asset:[a-f0-9]{32}$/.test(reference)) throw Error('Ảnh tham chiếu Affiliate không hợp lệ.');
    refs[role] = reference;
    referenceNames[role] = name || 'Ảnh đã chọn từ thư viện';
    const label = $(`#aff-ref-${role}`), file = $(`#aff-file-${role}`);
    if (label) label.textContent = referenceNames[role];
    if (role === 'kol' && $('#aff-batch-ref-kol')) $('#aff-batch-ref-kol').textContent = referenceNames[role];
    if (file) file.value = '';
  }
  return { render, handleClick, handleSubmit, setReference };
}
