# Muse Studio Web · v0.3

Web local và CLI cho quy trình **Codex viết kịch bản → duyệt bản nháp → Muse tạo ảnh/video → lồng tiếng và dựng thành phẩm**.

Mở **http://127.0.0.1:3210**. Khởi động bằng `Start-Muse-Web.cmd`. **Không cần cài hoặc mở Muse AI Studio desktop.** Windows x64, Node.js 24+ và Chrome/Edge; launcher tự cài runtime riêng. Tạo ảnh/video vẫn dùng dịch vụ Muse trực tuyến và tài khoản hợp lệ còn quota.

## Chạy lần đầu trên máy Windows khác

1. Cài **Node.js LTS phiên bản 24 trở lên** bằng Windows Installer (`.msi`) từ [nodejs.org](https://nodejs.org/en/download). Đóng/mở lại terminal sau khi cài; `node --version` phải hiện `v24` trở lên.
2. Clone hoặc giải nén **toàn bộ mã nguồn**, rồi bấm `Start-Muse-Web.cmd` trong thư mục đó. Launcher tự cài thành phần đăng nhập, Python portable, FFmpeg/FFprobe và Edge TTS; lần đầu cần Internet và vài phút. Các bản tải runtime được kiểm SHA-256, dependency Python được khóa phiên bản/hash. Web tự tạo thư mục dữ liệu; hỗ trợ đường dẫn có dấu/khoảng trắng.
3. Mở **Tài khoản → Thêm tài khoản** trên web để đăng nhập tài khoản của máy nhận. Có thể chạy `Setup-Muse-Web.cmd` riêng để cài/sửa runtime. Backend, cookie và profile chạy riêng; không đọc cài đặt/license của Muse desktop.

Nếu lỗi, launcher giữ cửa sổ để đọc thông báo: thiếu Node.js, Node quá cũ, SQLite không dùng được, hoặc cổng đang bận. Lỗi máy chủ có đường dẫn `server-error.log` để kiểm tra. Nếu dùng bản launcher cũ chỉ chớp rồi tắt, mở CMD tại thư mục clone rồi chạy `Start-Muse-Web.cmd` để thấy lỗi, sau đó cập nhật mã nguồn.

FFmpeg tải khoảng **110 MB**. Bộ cài hiện số MB, phần trăm và tốc độ mỗi 3 giây; ưu tiên GitHub của nhà phát hành, chuyển nguồn nếu 30 giây không nhận dữ liệu. File tải dở được giữ để tiếp tục và luôn kiểm SHA-256 trước khi giải nén. Nếu bản cũ dừng lâu ở `Downloading www.gyan.dev ...`, đóng cửa sổ cài đó, chạy `git pull --ff-only` rồi mở lại `Start-Muse-Web.cmd`. Bộ cài tự phục hồi khóa của phiên cài đã dừng; không mở hai cửa sổ cài cùng lúc.

Launcher mặc định dùng cổng `3210`. Có thể đặt `MUSE_PORT` (1–65535), `MUSE_DATA_DIR` (thư mục dữ liệu riêng) hoặc `MUSE_NODE` (đường dẫn đầy đủ đến `node.exe` bản portable). `Start-Muse-Web.cmd -NoBrowser` khởi động mà không mở trình duyệt. Mở lại launcher khi server sẵn sàng sẽ dùng lại server đang chạy trên cổng đó.

Sau khi cập nhật bằng `git pull --ff-only`, chạy **`Restart-Muse-Web.cmd`** để nạp mã mới rồi tải lại trang. Lệnh chỉ dừng đúng server thuộc thư mục hiện tại; từ chối khởi động lại khi còn job tạo media, hậu kỳ hoặc đăng nhập chưa xong. Có thể thêm `-NoBrowser` nếu không cần mở trình duyệt.

**Giao diện dashboard đen trắng:** mở trang chủ để xem Tổng quan với số dự án, cảnh đã tạo, hàng đợi, mục cần duyệt và tiến độ thực tế. Nút mặt trăng/mặt trời trên thanh đầu đổi sáng/tối, nút cạnh breadcrumb thu gọn menu trái; lựa chọn được nhớ riêng trong trình duyệt. Thiết kế tham khảo [Studio Admin / next-shadcn-admin-dashboard](https://github.com/arhamkhnz/next-shadcn-admin-dashboard), triển khai trực tiếp trên web hiện có, không thêm bước build Next.js. Tất cả bảng, biểu mẫu và trạng thái tài khoản dùng chung giao diện trung tính; trạng thái vẫn có nhãn và thanh hạn mức rõ ràng.

**Dự án** có sidebar riêng bên phải, có tìm kiếm, vùng cuộn độc lập và tự cập nhật từ Codex/CLI. Trên màn hình hẹp, bấm **Dự án** ở thanh trên để mở danh sách từ bên phải; điện thoại có menu điều hướng riêng bên trái. Các sidebar hỗ trợ Escape và giữ focus bàn phím bên trong khi mở. Mở thẳng dự án bằng `http://127.0.0.1:3210/?project=PROJECT_ID`; nút **Sao chép link** lấy đúng địa chỉ. Bản dựng có `projectId` hiện ngay trong **Video thành phẩm** phía trên storyboard để xem/tải; các clip nguồn vẫn nằm theo từng cảnh. Video dựng ngoài Muse Web không tự nhập vào danh sách này.

## Chức năng

| Khu vực | Đã triển khai |
|---|---|
| Kịch bản | JSON/TXT, giữ lời đọc, thêm/sửa cảnh, đổi tên, nhân bản, xuất JSON, khóa cảnh đã có job |
| Video | Text-to-video, image-to-video, chọn tài khoản hoặc tự xoay tua, thời lượng/tỷ lệ/song song |
| Đồng bộ nhân vật | 12 ô ảnh, tối đa 6 ảnh mỗi cảnh, chọn bằng @ImageN, preset vai trò, text-only hoặc identity |
| Xưởng ảnh | Batch prompt, 5 tỷ lệ, nhiều ảnh tham chiếu, mẫu Creator/Packshot/Detail, gán kết quả sang Affiliate |
| Affiliate | Một sản phẩm/batch thư mục hoặc JSON, manual/template/Muse Chat, 4–5 câu, 2–3 clip, ảnh khóa nhân vật, storyboard có thể sửa |
| KOL / ảnh sản phẩm | KOL đã nhập riêng vào web, upload riêng, chuẩn hóa ảnh dọc, ghép sản phẩm/chi tiết 60/40 |
| Duyệt ảnh | Gate ảnh trước video, duyệt/từ chối, tạo lại thủ công hoặc opt-in0–2lần; kiểm tra kỹ thuật tại máy |
| Lồng tiếng | Edge TTS, MP3 và SRT, 5 preset Việt/Anh, chỉnh tốc độ/cao độ/âm lượng |
| Dựng phim | Clip dự án hoặc video nhập riêng, thứ tự cảnh, nhạc nền/upload, kho nhạc đã nhập riêng, giảm nhạc khi có lời, phụ đề, chuyển cảnh |
| Hậu kỳ | Trích frame, tốc độ, cắt khoảng lặng, cân âm lượng, 24/25/30/60fps, nội suy quang học, 720p/1080p/4K Lanczos |
| Hàng đợi | SQLite bền vững, pause/cancel/retry, tải media tự động, đối chiếu POST chưa rõ, hủy tác vụ Muse theo ID |
| Thư viện | Kho backend và thành phẩm local, tìm/lọc/sắp xếp, xem/tải, xóa tệp backend được chọn rõ |
| Tài khoản / proxy | Thêm bằng mã nhập, email/mật khẩu/2FA, link OTP hoặc trình duyệt thủ công; cookie đơn/batch, quota, test/keepalive, bật/tắt, chỉnh tên/gán proxy, CRUD |
| Cài đặt | Mặc định dự án, giới hạn hàng đợi web, timeout, tùy chọn thư viện; lưu riêng trong SQLite web |

Bảng bằng chứng và giới hạn: [docs/feature-parity.md](docs/feature-parity.md). Từ v0.3, web quản lý backend [Muse2API nguồn mở (MIT)](https://github.com/czg86389-hub/muse2api) riêng. Đây là ứng dụng local độc lập với Muse desktop; mô hình tạo media vẫn nằm ở dịch vụ Muse, không phải mô hình offline. Mã upstream được ghim commit trong `vendor/muse2api/UPSTREAM.md`.

## Cài skill cho Codex hoặc Claude Code trên máy khác

Trong thư mục clone, mở CMD và chạy:

```cmd
git pull --ff-only
Install-AI-Skills.cmd
```

Mặc định cài cho cả hai. Chỉ cài một bên: `Install-AI-Skills.cmd codex` hoặc `Install-AI-Skills.cmd claude`. Installer cần Node đã có trên máy, không cần web đang chạy; tự ghi đường dẫn thư mục clone vào cấu hình skill. Nếu chuyển vị trí repo, chạy lại installer. Khi `git pull` cập nhật skill, chạy lại installer để nhận hướng dẫn mới. File skill cũ được sao lưu ở `skill-backups` bên cạnh thư mục `skills`; không đụng các skill khác.

- **Codex:** cài user skill vào `%USERPROFILE%/.agents/skills/muse-studio-web`. Nếu đã có skill này ở đường dẫn cũ `%USERPROFILE%/.codex/skills`, cập nhật ngay tại đó để tránh trùng tên. Thư mục hiện hành được đối chiếu từ [tài liệu OpenAI](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills).
- **Claude Code local:** cài vào `%USERPROFILE%/.claude/skills/muse-studio-web`, theo [tài liệu Claude Code](https://code.claude.com/docs/en/skills#choose-where-skills-load). Cài này dành cho công cụ chạy local có quyền gọi CLI trên máy.

Mở chat mới sau khi cài. Trong Codex: **`$muse-studio-web`**; trong Claude Code: **`/muse-studio-web`**. Thử: “Dùng muse-studio-web kiểm tra kết nối, rồi nhập bản nháp kịch bản 3 cảnh về vườn cây, chưa tạo video.” Skill không cấp thêm quyền shell hoặc tự bỏ qua việc duyệt thao tác của công cụ AI.

Máy mới vẫn cần mở `Start-Muse-Web.cmd` và thêm tài khoản riêng để tạo media. Bộ skill chỉ gồm hướng dẫn, mẫu JSON và wrapper CLI; không chứa cookie, key, dự án hay video. Web dùng cổng khác thì cài với `Install-AI-Skills.cmd -Agent both -WebUrl http://127.0.0.1:3211`.

## Dùng từ Codex / Claude Code

CLI: `muse.cmd` trong thư mục clone hoặc `node <thu-muc-clone>/bin/muse.mjs`. Tất cả lệnh trả JSON. Lỗi qua stderr và exit code 1.

```powershell
.\muse.cmd doctor
.\muse.cmd init --out kich-ban.json
.\muse.cmd validate kich-ban.json
.\muse.cmd import kich-ban.json
.\muse.cmd run PROJECT_ID --dry-run
.\muse.cmd run PROJECT_ID
.\muse.cmd wait PROJECT_ID
.\muse.cmd export PROJECT_ID --out ket-qua.json
```

`import` chỉ tạo draft. `run` sử dụng lượt tạo media. `affiliate plan/batch` mode `ai` gọi Muse Chat; `media tts` gửi lời đọc đến dịch vụ giọng nói Microsoft. Chỉ gọi những lệnh này khi batch tương ứng đã được người dùng cho phép. Chuẩn hóa ảnh, QC và dựng phim bằng FFmpeg xử lý tại máy.

`wait` exit 2 khi timeout, exit 3 khi cần duyệt ảnh, exit 1 khi kết thúc không thành công. Xem `needsReview` rồi dùng `muse review JOB_ID`; từ chối bằng `--reject --note "..."`, chủ động `muse retry JOB_ID` để tạo lại ảnh đã từ chối. Tác vụ `unknown` phải đối chiếu bằng `muse reconcile JOB_ID --task-id task_xxx` trước, tuyệt đối không tự POST lại.

## Kịch bản và nhiều ảnh

Đọc [schema/script.schema.json](schema/script.schema.json). Ví dụ:

```json
{
  "title": "Một nhân vật, hai cảnh",
  "settings": {"size":"16:9","duration":10,"concurrency":2},
  "scenes": [
    {"id":"master","kind":"image","prompt":"Create a reference portrait...","reviewRequired":true},
    {"id":"s001","kind":"video","prompt":"Animate the reference...","reference":"scene:master","narration":"Lời đọc nguyên văn."}
  ]
}
```

- TXT: mỗi dòng không rỗng là một prompt; không tự biến văn xuôi thành shot list.
- Video: `16:9`, `9:16`. Ảnh thêm `1:1`, `4:3`, `3:4`.
- `duration`: yêu cầu 1–30 giây; độ dài thực tế do Muse quyết định.
- `reference` và `references`: asset ID hoặc `scene:<id>` của một cảnh ảnh. Đồ thị phụ thuộc không được có vòng lặp; mỗi cảnh tối đa 6 ảnh.
- CLI nhận `image:"./file.png"` hoặc `images:["./front.png","./side.png"]`; đường dẫn tính từ file kịch bản. Ảnh được upload local trước khi nhập.
- `referenceMode`: `first_frame` hoặc `identity`; `accountId` tùy chọn, null dùng tự động.
- `reviewRequired:true` trên ảnh giữ các cảnh phụ thuộc cho đến khi duyệt.
- `metadata` giữ nguyên storyboard và cấu hình workflow. Cảnh đã có job khóa nội dung, hãy nhân bản để sửa.
- Nhập cùng kịch bản trả lại dự án có sẵn. `--new-copy` mới tạo bản sao; nhiều lần `run` không tạo job trùng.

## Workflow và Affiliate qua CLI

```powershell
.\muse.cmd workflow workflow-spec.json --out plan.json
.\muse.cmd import plan.json
.\muse.cmd affiliate options
.\muse.cmd affiliate presets
.\muse.cmd affiliate preset female_reviewer
# Lệnh trên trả asset tham chiếu KOL
.\muse.cmd media upload product.png
.\muse.cmd affiliate plan affiliate-spec.json --out plan.json
.\muse.cmd affiliate folder D:\SanPham --out plans.json
.\muse.cmd affiliate import-batch plans.json
```

`workflow` nhận `{kind:"image"|"video"|"character",title,prompts,size,duration,slots:[{image:"./a.png"}],textOnly,referenceMode}`. Mỗi dòng prompt một cảnh. `@ImageN` chọn slot, được đổi số đúng với thứ tự ảnh gửi Muse. Plan trả `{document,warnings}`; `import` nhận trực tiếp file plan này.

Affiliate spec gồm `product:{name,usp,description,category,offer}`, `references:{product,kol?,detail?}` (asset IDs), `mode:"manual"|"template"|"ai"`, `sceneCount:4|5`, `manualScript` hoặc `lines`, `voicePersona`, `reviewMode`, `autoRepairAttempts:0|1|2` (mặc định0). Xem `affiliate options` để lấy enum và preset mới nhất từ bản cài. Mode mẫu chỉ dùng các thông tin bạn cung cấp; mode AI cần duyệt lại các khẳng định sản phẩm.

Mỗi thư mục con của batch là một sản phẩm: ảnh `main`/`product`, `detail` tùy chọn, `kol` tùy chọn, `info.txt` với các khóa `name`, `usp`, `prod_desc`, `char_desc`, `template`, `persona`, `scene_count`, `review_mode`. CLI chỉ tạo kế hoạch, `import-batch` chỉ nhập draft, không tự chạy video.

`muse affiliate qc PROJECT_ID` chạy QC pixel local và trả cờ. Thêm `--apply` để duyệt ảnh sạch/giữ ảnh nghi ngờ. Chế độ `flagged` thực hiện bước này tự động; sửa ảnh bằng generation chỉ tự chạy nếu đã chọn `autoRepairAttempts` trong draft trước khi `run`.

## Lồng tiếng và dựng phim qua CLI

```powershell
.\muse.cmd media capabilities
.\muse.cmd media voices
.\muse.cmd media tts voice-spec.json
.\muse.cmd media wait MEDIA_JOB_ID
.\muse.cmd media render render-spec.json
.\muse.cmd media wait MEDIA_JOB_ID
.\muse.cmd media download MEDIA_JOB_ID --out thanh-pham.mp4
```

`voice-spec.json`: `{ "projectId":"...", "voice":"vi-VN-HoaiMyNeural", "rate":0 }`. Bỏ `text` để dùng lời đọc trong dự án; có thể truyền `text` riêng.

`render-spec.json`: `{ "projectId":"...", "sceneIds":["s001"], "resolution":"1080p", "fps":30, "narrationJob":"...", "captions":true, "musicGain":0.12, "originalGain":0, "duckMusic":true, "transition":{"type":"fade","duration":0.35} }`.

Có thể thay project/sceneIds bằng `videoAssets:["asset:..."]` để ghép video tải lên theo đúng thứ tự. `media upload FILE` trả asset; tối đa 250 MB/tệp. Nhạc dùng `musicAsset` hoặc `bundledMusicId` lấy từ capabilities. `speed`, `trimSilence`, `normalizeLoudness`, `fadeEdges`, `interpolate` là các tùy chọn hậu kỳ. Phụ đề có thể là SRT string hoặc `true` dùng SRT của TTS. Lời đọc dài hơn tổng clip báo lỗi, không âm thầm cắt lời.

`media frame frame-spec.json` với `{sourceJobId|mediaJobId,seconds}` trả job tạo ảnh tham chiếu. `media references refs-spec.json` với `{productAsset,kolAsset?,detailAsset?}` tạo ảnh dọc và composite; truyền các object bằng file JSON. Kết quả nằm trong `result.references`. Các job local bị gián đoạn khi tắt server cần `media retry ID` chủ động.

## Quản trị

`muse help` liệt kê đủ lệnh `accounts`, `proxies`, `settings`, `library`, `local-library`, `tasks`, `task-cancel`, `review`, `retry`, `cancel`, `reconcile`. Lệnh thay đổi nhận body từ JSON file hoặc stdin `-`, để không đặt cookie trên command line. Không in cookie/proxy password; mọi response quản trị được lọc whitelist. File chứa credentials do người dùng quản lý, không đưa vào Git.

Nhập tài khoản/cookie và quản trị proxy chỉ thay đổi backend Muse khi người dùng chủ động gửi. Kích hoạt license, mua tài khoản và thiết lập của desktop vẫn thực hiện trong app gốc; web không tự sửa các phần này khi cài đặt/nâng cấp.

### Thêm tài khoản từ web hoặc CLI

Trong **Tài khoản → Thêm tài khoản**, chọn:

- **Dán dữ liệu đăng nhập**: mỗi dòng là mã nhập Muse Studio đã có, `email|mật_khẩu[|2FA]`, hoặc `email|link_OTP`; cũng nhận file TXT. Chuỗi 2FA là khóa bí mật Base32, không phải mã 6 số. Email đơn được thử hòm thư HTTPS cùng tên miền; nếu hòm thư không hỗ trợ, dùng cách thủ công.
- **Tự đăng nhập trong trình duyệt**: đặt tên rồi mở cửa sổ Chrome/Edge riêng trên máy chạy web. Bạn nhập thông tin và tự xử lý OTP/xác minh. Web chỉ lưu sau khi cookie Muse và `/api/session` xác nhận đăng nhập. Đóng cửa sổ hoặc bấm Dừng để hủy.
- **Nhập cookie**: giữ cách nhập cookie đơn/batch trước đây.

Web xử lý tối đa 100 tài khoản, lần lượt trong một lượt đăng nhập; có tiến độ và kết quả từng dòng. Trùng tên/email thì bỏ qua, không thay phiên đã có. Mất phản hồi khi lưu được đánh dấu **cần đối chiếu**, dừng các tài khoản còn lại và không tự gửi lại. Khởi động lại web không tự tiếp tục đăng nhập.

Mật khẩu, khóa 2FA, mã nhập và link OTP chỉ giữ trong bộ nhớ lúc xử lý; không ghi vào SQLite, log hay localStorage. Cookie phiên hợp lệ được gửi một lần đến backend Muse để lưu tài khoản theo thao tác của bạn. Hộp thư OTP dùng HTTPS công khai, không theo redirect hoặc đọc mạng nội bộ. Mã nhập gửi đến API shop đã quan sát từ app gốc. CAPTCHA/checkpoint được chuyển sang cách thủ công, không giải tự động.

```powershell
.\muse.cmd accounts login-capabilities
.\muse.cmd accounts login login-input.json
.\muse.cmd accounts login-status JOB_ID
.\muse.cmd accounts login-cancel JOB_ID
```

JSON tự động: `{ "mode":"batch", "text":"...", "requestId":"UUID tùy chọn" }`. JSON thủ công: `{ "mode":"manual", "label":"Tên tài khoản" }`. Có thể thêm `proxy_id`; lỗi proxy dừng đăng nhập, không tự đổi sang IP trực tiếp. Không đưa file đầu vào chứa thông tin đăng nhập vào Git; CLI cũng nhận `-` để đọc JSON qua stdin. Lưu `id` nhận được rồi kiểm tra trạng thái, không gửi lại batch khi chưa rõ kết quả.

Cần Chrome hoặc Edge cài trên máy chạy server. Có thể dùng `MUSE_BROWSER_EXE` để trỏ đến trình duyệt Chromium riêng, và `MUSE_PROXY_FILE` nếu Muse lưu danh mục proxy ở vị trí khác. SOCKS5 có username/password chưa được hỗ trợ cho đăng nhập. Chạy `npm ci --ignore-scripts` thủ công nếu launcher chưa chuẩn bị được thành phần đăng nhập.

Các bước đăng nhập được đối chiếu với REA của Muse 4.1.2 và kiểm thử bằng backend/trình duyệt giả. Chưa dùng tài khoản thật để xác minh mọi nhà cung cấp OTP hoặc giao diện đăng nhập từ xa; nếu form/nhà cung cấp thay đổi, dùng đăng nhập thủ công. Không tuyên bố đã đăng nhập thật chỉ từ kiểm thử giả.

## Runtime, dữ liệu và kiểm tra

- `data/studio.sqlite`: kịch bản, job Muse, job hậu kỳ, duyệt ảnh, cài đặt, sự kiện.
- `data/assets/`, `data/outputs/`, `data/media-jobs/`: nguồn và thành phẩm; không ghi đè clip gốc khi dựng.
- `data/backups/`: bản sao SQLite trước nâng cấp v0.2.
- `data/backend/`: tài khoản, proxy, key, profile và media của backend độc lập. Browser chỉ nhận trạng thái đã lọc; không nhận key/cookie.
- Web bind `127.0.0.1`, kiểm tra Host/Origin và header cho mutation, không mở ra mạng LAN.
- `tools/rea`: công cụ REA khảo sát độc lập. Bằng chứng nằm trong `research/`.
- `tools/standalone/`: Python portable, thư viện Python và FFmpeg; tự chuẩn bị bằng launcher, không lấy từ app Muse.
- `data/presets/`: KOL/nhạc người dùng nhập. Máy clone mới dùng ảnh/nhạc riêng; không phân phối tài nguyên của app desktop.

```powershell
.\Setup-Muse-Web.cmd
npm.cmd test
npm.cmd run check
```

Backend mặc định chạy ẩn, tự chọn cổng loopback, tự dừng khi web dừng. Trình duyệt tạo media chỉ mở khi cần, dùng profile riêng và giữ sandbox. `MUSE_BACKEND_MODE=desktop` hoặc `MUSE_BACKEND_URL` là chế độ tương thích tùy chọn, dùng backend ngoài như phiên bản cũ. `MUSE_RUNTIME_DIR`, `MUSE_PYTHON`, `MUSE_FFMPEG`, `MUSE_FFPROBE` cho phép chọn runtime riêng; không đặt biến này nếu dùng bộ cài tự động.

### Chuyển dữ liệu desktop hiện có

Khi web độc lập chưa có tài khoản, chạy `npm.cmd run migrate:desktop` trên máy có Muse desktop. Lệnh sao chép tài khoản/proxy, lịch sử, thư viện media và preset sang `data/`, không thay đổi bản gốc; từ chối nếu nguồn còn tác vụ đang chạy hoặc đích đã có dữ liệu. Tắt backend độc lập trước khi nhập. Phiên cookie vẫn chịu hạn sử dụng của Muse; không có cơ chế kéo dài giả.

Tác vụ bị gián đoạn sau khi gửi được giữ `unknown`; không xoay tài khoản và tự gửi lại. Hủy khi đã gửi chỉ dừng theo dõi local, không bảo đảm dịch vụ đã hủy hoặc hoàn quota. Kiểm tra/giữ phiên và quota thực hiện bằng các nút/lệnh quản trị tương ứng.

Tests dùng backend giả và video/ảnh giả lập; FFmpeg được chạy thật. Không gọi generation, quota mutation hoặc TTS online trong tests. Clip thử Muse 10 giây đã hoàn tất từ đợt v0.1; kết quả vẫn giữ nguyên. Thành công kỹ thuật không chứng minh nội dung đạt chất lượng.

## Git và chia sẻ mã nguồn

Git chỉ lưu mã nguồn web/CLI, schema, ví dụ, kiểm thử và tài liệu chức năng. `data/` (SQLite, kịch bản, ảnh/video, lịch sử), `research/`, runtime trong `tools/`, log, file credentials, ảnh kiểm chứng và `AGENTS.md` cá nhân được bỏ qua. Kiểm tra `git status` trước mỗi commit; `.gitignore` không ngăn việc đưa bí mật vào một file mã nguồn đang được theo dõi.

Khi chia sẻ, dùng `git clone` hoặc `git archive` từ commit đã kiểm tra. **Copy/nén nguyên thư mục trên ổ đĩa vẫn mang theo các file bị Git bỏ qua.** Máy nhận cần Node.js 24+, Chrome/Edge và tài khoản Muse của chính họ; không cần Muse desktop. **Từ v0.3, phiên đăng nhập của web nằm trong `data/backend/` và sẽ đi theo nếu copy toàn bộ thư mục ổ đĩa.** `git clone`/`git archive` không mang theo `data/`, cookie, profile hay key.
