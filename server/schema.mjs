import { createHash } from 'node:crypto';

export class AppError extends Error {
  constructor(message, status = 400, code = 'INVALID_REQUEST') { super(message); this.status = status; this.code = code; }
}
const string = (v, label, max = 12000) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new AppError(`${label}: cần chuỗi có nội dung, tối đa ${max} ký tự.`);
  return v.trim();
};
export const referencesOf = scene => [...new Set([scene.reference,...(scene.references||[])].filter(Boolean))];
export function normalize(input, options = {}) {
  if (typeof input === 'string') {
    const source = input.replace(/^\uFEFF/, '').trim();
    if (source.startsWith('{') || /^\[\s*(?:\{|"|\[|\])/.test(source)) { try { input = JSON.parse(source); } catch { throw new AppError('JSON không hợp lệ.'); } }
    else input = { title: options.title || 'Kịch bản mới', scenes: source.split(/\r?\n/).filter(x => x.trim()).map(prompt => ({prompt})) };
  }
  if (Array.isArray(input)) input = {title: options.title || 'Kịch bản mới', scenes: input};
  if (!input || typeof input !== 'object') throw new AppError('Kịch bản phải là JSON hoặc TXT (mỗi dòng một cảnh).');
  if(input.version!==undefined&&input.version!==1)throw new AppError('Chỉ hỗ trợ phiên bản kịch bản 1.');
  const title = string(options.title || input.title || 'Kịch bản mới', 'Tên dự án', 200);
  const settings = {size: '16:9', duration: 10, concurrency: 2, ...options.defaults, ...input.settings};
  if (!['16:9', '9:16', '1:1', '4:3', '3:4'].includes(settings.size)) throw new AppError('Tỷ lệ khung hình không hợp lệ.');
  if (!Number.isInteger(settings.duration) || settings.duration < 1 || settings.duration > 30) throw new AppError('Thời lượng phải là số nguyên 1–30 giây.');
  if (!Number.isInteger(settings.concurrency) || settings.concurrency < 1 || settings.concurrency > 8) throw new AppError('Số tác vụ song song phải từ 1 đến 8.');
  if (!Array.isArray(input.scenes) || !input.scenes.length || input.scenes.length > 500) throw new AppError('Kịch bản cần từ 1 đến 500 cảnh.');
  const ids = new Set();
  const scenes = input.scenes.map((item, i) => {
    const s = typeof item === 'string' ? {prompt:item} : item;
    if (!s || typeof s !== 'object') throw new AppError(`Cảnh ${i+1} không hợp lệ.`);
    if(s.image||s.images) throw new AppError('Đường dẫn image/images cần nhập qua CLI, hoặc tải ảnh tham chiếu bằng giao diện web.');
    const id = s.id || `s${String(i+1).padStart(3,'0')}`;
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || ids.has(id)) throw new AppError(`ID cảnh trùng hoặc không hợp lệ: ${id}`);
    ids.add(id);
    const kind = s.kind || 'video';
    if (!['image','video'].includes(kind)) throw new AppError(`${id}: kind phải là image hoặc video.`);
    const size = s.size || settings.size;
    if (!['16:9','9:16','1:1','4:3','3:4'].includes(size)) throw new AppError(`${id}: tỷ lệ không hợp lệ.`);
    if(kind==='video'&&!['16:9','9:16'].includes(size))throw new AppError(`${id}: backend Muse hiện chỉ hỗ trợ video 16:9 hoặc 9:16. Tỷ lệ khác chỉ dành cho ảnh.`);
    const duration = s.duration ?? settings.duration;
    if (!Number.isInteger(duration) || duration < 1 || duration > 30) throw new AppError(`${id}: thời lượng phải từ 1 đến 30 giây.`);
    const reference = s.reference || null;
    if (reference && (typeof reference !== 'string' || !/^(asset:[a-f0-9]{32}|scene:[\w-]{1,64})$/.test(reference))) throw new AppError(`${id}: reference phải là asset:<id> hoặc scene:<id>. CLI hỗ trợ đường dẫn file qua image.`);
    const narration = s.narration ?? '';
    if (typeof narration !== 'string' || narration.length > 30000) throw new AppError(`${id}: lời đọc không hợp lệ.`);
    if(s.references!==undefined&&(!Array.isArray(s.references)||s.references.some(r=>typeof r!=='string'||!/^(asset:[a-f0-9]{32}|scene:[\w-]{1,64})$/.test(r))))throw new AppError(`${id}: references phải là danh sách asset:<id> hoặc scene:<id>.`);
    const references=referencesOf({reference,references:s.references});
    if(references.length>6)throw new AppError(`${id}: tối đa 6 ảnh tham chiếu mỗi cảnh.`);
    const referenceMode=s.referenceMode||'first_frame';
    if(!['first_frame','identity'].includes(referenceMode))throw new AppError(`${id}: referenceMode phải là first_frame hoặc identity.`);
    if(s.reviewRequired!==undefined&&typeof s.reviewRequired!=='boolean')throw new AppError(`${id}: reviewRequired phải là boolean.`);
    if(s.reviewRequired&&kind!=='image')throw new AppError(`${id}: duyệt ảnh chỉ áp dụng cho cảnh ảnh.`);
    const accountId=s.accountId||null;
    if(accountId!==null&&(typeof accountId!=='string'||!/^[\w-]{1,128}$/.test(accountId)))throw new AppError(`${id}: accountId không hợp lệ.`);
    return {id, title:string(s.title || `Cảnh ${i+1}`, `${id}.title`, 200), prompt:string(s.prompt, `${id}.prompt`), narration, kind, size, duration, reference,references,referenceMode,reviewRequired:s.reviewRequired===true,accountId};
  });
  const byId = new Map(scenes.map(s => [s.id,s]));
  const visited=new Set(),visiting=new Set();
  const visit=s=>{if(visiting.has(s.id))throw new AppError('Tham chiếu giữa các cảnh tạo vòng lặp.');if(visited.has(s.id))return;visiting.add(s.id);for(const r of referencesOf(s).filter(r=>r.startsWith('scene:'))){const ref=byId.get(r.slice(6));if(!ref||ref.id===s.id||ref.kind!=='image')throw new AppError(`${s.id}: cảnh tham chiếu phải là một cảnh ảnh khác có trong kịch bản.`);visit(ref);}visiting.delete(s.id);visited.add(s.id);};
  scenes.forEach(visit);
  let metadata;
  if(input.metadata!==undefined){if(!input.metadata||typeof input.metadata!=='object'||Array.isArray(input.metadata)||JSON.stringify(input.metadata).length>500000)throw new AppError('metadata phải là object nhỏ hơn 500 KB.');metadata=JSON.parse(JSON.stringify(input.metadata));}
  return {version:1, title, settings:{size:settings.size,duration:settings.duration,concurrency:settings.concurrency}, scenes,...(metadata?{metadata}:{})};
}
export const fingerprint = value => createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('hex');
export const template = {
  version:1, title:'Vườn chôm chôm · từ Codex', settings:{size:'16:9', duration:10, concurrency:2}, scenes:[
    {id:'s001',title:'Khu vườn lúc bình minh',kind:'video',prompt:'Cinematic wide establishing shot of a Vietnamese rambutan orchard at sunrise, soft mist, gentle dolly forward, natural birdsong, no text, no logos.',narration:'Khi bình minh vừa lên, khu vườn bắt đầu một ngày mới.'},
    {id:'s002',title:'Cận cảnh trái chín',kind:'video',prompt:'Macro close-up of ripe red rambutans on a branch, dew droplets, warm natural light, slow camera slide, realistic botanical detail, no text, no logos.',narration:'Ẩn dưới lớp vỏ rực rỡ là câu chuyện của một mùa chăm sóc.'}
  ]
};
