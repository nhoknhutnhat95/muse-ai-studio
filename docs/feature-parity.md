# Đối chiếu Muse AI Studio 4.1.2 → Web 0.3

Ngày kiểm chứng: 2026-11-11. Nguồn: UI app trên máy, OpenAPI backend cài đặt, REA static inspection bytecode Python (không chạy bytecode trích xuất). Từ 2026-11-12 backend chạy độc lập bằng Muse2API MIT ghim commit, có adapter riêng; không dùng executable/bytecode/license desktop. Kiểm thử v0.3 sử dụng generation giả, chưa chạy clip trả phí mới.

| Luồng desktop | Web/CLI | Xác minh |
|---|---|---|
| Kịch bản video text/image | Xưởng video, import/run/wait/export | Fake backend integration; clip Muse thật10giây của v0.1 giữ nguyên |
| Đồng bộ nhân vật | 12slots,6refs/scene,@ImageN,identity,text-only,presetroles,persistproject | REA scene_refs + slot renumber/cycle tests + browser draft preview |
| Xưởng ảnh | TXT/JSONbatch,5ratios,multirefs,3prompttemplates,retry,quickassignAffiliate | Schema/queue tests, browser page |
| Affiliate1sảnphẩm | Manual/template/AI,4/5lines,2/3clips,product/KOL/detail,anchorframe | Preserved narration, grouping, mocked onechat/no media submission |
| Affiliatebatch | Folder/info.txt/JSON,per-product errors,sharedKOL | Fixturefoldertests, browser batchform |
| KOLpresets | 3 installed localJPEGs withsafeIDs; import to webassets | REA resource path, allowlisted assettests |
| Chuẩn bị tham chiếu | Portrait720×1280, fit subject overblur, main/detail60/40 | RealFFmpegfixture/pixelchecks; originals unchanged |
| Duyệtảnh / QC | all/manual; flagged auto localpixelQC, clean autoapproved, suspicious held | Ratio/blank/border/duplicate/productcolor + queuegating tests |
| Tạo lại ảnh nghi ngờ | Reject/retry hoặc opt-in auto repair0–2lần; một job/cảnh, lưu các bản cũ | Store/queue tests; no automatic charged repair loop |
| TTS | EdgeTTSMP3/SRT,5Vi/Enpresets,rate/pitch/volume | Pinnedruntime/APIavailable, mocked enqueue; online voice NOT live tested |
| Dựngvideo | Completedprojectclips or importedclips, selectedorder,transitions,audio/subtitles | ActualFFmpegdecode,pixelorder/audio/rotationtests |
| Nhạc nền | 8 installedtracks,uploadedmusic,loop/duck/gains | REA shorts_composer + fixturemix |
| Hậu kỳ | Silenceedge trim,speed,loudness,audiofade,60fpsopticalflow,resize | ActualFFmpegfixturetests; resizeLanczos, notAIsuper-resolution |
| Tiếnđộ | PersistentMuse/localqueues, cancel/retry/pause, unknown reconcile | Recovery, no duplicatePOST, concurrentpause/canceltests |
| Thưviện | Backendcache + weboutputs/audio/renders,search/filter/sort/download/deletecache | Fakebackend tests, readonlyinstalledcache1363files |
| Tàikhoản | Đăng nhập batch bằng mã nhập/password/2FA/link OTP, cửa sổ thủ công, cookie import, quota/test/keepalive, CRUD | REA auth/claim flow; fake browser/backend tests and UI; no real login mutation |
| Proxy | Maskedlist,create/edit/delete,test,HTTP/SOCKS5/IPv6 | Mockedtests; no installedconfig changed |
| Càiđặt | Webdefaults,queue1–8,timeout60–1800,librarypreferences | SQLitemerging/persistence; imagebackendtimeoutcapped600 |
| CLI | JSONcommands for all above; planimport,batchimport,assetupload/mediawait/download | CLI/HTTP integration, help/schema/doctor |

## Khác biệt có chủ ý và giới hạn còn lại

- **Đăng nhập tài khoản**: web có browser worker riêng cho password/2FA/OTP và thủ công, sau đó lưu phiên qua `/admin/accounts`. Nhận mã nhập shop theo giao thức quan sát tĩnh từ app; không mua tài khoản hoặc thay đổi license. CAPTCHA/checkpoint cần người dùng tự xử lý. Chưa kiểm thử đăng nhập thật hoặc mọi nhà cung cấp OTP; hòm thư không được hỗ trợ dùng cách thủ công. Không sao chép bytecode app vào production.
- **Automatic image repair**: chọn trước `autoRepairAttempts:0|1|2` trong bản nháp. Mặc định0 (thủ công); bật1/2 sẽ dùng thêm lượt ảnh khi chạy batch có cờ kỹ thuật. Vòng lặp có giới hạn, giữ bản cũ và không retry POST chưa rõ. Cờ pixel có thể dương tính giả; có nút duyệt thủ công.
- QC pixel không nhận diện lỗi mặt/tay/chữ hoặc xác minh công dụng. Cần QC nội dung độc lập. Các thông số kỹ thuật thành công không chứng minh chất lượng nội dung.
- Thư viện web đọc backendcache và thành phẩm web; không tự quét mọi thư mục tải tùy chỉnh của desktop. Muốn dựng clip ngoài hai kho này, nhập chúng trong trang dựng phim/CLI.
- Settings của desktop giữ nguyên; web quản lý queue/output riêng. Tải/xuất thành phẩm tới vị trí tùy chọn bằng browserdownload hoặc `media download --out`.
- Không sao chép nguyên thuật toán novelty/history scoring, speech-boundary tuning hoặc proprietaryfallbacks. Kịch bản manual luôn giữ nguyên, bảnAI/template luôn có bước duyệt.
- Web cần backendMuse; inference và EdgeTTS cần dịch vụ mạng tương ứng. FFmpeg/QC/chuẩn bịảnh hoạt độnglocal.

## Bằng chứng chi tiết

- `research/backend-openapi.json`, `research/backend-contract.md`
- `research/character-ui-evidence.json`, `research/image-ui-evidence.json`, `research/scene-refs-evidence.json`
- `research/affiliate-parity.md`, `research/admin-parity.md`, `research/media-parity.md`
- `docs/verification.md`: clip Musev0.1 thực tế và kiểm thử ban đầu.
- `docs/verification-v02.md`: kết quả bản mở rộng, ảnh UI và runtime.

## Runtime độc lập v0.3

Launcher tự chuẩn bị Python portable + FFmpeg + Edge TTS. Backend tự chạy/dừng cùng web, key/profile/account store riêng trong data/backend. Thêm account/proxy, chọn tài khoản, nhiều ảnh, identity, thư viện và tiến độ giữ cùng contract. Hủy sau khi gửi không khẳng định đã hủy trên upstream; trạng thái không chắc chắn là unknown. Nguồn cài đặt, key, account và proxy của desktop không bị sửa. Preset KOL/nhạc chỉ sao chép local khi chủ máy nhập dữ liệu cũ; không đi theo Git.
