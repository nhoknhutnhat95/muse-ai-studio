---
name: muse-studio-web
description: "Viết kịch bản và vận hành Muse Studio Web trên máy qua CLI: nhập draft, tạo ảnh/video, Affiliate, lồng tiếng, dựng phim và kiểm tra quota. Dùng khi cần đưa nội dung vào Muse Web hoặc theo dõi kết quả. Không tự tiếp tục batch cũ; không áp dụng cho việc chỉ sửa giao diện/mã nguồn."
---

# Muse Studio Web

Viết nội dung theo brief rồi thực hiện đúng công đoạn người dùng yêu cầu. CLI và web dùng chung dự án; không tạo lại media để làm nó xuất hiện trên web.

## Tìm đúng bản web trên máy

1. Đọc [references/instance.json](references/instance.json): `root` là thư mục clone trên máy này, `url` là web local. Nếu `root` chưa được cài hoặc thư mục đã chuyển, chạy `Install-AI-Skills.cmd` từ bản clone hiện tại. Không đoán ổ D: hay dùng đường dẫn của người khác.
2. Đặt `MUSE_CLI` bằng **đường dẫn tuyệt đối đến `scripts/muse.mjs` cạnh SKILL.md này**. Chạy `node "MUSE_CLI" doctor`, thay MUSE_CLI bằng đường dẫn thực. Wrapper tự tìm CLI của repo đã cài và giữ nguyên thư mục làm việc của người dùng để đọc file tương đối đúng.
3. Đọc `README.md`, `schema/script.schema.json` và `AGENTS.md`/`CLAUDE.md` nếu có tại `root`. Cú pháp CLI hiện hành lấy từ `node "MUSE_CLI" help`.
4. Nếu web chưa chạy, dùng `Start-Muse-Web.cmd -NoBrowser` ở `root`. Windows cần Node 24+ và Chrome/Edge. Launcher tự chuẩn bị runtime; không cần Muse desktop. Không mở server thứ hai nếu web đang khỏe. Backend độc lập chưa sẵn sàng: đọc `doctor`, dùng Setup/Restart khi hết job, không tự đổi key/proxy.

## Quyền tạo nội dung

- “Viết”, “đẩy kịch bản”, “chuẩn bị” chỉ cho phép draft: `validate` → `import`. Import không tạo ảnh/video.
- Chỉ `run`/`retry` khi nội dung/batch tương ứng được yêu cầu tạo. Quyền đã có trong hội thoại thì tiếp tục trong phạm vi đó. Xem cả ảnh phụ thuộc vì chúng cũng dùng quota.
- Affiliate mode `ai` gửi nội dung sản phẩm tới Muse Chat; TTS gửi lời đọc tới Microsoft. Chỉ dùng cho công đoạn được yêu cầu.
- `review` có thể mở khóa video đang đợi. Chỉ duyệt khi đã xem ảnh và công đoạn tiếp theo thuộc batch được phép.
- Giữ nguyên lời đọc đã khóa, nguồn và thành phẩm cũ. Không tự chạy lại các dự án cũ khi vừa mở một chat mới.

## Từ brief đến draft

- Lấy chủ đề, đối tượng, thông điệp, tỷ lệ, thời lượng và lời đọc từ yêu cầu/hồ sơ dự án. Giữ `prompt` và `narration` tách biệt; không âm thầm đổi lời đọc.
- Lưu JSON UTF-8 trong dự án người dùng; nếu chưa có thư mục, dùng `workspaces/<ten-du-an>` dưới `root`. Mỗi cảnh có ID ổn định.
- Video: `16:9`, `9:16`; ảnh thêm `1:1`, `4:3`, `3:4`. Thời lượng là yêu cầu cho dịch vụ; đo lại thành phẩm. Tôn trọng schema hiện hành.
- Ảnh local dùng `image`/`images`, tương đối với file kịch bản. Tham chiếu cảnh dùng `scene:<id>`; tối đa 6 ảnh/cảnh, không tạo vòng phụ thuộc. Dùng `referenceMode:"identity"` khi cần giữ nhân vật; `reviewRequired:true` cho ảnh khóa cần duyệt.
- Mẫu [assets/character-script.json](assets/character-script.json) chỉ minh họa cấu trúc, không tự chạy. TXT coi mỗi dòng là một prompt; dùng JSON khi có lời đọc/metadata.

```text
node "MUSE_CLI" validate SCRIPT_FILE
node "MUSE_CLI" import SCRIPT_FILE
node "MUSE_CLI" run PROJECT_ID --dry-run
```

Thay các tên viết hoa bằng đường dẫn/ID thật. Nhập trùng trả về dự án có sẵn; dùng `--new-copy` chỉ khi cần bản khác. Lưu project ID từ response, không đoán theo tên. Cảnh đã có job khóa nội dung; tạo bản sao nếu cần sửa.

## Chạy và theo dõi

- Trước khi tạo, kiểm tra `doctor`, `status PROJECT_ID` và phạm vi `run --dry-run`.
- `run PROJECT_ID` hoặc `run PROJECT_ID --scene s001`. Mỗi cảnh một job; lưu riêng project ID, job ID, task ID và media job ID.
- Theo dõi `wait PROJECT_ID --timeout 45 --interval 5` rồi tiếp tục nếu còn chạy. Exit 2 chỉ là hết thời gian chờ; exit 3 cần duyệt ảnh; exit 1 phải đọc trạng thái lỗi, không tự gửi lại.
- Nếu POST hoặc generation có trạng thái `unknown`, giữ task ID, đọc `tasks`/`status`, đối chiếu đúng prompt/ID rồi mới `reconcile JOB_ID --task-id TASK_ID`. Không retry để thử vận may. Hủy local không chứng minh dịch vụ từ xa đã hủy hoặc hoàn quota.
- Chỉ retry failed/blocked/cancelled khi hiểu nguyên nhân và lượt mới nằm trong phạm vi được phép. `autoRepairAttempts:0` mặc định; chỉ tăng khi đã cho phép thêm lượt ảnh.
- Với công việc dài, lưu `muse-session.json` cạnh kịch bản: ID, trạng thái, phạm vi đã yêu cầu, file kết quả; không chứa cookie/tài khoản. Hồ sơ này không tự cấp quyền chạy batch khác.
- Khi xong: `export PROJECT_ID --out RESULT_FILE`. Dùng đường dẫn trả về. Nếu tương đối, ghép với thư mục dữ liệu đã xác minh (`MUSE_DATA_DIR` nếu có, mặc định `root/data`).
- Kiểm tra kỹ thuật riêng với QC nội dung. File mở được/task thành công/QC pixel sạch không chứng minh clip đúng nội dung.
- Bàn giao trạng thái, link `url/?project=PROJECT_ID_THUC` và file kết quả. Dự án nằm ở sidebar phải. TTS/render cần đúng `projectId` để thành phẩm hiện trong dự án; file dựng hoàn toàn bên ngoài không tự được nhập.

## Luồng mở rộng và tài khoản

Đọc [references/operations.md](references/operations.md) khi làm Affiliate, slot nhân vật, TTS/render, thư viện, quota hoặc quản trị tài khoản/proxy. Ưu tiên CLI, dùng công cụ trình duyệt được hỗ trợ khi cần xem trang/media.

Không in API key, cookie hay bản ghi tài khoản. Chỉ quản trị đăng nhập/proxy theo yêu cầu tương ứng; không đọc credential để chẩn đoán thông thường. Chỉ báo tổng hợp quota, phân biệt phiên hợp lệ với còn lượt và dữ liệu quota cũ. Skill không mang phiên đăng nhập: máy mới tự thêm tài khoản trong web. `data/backend` chứa phiên/key, không commit hoặc chia sẻ nguyên thư mục.
