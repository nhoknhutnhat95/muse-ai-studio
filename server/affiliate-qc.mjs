import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './schema.mjs';
import {mediaPaths} from './runtime-paths.mjs';

const execFileAsync = promisify(execFile);
const WIDTH = 72, HEIGHT = 128, PIXELS = WIDTH * HEIGHT;
const LIMITATIONS = [
  'Kiểm tra pixel chỉ phát hiện dấu hiệu kỹ thuật; không xác minh khuôn mặt, bàn tay, chữ nhãn hoặc công dụng sản phẩm.',
  'Màu chủ đạo có thể thay đổi do ánh sáng và bố cục. Cờ nghi ngờ cần người dùng xem ảnh trước khi tạo lại.',
  'Ảnh qua kiểm tra không đồng nghĩa nội dung đã đúng kịch bản.',
];

function std(values) {
  let sum = 0, square = 0;
  for (const value of values) { sum += value; square += value * value; }
  const mean = sum / values.length;
  return Math.sqrt(Math.max(0, square / values.length - mean * mean));
}
function grayscale(rgb) {
  const result = new Float64Array(PIXELS);
  for (let i = 0; i < PIXELS; i++) result[i] = rgb[3 * i] * 0.299 + rgb[3 * i + 1] * 0.587 + rgb[3 * i + 2] * 0.114;
  return result;
}
function hueMass(rgb) {
  const bins = new Float64Array(18);
  let count = 0;
  for (let i = 0; i < PIXELS; i++) {
    const r = rgb[3 * i] / 255, g = rgb[3 * i + 1] / 255, b = rgb[3 * i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    if (max < 64 / 255 || delta / max < 77 / 255 || !delta) continue;
    let h = max === r ? (g - b) / delta % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    if (h < 0) h += 6;
    bins[Math.min(17, Math.floor(h * 3))]++;
    count++;
  }
  return { bins, fraction: count / PIXELS, total: count };
}
function patchStats(rgb, x0, y0, x1, y1) {
  const channels = [[], [], []];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * WIDTH + x) * 3;
    for (let c = 0; c < 3; c++) channels[c].push(rgb[i + c]);
  }
  return { mean: channels.map(values => values.reduce((sum, value) => sum + value, 0) / values.length), spread: channels.reduce((sum, values) => sum + std(values), 0) / 3 };
}
function borderSides(rgb) {
  const patches = [
    [[0, 0, WIDTH, 3], [0, 3, WIDTH, 6]],
    [[0, HEIGHT - 3, WIDTH, HEIGHT], [0, HEIGHT - 6, WIDTH, HEIGHT - 3]],
    [[0, 0, 3, HEIGHT], [3, 0, 6, HEIGHT]],
    [[WIDTH - 3, 0, WIDTH, HEIGHT], [WIDTH - 6, 0, WIDTH - 3, HEIGHT]],
  ];
  return patches.map(([edge, inner], index) => {
    const a = patchStats(rgb, ...edge), b = patchStats(rgb, ...inner);
    const difference = a.mean.reduce((sum, v, c) => sum + Math.abs(v - b.mean[c]), 0) / 3;
    return a.spread < 5 && difference > 14 ? ['top', 'bottom', 'left', 'right'][index] : null;
  }).filter(Boolean);
}
function validPixels(image) { return image?.rgb?.length === PIXELS * 3 && Number.isInteger(image.width) && image.width > 0 && Number.isInteger(image.height) && image.height > 0; }

// Original implementation of the observed local heuristics; no semantic/face recognition or paid service.
export function inspectAffiliatePixels(images, { product } = {}) {
  const analyzed = [];
  const reports = images.map(image => {
    const report = { sceneId: image.sceneId, jobId: image.jobId, width: image.width ?? null, height: image.height ?? null, flags: [], suggestedReview: 'review' };
    const flag = (code, message, details = {}) => report.flags.push({ code, message, ...details });
    if (!validPixels(image)) { flag('unreadable_image', 'Không đọc được ảnh đã tạo.'); return report; }
    if (Math.abs(image.width / image.height - 9 / 16) > 0.045) flag('wrong_ratio', 'Ảnh không đúng tỷ lệ 9:16.', { expected: '9:16' });
    const gray = grayscale(image.rgb), spread = std(gray), borders = borderSides(image.rgb), hue = hueMass(image.rgb);
    report.metrics = { grayscaleStd: Number(spread.toFixed(3)), solidBorderSides: borders, coloredPixelFraction: Number(hue.fraction.toFixed(4)) };
    if (spread < 12) flag('nearly_blank', 'Ảnh gần như trống hoặc có độ tương phản rất thấp.');
    if (borders.length >= 2) flag('solid_borders', 'Có viền màu đặc ở ít nhất hai mép ảnh.', { sides: borders });
    analyzed.push({ image, report, gray, hue });
    return report;
  });
  for (let i = 0; i < analyzed.length; i++) for (let j = i + 1; j < analyzed.length; j++) {
    const first = analyzed[i], second = analyzed[j];
    let delta = 0;
    for (let k = 0; k < PIXELS; k++) delta += Math.abs(first.gray[k] - second.gray[k]);
    delta /= PIXELS;
    if (delta < 3) second.report.flags.push({ code: 'near_duplicate', message: `Ảnh gần như trùng với cảnh ${first.report.sceneId}.`, otherSceneId: first.report.sceneId, meanDifference: Number(delta.toFixed(3)) });
  }
  if (validPixels(product)) {
    const referenceHue = hueMass(product.rgb);
    if (referenceHue.fraction >= 0.02) {
      const ranked = [...referenceHue.bins].map((count, bin) => ({ count, bin })).sort((a, b) => b.count - a.count);
      const dominant = new Set(); let mass = 0;
      for (const { count, bin } of ranked) {
        dominant.add(bin); dominant.add((bin + 17) % 18); dominant.add((bin + 1) % 18);
        mass += count;
        if (mass >= referenceHue.total * 0.7) break;
      }
      for (const { report, hue } of analyzed) {
        const matchingFraction = [...dominant].reduce((sum, bin) => sum + hue.bins[bin], 0) / PIXELS;
        report.metrics.productColorFraction = Number(matchingFraction.toFixed(4));
        if (matchingFraction < 0.004) report.flags.push({ code: 'product_color_absent', message: 'Không thấy đủ màu chủ đạo của ảnh sản phẩm trong khung hình.' });
      }
    }
  }
  for (const report of reports) { report.passed = report.flags.length === 0; report.suggestedReview = report.passed ? 'approve' : 'review'; }
  const flags = reports.flatMap(report => report.flags.map(flag => ({ sceneId: report.sceneId, jobId: report.jobId, ...flag })));
  return { engine: 'local_pixel_heuristics', images: reports, flags, passed: reports.length > 0 && flags.length === 0, suggestedRegenerateSceneIds: reports.filter(report => report.flags.length).map(report => report.sceneId), limitations: [...LIMITATIONS] };
}

async function decodeLocalImage(file, { ffmpeg, ffprobe }) {
  try {
    const probe = await execFileAsync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file], { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024, encoding: 'utf8' });
    const stream = JSON.parse(probe.stdout).streams?.[0];
    if (!stream?.width || !stream?.height) return null;
    const frame = await execFileAsync(ffmpeg, ['-nostdin', '-v', 'error', '-i', file, '-frames:v', '1', '-vf', `scale=${WIDTH}:${HEIGHT}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024, encoding: 'buffer' });
    return { width: stream.width, height: stream.height, rgb: frame.stdout };
  } catch (error) {
    if (['ENOENT', 'EACCES', 'EPERM'].includes(error.code) || error.killed) throw new AppError('Không chạy được FFmpeg/ffprobe để kiểm tra ảnh. Giữ ảnh chờ duyệt thủ công; chưa có kết luận về chất lượng ảnh.', 503, 'AFFILIATE_QC_UNAVAILABLE');
    return null;
  }
}

export function createAffiliateQC({ store, dataDir = store?.dir, ffmpeg, ffprobe, decodeImage } = {}) {
  const root = path.resolve(dataDir || '.');
  const runtime = mediaPaths();
  const decoder = decodeImage || (file => decodeLocalImage(file, { ffmpeg: ffmpeg || runtime.ffmpeg, ffprobe: ffprobe || runtime.ffprobe }));
  async function owned(relative) {
    if (typeof relative !== 'string') return null;
    const file = path.resolve(root, relative), rel = path.relative(root, file);
    if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return null;
    try {
      const realRoot = await realpath(root), actual = await realpath(file), actualRel = path.relative(realRoot, actual), info = await stat(actual);
      if (!actualRel || actualRel === '..' || actualRel.startsWith('..' + path.sep) || path.isAbsolute(actualRel) || !info.isFile() || info.size > 250 * 1024 * 1024) return null;
      return actual;
    } catch { return null; }
  }
  async function inspect({ projectId, jobId } = {}) {
    if (!store || typeof projectId !== 'string' || !projectId) throw new AppError('Cần projectId để kiểm tra ảnh Affiliate.', 400, 'AFFILIATE_QC_INPUT');
    const project = store.get(projectId);
    const imageScenes = project.scenes.filter(scene => scene.kind === 'image');
    const completed = imageScenes.map(scene => ({ scene, job: project.jobs.find(job => job.scene_id === scene.id && job.state === 'completed') })).filter(({ job }) => job);
    if (jobId !== undefined && !completed.some(({ job }) => job.id === jobId)) throw new AppError('jobId phải là ảnh đã hoàn tất trong dự án này.', 400, 'AFFILIATE_QC_INPUT');
    const inputs = [];
    for (const { scene, job } of completed) {
      const file = await owned(job.result?.file);
      const decoded = file ? await decoder(file) : null;
      inputs.push({ sceneId: scene.id, jobId: job.id, ...(decoded || {}) });
    }
    const ref = project.metadata?.affiliate?.sourceReferences?.product || project.metadata?.affiliate?.references?.product;
    let product;
    if (typeof ref === 'string' && /^asset:[a-f0-9]{32}$/.test(ref)) {
      const asset = store.db.prepare('SELECT file,mime FROM assets WHERE id=?').get(ref.slice(6));
      if (asset?.mime?.startsWith('image/')) {
        const file = await owned(asset.file);
        if (file) product = await decoder(file);
      }
    }
    const result = inspectAffiliatePixels(inputs, { product });
    if (jobId !== undefined) {
      result.images = result.images.filter(image => image.jobId === jobId);
      result.flags = result.flags.filter(flag => flag.jobId === jobId);
      result.passed = result.images.length > 0 && result.flags.length === 0;
      result.suggestedRegenerateSceneIds = result.images.filter(image => image.flags.length).map(image => image.sceneId);
    }
    if (ref && !product) result.limitations.push('Không đọc được ảnh sản phẩm nguồn; chưa kiểm tra màu chủ đạo.');
    return { projectId, checkedAt: new Date().toISOString(), ...result, skippedImageCount: imageScenes.length - completed.length, ...(completed.length ? {} : { message: 'Chưa có tác vụ ảnh hoàn tất để kiểm tra.' }) };
  }
  return { inspect };
}
