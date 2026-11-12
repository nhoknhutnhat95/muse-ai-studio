import {AppError,normalize} from './schema.mjs';

const presets={
  turnaround_1p:{name:'Một nhân vật · nhiều góc',labels:['Chính diện','Góc nghiêng','Toàn thân']},
  two_characters:{name:'Hai nhân vật · bối cảnh',labels:['Nhân vật A','Nhân vật B','Bối cảnh']},
  creator_product:{name:'Creator · sản phẩm',labels:['Creator / KOL','Sản phẩm','Chi tiết sản phẩm']}
};
const imageTemplates={
  creator:'Photorealistic creator holding and naturally demonstrating {product}, recognizable identity from @Image1, accurate product from @Image2, vertical editorial photography, natural soft light, anatomically correct hands, no added text.',
  packshot:'Premium studio packshot of {product}, three-quarter angle, accurate shape and material from @Image2, clean neutral background, soft product lighting, no added text.',
  detail:'Macro photograph of {product}, detailed materials and functional feature from @Image3, faithful product geometry, realistic studio lighting, no added text.'
};
export function workflowOptions(){return {presets,imageTemplates,maxSlots:12,maxReferencesPerScene:6,imageRatios:['16:9','9:16','1:1','4:3','3:4'],videoRatios:['16:9','9:16']};}
export function selectReferences(prompt,slots){
  const tagged=[...new Set([...prompt.matchAll(/@image(\d+)/gi)].map(m=>Number(m[1])))].sort((a,b)=>a-b);
  if(tagged.some(n=>n<1||n>slots.length||!slots[n-1]?.reference))throw new AppError('Prompt gọi @ImageN chưa có ảnh trong bộ tham chiếu.');
  const selected=tagged.length?tagged.map(n=>slots[n-1].reference):slots.map(s=>s.reference).filter(Boolean);
  if(selected.length>6)throw new AppError('Mỗi cảnh nhận tối đa 6 ảnh. Với bộ lớn hơn 6, hãy chỉ rõ @ImageN trong prompt.');
  // Remap sparse original slots to the compact image sequence sent to Muse.
  return {references:selected,prompt:tagged.length?prompt.replace(/@image(\d+)/gi,(_,n)=>`@Image${tagged.indexOf(Number(n))+1}`):prompt};
}
export function planWorkflow(input={}){
  const kind=input.kind||'video';if(!['image','video','character'].includes(kind))throw new AppError('kind phải là image, video hoặc character.');
  const textOnly=input.textOnly===true;
  const slots=input.slots||[];
  if(!Array.isArray(slots)||slots.length>12||slots.some(s=>!s||typeof s!=='object'||(s.reference&&!/^asset:[a-f0-9]{32}$/.test(s.reference))))throw new AppError('Bộ tham chiếu gồm tối đa 12 ảnh asset đã tải lên.');
  const lines=Array.isArray(input.scenes)?input.scenes:typeof input.prompts==='string'?input.prompts.split(/\r?\n/).filter(x=>x.trim()).map(prompt=>({prompt})):[];
  if(!lines.length)throw new AppError('Nhập prompt, mỗi dòng một cảnh.');
  const scenes=lines.map((s,i)=>{if(typeof s==='string')s={prompt:s};if(typeof s.prompt!=='string')throw new AppError('Mỗi cảnh phải có prompt.');const selected=textOnly?{prompt:s.prompt,references:[]}:selectReferences(s.prompt,slots);return {...s,...selected,id:s.id||`s${String(i+1).padStart(3,'0')}`,kind:kind==='image'?'image':'video',referenceMode:input.referenceMode||(kind==='character'?'identity':'first_frame'),reviewRequired:kind==='image'&&input.reviewRequired===true,accountId:input.accountId||null};});
  return {document:normalize({title:input.title||({image:'Xưởng ảnh',video:'Video từ kịch bản',character:'Đồng bộ nhân vật'})[kind],settings:{size:input.size||'9:16',duration:input.duration??6,concurrency:input.concurrency??2},scenes,metadata:{workflow:kind,character:kind==='character'?{preset:input.preset||'turnaround_1p',textOnly,slots}:undefined}}),warnings:kind==='character'?['Tham chiếu giúp giữ nhân vật; cần kiểm tra mặt, trang phục và chuyển động trong video kết quả.']:[]};
}
