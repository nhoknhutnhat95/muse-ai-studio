import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAffiliateService, affiliateOptions, parseAffiliateInfo, discoverAffiliateFolder } from '../server/affiliate.mjs';
import { normalize } from '../server/schema.mjs';
import { createAffiliateQC, inspectAffiliatePixels } from '../server/affiliate-qc.mjs';

const productRef = 'asset:' + 'a'.repeat(32);
const kolRef = 'asset:' + 'b'.repeat(32);
const detailRef = 'asset:' + 'c'.repeat(32);
const product = { name: 'Bình nước thử nghiệm', usp: 'Dung tích 500 ml, nắp vặn.', description: 'Màu xanh, thân bằng thép.' };
const input = { product, references: { product: productRef, kol: kolRef, detail: detailRef } };
const noBackend = { request() { throw Error('Unexpected backend call'); } };

test('manual narration survives clip grouping and schema normalization exactly', async () => {
  const manualScript = ['  Mở đầu giữ nguyên dấu cách.  ', 'Chi tiết: 500 ml.', 'Câu thứ ba!', 'Kết thúc?'];
  const p = await createAffiliateService({ backend: noBackend }).plan({ ...input, mode: 'manual', manualScript });
  assert.deepEqual(p.document.metadata.affiliate.lines.map(l => l.voice_text), manualScript);
  const videos = p.document.scenes.filter(s => s.kind === 'video');
  assert.equal(videos[0].narration, manualScript.slice(0, 2).join('\n'));
  assert.equal(videos[1].narration, manualScript.slice(2).join('\n'));
  assert.equal(p.document.metadata.affiliate.scriptLocked, true);
  assert.deepEqual(normalize(p.document), p.document);
  assert.deepEqual(p.document.metadata.affiliate.render.sceneIds, videos.map(s => s.id));
});

test('five-line plan builds three dependent clips, all references and image review gates', async () => {
  const result = await createAffiliateService({ backend: noBackend }).plan({ ...input, sceneCount: 5, reviewMode: 'all' });
  const { document, storyboard } = result;
  const images = document.scenes.filter(s => s.kind === 'image');
  const videos = document.scenes.filter(s => s.kind === 'video');
  assert.equal(images.length, 3);
  assert.equal(videos.length, 3);
  assert.equal(storyboard[2].segments[0], 'CTA');
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(images[i].references, [i === 0 ? kolRef : 'scene:frame_01', productRef, detailRef]);
    assert.equal(images[i].reviewRequired, true);
    assert.equal(videos[i].reference, `scene:${images[i].id}`);
    assert.equal(videos[i].referenceMode, 'first_frame');
  }
  assert.equal(document.metadata.affiliate.voicePersona, 'female_reviewer');
  assert.equal(document.metadata.affiliate.anchorSceneId, 'frame_01');
  assert.match(images[1].prompt, /generated anchor/);
});

test('flagged review gates images for automatic local checks and states semantic limits', async () => {
  const service = createAffiliateService();
  const flagged = await service.plan({ ...input, reviewMode: 'flagged' });
  assert.equal(flagged.document.metadata.affiliate.effectiveReviewMode, 'flagged');
  assert.ok(flagged.warnings.some(w => w.includes('không xác minh khuôn mặt')));
  assert.ok(flagged.document.scenes.filter(s => s.kind === 'image').every(s => s.reviewRequired));
  const auto = await service.plan({ ...input, reviewMode: 'auto' });
  assert.ok(auto.document.scenes.every(s => !s.reviewRequired));
});

test('automatic repair is opt-in, bounded to two rounds and retained as draft metadata only', async () => {
  const service = createAffiliateService({ backend: noBackend });
  const original = await service.plan(input);
  assert.equal(original.document.metadata.affiliate.autoRepairAttempts, 0);
  const plan = await service.plan({ ...input, reviewMode: 'flagged', autoRepairAttempts: 2 });
  assert.equal(plan.document.metadata.affiliate.autoRepairAttempts, 2);
  assert.ok(plan.warnings.some(w => w.includes('dùng thêm lượt tạo ảnh')));
  await assert.rejects(service.plan({ ...input, autoRepairAttempts: 3 }), /0, 1 hoặc 2/);
  await assert.rejects(service.plan({ ...input, autoRepairAttempts: 1.5 }), /0, 1 hoặc 2/);
  assert.equal(parseAffiliateInfo('auto_repair_attempts=1').data.autoRepairAttempts, 1);
});

test('AI mode makes one chat call with product data, parses fenced JSON, and submits no media', async () => {
  const calls = [];
  const lines = ['HOOK', 'DETAIL', 'EXPERIENCE', 'CTA'].map(segment => ({ segment, voice_text: `Lời ${segment}.`, visual_note: 'Close-up.' }));
  const backend = { async request(route, options) { calls.push({ route, options }); return { choices: [{ message: { content: '```json\n' + JSON.stringify(lines) + '\n```' } }] }; } };
  const result = await createAffiliateService({ backend }).plan({ ...input, mode: 'ai' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, '/v1/chat/completions');
  assert.equal(calls[0].options.body.stream, false);
  assert.deepEqual(JSON.parse(calls[0].options.body.messages[1].content).product.name, product.name);
  assert.equal(result.document.metadata.affiliate.mode, 'ai');
  assert.deepEqual(result.document.metadata.affiliate.lines, lines);
});

test('invalid AI JSON has no automatic paid retry or silent template fallback', async () => {
  let count = 0;
  const backend = { async request() { count++; return { choices: [{ message: { content: '{broken' } }] }; } };
  await assert.rejects(createAffiliateService({ backend }).plan({ ...input, mode: 'ai' }), e => e.code === 'AFFILIATE_AI_INVALID');
  assert.equal(count, 1);
});

test('planning rejects missing/foreign assets and invalid manual counts before AI calls', async () => {
  const store = { db: { prepare() { return { get(id) { return id === 'a'.repeat(32) ? { id, mime: 'image/png' } : undefined; } }; } } };
  const service = createAffiliateService({ store, backend: noBackend });
  await assert.rejects(service.plan({ product, references: { product: productRef, kol: kolRef } }), e => e.code === 'AFFILIATE_ASSET_MISSING');
  await assert.rejects(service.plan({ product, references: {} }), /ảnh sản phẩm/);
  await assert.rejects(service.plan({ product, references: { product: 'C:/private/photo.png' }, mode: 'ai' }), /asset ID/);
  await assert.rejects(service.plan({ product, references: { product: productRef }, mode: 'manual', manualScript: ['Một câu.'] }), e => e.code === 'AFFILIATE_SCRIPT_INVALID');
});

test('batch isolates product errors, applies shared KOL and does not import or submit jobs', async () => {
  const result = await createAffiliateService({ backend: noBackend }).batch({ defaults: { references: { kol: kolRef }, mode: 'template' }, products: [
    { key: 'good', product, references: { product: productRef } },
    { product: { name: '' }, references: { product: productRef } },
    { key: 'good2', product: { name: 'Máy cạo râu' }, references: { product: detailRef } },
  ] });
  assert.equal(result.total, 3);
  assert.equal(result.plans.length, 2);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].index, 1);
  assert.equal(result.plans[0].document.metadata.affiliate.references.kol, kolRef);
  assert.equal(result.plans[1].document.metadata.affiliate.voicePersona, 'male_expert');
});

test('templates only use supplied facts; absent offer does not become a discount or testimonial', async () => {
  const plan = await createAffiliateService().plan({ product: { name: 'Sản phẩm thử nghiệm' }, references: { product: productRef }, template: 'deal_focus' });
  const script = plan.document.metadata.affiliate.lines.map(l => l.voice_text).join(' ');
  assert.doesNotMatch(script, /giá sốc|chính hãng|mình dùng|giảm \d|có hạn|tốt nhất/);
  assert.ok(plan.warnings.some(w => w.includes('Chưa có ưu đãi')));
  assert.equal(affiliateOptions().voices.length, 5);
});

test('folder discovery reads per-product images and info, reports missing images, ignores unsupported fields', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'muse-affiliate-'));
  try {
    const good = path.join(root, 'product-a');
    await mkdir(good); await mkdir(path.join(root, 'empty-product'));
    await Promise.all(['product.png', 'detail.jpg', 'kol.webp'].map(name => writeFile(path.join(good, name), 'test-image-placeholder')));
    await writeFile(path.join(good, 'info.txt'), '# local manifest\nTên sản phẩm: Đèn bàn\nusp=Hai mức sáng\nscene_count:5\npersona:male_expert\nunknown: ignored\n');
    const result = await discoverAffiliateFolder(root);
    assert.equal(result.products.length, 1);
    assert.equal(result.errors.length, 1);
    assert.equal(result.products[0].product.name, 'Đèn bàn');
    assert.equal(result.products[0].sceneCount, 5);
    assert.equal(result.products[0].files.product, path.join(good, 'product.png'));
    assert.equal(result.products[0].files.detail, path.join(good, 'detail.jpg'));
    assert.equal(result.products[0].files.kol, path.join(good, 'kol.webp'));
    assert.equal(result.products[0].warnings.length, 1);
    assert.deepEqual(parseAffiliateInfo('review_mode=all\nchar_desc: Nam mặc áo xanh').data, { reviewMode: 'all', characterDescription: 'Nam mặc áo xanh' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('installed KOL presets expose only safe IDs and JPEG bytes, never arbitrary paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'muse-kol-presets-'));
  try {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]);
    await writeFile(path.join(root, 'kol_nu_reviewer.jpg'), bytes);
    const service = createAffiliateService({ presetDir: root });
    const presets = service.presets();
    assert.equal(presets.length, 1);
    assert.equal(presets[0].id, 'female_reviewer');
    assert.equal(presets[0].url, '/api/affiliate/presets/female_reviewer/image');
    assert.equal(JSON.stringify(presets).includes(root), false);
    assert.deepEqual(service.options().presetKols, presets);
    assert.deepEqual((await service.presetAsset('female_reviewer')).data, bytes);
    await assert.rejects(service.presetAsset('../private'), e => e.code === 'AFFILIATE_PRESET_MISSING');
    await assert.rejects(service.presetAsset('male_expert'), e => e.code === 'AFFILIATE_PRESET_MISSING');
    await writeFile(path.join(root, 'kol_nu_reviewer.jpg'), 'not a jpeg');
    await assert.rejects(service.presetAsset('female_reviewer'), e => e.code === 'AFFILIATE_PRESET_INVALID');
  } finally { await rm(root, { recursive: true, force: true }); }
});

function pixels(color, pattern = true) {
  const rgb = Buffer.alloc(72 * 128 * 3);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 72; x++) {
    const factor = pattern ? 0.4 + (x + y) / 400 : 1;
    for (let c = 0; c < 3; c++) rgb[(y * 72 + x) * 3 + c] = Math.round(color[c] * factor);
  }
  return { width: 720, height: 1280, rgb };
}
test('local image QC detects ratio, blank frames, repeated frames and absent product color', () => {
  const red = pixels([255, 50, 25]), blue = pixels([25, 50, 255]);
  const result = inspectAffiliatePixels([
    { sceneId: 'first', jobId: 'job1', ...red },
    { sceneId: 'copy', jobId: 'job2', ...red },
    { sceneId: 'wrong-color', jobId: 'job3', ...blue },
    { sceneId: 'blank', jobId: 'job4', ...pixels([255, 255, 255], false), width: 1280, height: 720 },
  ], { product: red });
  assert.equal(result.engine, 'local_pixel_heuristics');
  assert.ok(result.images.find(image => image.sceneId === 'copy').flags.some(flag => flag.code === 'near_duplicate'));
  assert.ok(result.images.find(image => image.sceneId === 'wrong-color').flags.some(flag => flag.code === 'product_color_absent'));
  assert.ok(result.images.find(image => image.sceneId === 'blank').flags.some(flag => flag.code === 'wrong_ratio'));
  assert.ok(result.images.find(image => image.sceneId === 'blank').flags.some(flag => flag.code === 'nearly_blank'));
  assert.equal(result.passed, false);
  assert.ok(result.limitations.some(message => message.includes('khuôn mặt')));
});

test('local QC marks unreadable completed images, ignores unfinished/video jobs, scopes owned paths and job selection', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'muse-affiliate-qc-'));
  try {
    await writeFile(path.join(root, 'frame.png'), 'fixture');
    const project = { scenes: [{ id: 'valid', kind: 'image' }, { id: 'escaped', kind: 'image' }, { id: 'waiting', kind: 'image' }, { id: 'movie', kind: 'video' }], jobs: [
      { id: 'ok', scene_id: 'valid', state: 'completed', result: { file: 'frame.png' } },
      { id: 'escape', scene_id: 'escaped', state: 'completed', result: { file: '../outside.png' } },
      { id: 'pending', scene_id: 'waiting', state: 'queued' },
      { id: 'video', scene_id: 'movie', state: 'completed', result: { file: 'frame.png' } },
    ] };
    const calls = [];
    const qc = createAffiliateQC({ dataDir: root, store: { get() { return project; } }, decodeImage: async file => { calls.push(file); return pixels([255, 240, 220]); } });
    const report = await qc.inspect({ projectId: 'project' });
    assert.equal(report.images.length, 2);
    assert.equal(report.skippedImageCount, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0], path.join(root, 'frame.png'));
    assert.ok(report.images.find(image => image.jobId === 'escape').flags.some(flag => flag.code === 'unreadable_image'));
    const one = await qc.inspect({ projectId: 'project', jobId: 'ok' });
    assert.equal(one.images.length, 1);
    assert.equal(one.images[0].jobId, 'ok');
    assert.equal(one.images[0].passed, true);
    assert.equal(one.passed, true);
    await assert.rejects(qc.inspect({ projectId: 'project', jobId: 'video' }), e => e.code === 'AFFILIATE_QC_INPUT');
  } finally { await rm(root, { recursive: true, force: true }); }
});
