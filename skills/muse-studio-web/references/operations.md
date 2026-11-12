# Các thao tác Muse Web

Các ví dụ dưới đây dùng PowerShell. Khai báo `$museCli` là đường dẫn tuyệt đối đến `scripts/muse.mjs` trong thư mục skill này; đọc `references/instance.json` để lấy `$museRoot` và địa chỉ web đã cài. Các tên `PROJECT_ID`, `JOB_ID`, `MEDIA_JOB_ID`, `SPEC_FILE` là chỗ thay bằng giá trị thực, không phải ID mẫu có thể chạy. CLI trả JSON; kiểm tra exit code ngay sau lệnh.

## Khởi động và phục hồi kết nối

```powershell
node $museCli doctor
```

Nếu web chưa chạy, kiểm tra health trước khi khởi động ẩn:

```powershell
# $museRoot va $museUrl lay tu references/instance.json, khong dung duong dan may khac.
$museReady = $false
try { $museReady = (Invoke-RestMethod "$museUrl/api/health" -TimeoutSec 2).ok } catch {}
if (-not $museReady) {
  $env:MUSE_PORT = ([uri]$museUrl).Port.ToString()
  & "$museRoot/Start-Muse-Web.cmd" -NoBrowser
  if ($LASTEXITCODE -ne 0) { throw 'Launcher lỗi; đọc thông báo trước khi chạy lại.' }
}
```

Gọi lại `doctor` sau khi tiến trình khởi động. Nếu cổng đang bị chiếm bởi tiến trình khác, xác định chủ sở hữu trước; không tự kill. `Start-Muse-Web.cmd` là launcher có mở trình duyệt, phù hợp khi người dùng muốn mở web. Nếu web khỏe nhưng backend offline, đọc doctor/backendMode. Mặc định standalone: chạy Setup-Muse-Web.cmd nếu thiếu runtime, rồi Restart-Muse-Web.cmd khi hết job. Chỉ chế độ desktop được chọn rõ mới cần app gốc. Không đổi key/proxy để thử sửa. Không cần REA để vận hành.

## Xưởng ảnh, video và nhân vật

`node $museCli workflow SPEC_FILE --out PLAN_FILE` chuẩn bị plan; có thể upload ảnh tham chiếu local, chưa generation. Spec:

```json
{
  "kind": "character",
  "title": "Tên dự án",
  "prompts": ["@Image1 bước chậm qua khu vườn, máy quay trung cảnh."],
  "size": "9:16",
  "duration": 10,
  "slots": [{"image": "./nhan-vat.png"}],
  "textOnly": false,
  "referenceMode": "identity"
}
```

`kind` nhận `image`, `video`, `character`. Slot có thể dùng `reference` asset đã có thay cho `image`. Tối đa 12 slot và 6 ảnh cho một cảnh; `@ImageN` chọn slot theo số. Luôn đọc `warnings` và `document` rồi `validate PLAN_FILE` → `import PLAN_FILE`. Đừng gửi thêm một workflow nếu dự án đích đã có job phù hợp.

## Affiliate

Lấy enum/preset thực bằng `affiliate options` và `affiliate presets`; `affiliate preset ID` nhập ảnh KOL local rồi trả asset. `media upload FILE` trả asset sản phẩm. Spec tối thiểu cần dữ kiện sản phẩm và ảnh tham chiếu:

```json
{
  "product": {"name": "Tên sản phẩm", "usp": "Ưu điểm đã được cung cấp", "description": "Mô tả đã xác minh"},
  "references": {"product": "ASSET_ID_THUC"},
  "mode": "template",
  "sceneCount": 4,
  "autoRepairAttempts": 0
}
```

Thay `ASSET_ID_THUC` bằng giá trị `asset:...` trả về. `mode:"manual"` nhận `manualScript` hoặc `lines`; `template` dựng theo dữ kiện có sẵn; `ai` gọi Muse Chat và cần phạm vi yêu cầu cho phép. Không bịa công dụng, chứng nhận, giá/khuyến mại. Lấy `voicePersona`, `reviewMode` theo options hiện tại thay vì đoán enum.

- Một sản phẩm: `affiliate plan SPEC_FILE --out PLAN_FILE`.
- Batch JSON: `affiliate batch SPEC_FILE --out PLANS_FILE`.
- Batch thư mục: `affiliate folder PRODUCT_ROOT --out PLANS_FILE`; mỗi thư mục con có ảnh `main`/`product`, tùy chọn `detail`/`kol`, `info.txt` theo README.
- `affiliate import-batch PLANS_FILE` chỉ tạo draft. Đọc cả `projects`, `errors`, `discoveryErrors`; có thể thành công một phần, không nhập/rerun toàn bộ để chữa một mục lỗi.
- `affiliate qc PROJECT_ID` đọc QC pixel local. `--apply` thay đổi duyệt ảnh và có thể giải phóng video đang đợi. Chỉ dùng nếu phạm vi cho phép; pixel sạch không xác minh mặt, tay, chữ hoặc sản phẩm đúng.
- Duyệt ảnh đã xem: `review JOB_ID`. Từ chối: `review JOB_ID --reject --note "Lý do cụ thể"`. Từ chối không tự tạo lại; `retry JOB_ID` là thao tác riêng có thể tiêu lượt.

## Lồng tiếng, dựng phim, trích frame

Đọc `media capabilities`, `media voices` trước khi chọn preset, nhạc kèm app, FFmpeg/FFprobe và tham số hỗ trợ.

TTS spec dùng lời đọc dự án, hoặc thêm `text` nếu người dùng đã yêu cầu lời đọc riêng:

```json
{"projectId":"PROJECT_ID","voice":"vi-VN-HoaiMyNeural","rate":0}
```

Gửi bằng `media tts SPEC_FILE`; lưu ID trả về. Theo dõi bằng `media status MEDIA_JOB_ID` / `media wait MEDIA_JOB_ID --timeout 45 --interval 3`. Exit 2 chỉ là timeout chờ; không tạo job TTS mới. Khi hoàn tất có MP3/SRT; lấy `result.file`, `result.artifacts.subtitle` hoặc `media download MEDIA_JOB_ID --out FILE [--artifact subtitle]`.

Render spec minh họa (thay ID thật, bỏ trường không cần):

```json
{
  "projectId":"PROJECT_ID",
  "sceneIds":["s001","s002"],
  "resolution":"1080p",
  "fps":30,
  "narrationJob":"MEDIA_JOB_ID_TTS",
  "captions":true,
  "musicGain":0.12,
  "originalGain":0,
  "duckMusic":true,
  "transition":{"type":"fade","duration":0.35}
}
```

`media render SPEC_FILE` dựng local. `originalGain:0` tắt tiếng gốc: chỉ chọn khi có chủ đích; không áp đặt mẫu nếu cần giữ âm thanh clip. `musicGain` không tự chọn nhạc; thêm `musicAsset` hoặc `bundledMusicId` thực khi cần nhạc. Lời đọc dài hơn tổng clip gây lỗi; sửa timeline theo brief, không âm thầm cắt lời.

- Video ngoài dự án: upload từng file rồi dùng `videoAssets:["asset:..."]` theo đúng thứ tự thay project/sceneIds.
- `media frame SPEC_FILE`: `{sourceJobId:JOB_ID,seconds:...}` cho job Muse, hoặc `{mediaJobId:MEDIA_JOB_ID,seconds:...}` cho job hậu kỳ, đúng một nguồn.
- `media references SPEC_FILE`: `{productAsset,kolAsset?,detailAsset?}`; kết quả ở `result.references` dùng cho Affiliate.
- `media jobs PROJECT_ID` tìm lại công đoạn đã có trước khi tạo mới. Job hậu kỳ `interrupted` không tự resume; `media retry MEDIA_JOB_ID` chủ động sau khi xác định nguyên nhân. TTS retry vẫn gọi dịch vụ ngoài.
- Export luôn sang file mới/phiên bản mới, giữ nguyên nguồn. Đo file thực và xem/nghe nội dung trước khi gọi là hoàn tất chất lượng.

## Quota, tài khoản, proxy và cài đặt

`doctor` cho trạng thái kết nối tổng hợp; không suy ra còn quota từ `healthy`, `enabled` hoặc `capacity`.

Đọc tài khoản bằng cách capture JSON, không in raw account records. Ví dụ tóm tắt tổng hợp:

```powershell
$museAccounts = node $museCli accounts list | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Không đọc được danh sách tài khoản Muse.' }
$museAccounts.stats | ConvertTo-Json -Depth 5
```

Mỗi bản ghi có `quotaAvailability` do server tính:

| Trạng thái | Ý nghĩa |
|---|---|
| `available` | Còn hạn mức tuần |
| `extra_only` | Hết tuần nhưng còn token bổ sung |
| `exhausted` | Hết cả tuần lẫn bổ sung |
| `weekly_exhausted` | Hết tuần, dữ liệu bổ sung chưa rõ |
| `unknown` | Chưa đủ dữ liệu để kết luận |

`weeklyRemainingPct` là phần còn lại, `weekly_used_pct` là phần đã dùng. `checkedAt`/`stale` cho độ mới; cache quá 1 giờ bị đánh dấu cũ. Không quy đổi token thành số video. Không dùng số đếm của lần làm việc cũ làm trạng thái hiện tại.

Khi người dùng muốn cập nhật quota, dùng `accounts quota ACCOUNT_ID` với ID đọc được, capture response và chỉ báo số lượng/thời điểm/lỗi tổng hợp; xử lý tuần tự, không tự generation. `accounts list` có phân trang mặc định: so `accounts.length` với `total`; nếu thiếu trang, dùng API web `/api/admin/accounts?offset=...&limit=...` để đọc đủ, capture và lọc đầu ra tương tự. Không bịa cờ `--quota` cho CLI.

Các lệnh quản trị có trong `help`: `accounts login/login-status/login-cancel/add/update/cookies/test/keepalive/delete`, `proxies list/add/update/test/test-draft/delete`, `settings [update FILE]`. Chỉ thay tài khoản/proxy/cookie/cài đặt khi người dùng yêu cầu tương ứng. Nhận credentials từ file riêng hoặc stdin, không đặt chúng trên command line, không log/commit. Không in account records kể cả response đã được backend lọc.

## Hàng đợi và thư viện

- `projects` → `show PROJECT_ID`/`status PROJECT_ID` để chọn đúng dự án, không mặc định dự án gần nhất.
- `pause PROJECT_ID` dừng cấp việc mới; `cancel JOB_ID` xử lý job web được chọn, `task-cancel MUSE_TASK_ID` hủy backend theo ID. Không đồng nhất pause với hủy mọi job đang chạy.
- `library` đọc kho backend, `local-library` đọc nguồn/thành phẩm local. Khi tìm nội dung, dùng filter của `library` trong `help`/CLI hiện tại.
- `library-delete NAMES_FILE` xóa tên tệp backend được chỉ định rõ. Chỉ dùng khi được yêu cầu xóa đúng đối tượng; không dùng xóa cache như bước khắc phục lỗi mặc định.
- Tests của app dùng backend giả. Khi sửa app, theo AGENTS.md và chạy kiểm tra phù hợp; sử dụng skill này không tự cho phép live generation để test.
