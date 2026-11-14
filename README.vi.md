<p align="center"><img src="apps/web/public/brand/toura-logo.png" alt="Toura" width="200"></p>

# Toura — MVP (tiếng Việt)

> English: [README.md](README.md)

Trợ lý AI du lịch Vũng Tàu: tìm địa điểm **thật** (OpenStreetMap), lên lịch trình vài giờ tới bằng chat, **thanh toán USDC trên Arc testnet** bằng ví Circle (chỉ cần mã PIN). Mỗi điểm trả theo cách của quán đó: quán nhận đặt chỗ thì **trả trước** vào ký quỹ trong **một giao dịch** (đến nơi mới giải ngân, không đến thì hoàn tiền); quán đối tác không cần đặt chỗ thì **trả tại quán** (quét mã QR của quán, nhập số tiền trên hoá đơn); quán chưa là đối tác thì **tự trả** (chỉ hiện giá ước tính).

> ⚠️ Testnet only. USDC testnet không có giá trị thật. Giá địa điểm là ước tính cho demo.

```
apps/web/      Next.js 15 (App Router) + Tailwind 4 + Prisma/SQLite + MapLibre
contracts/     Foundry — TouraEscrow.sol (+ tests, deploy script)
apps/web/data/ vungtau_pois.json (18 POI, toạ độ/osmId lấy từ OSM), merchants.json
.env.example   copy sang apps/web/.env
```

## 1. Yêu cầu

- Node 20+ (đã test trên Node 24), npm 10+
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `cast`)
- Tài khoản: [DeepSeek API key](https://platform.deepseek.com), [Circle Developer Console](https://console.circle.com), Google Cloud (OAuth client)

## 2. Chạy local (M1–M3 chỉ cần DeepSeek key)

```bash
git clone --recursive https://github.com/longbds0108/local.git toura && cd toura
# (đã clone không có --recursive? chạy: git submodule update --init --recursive)
cp .env.example apps/web/.env       # rồi điền DEEPSEEK_API_KEY
cd apps/web
npm install
npm run setup                        # prisma db push + seed merchants
npm run dev                          # http://localhost:3000
```

Không có `DEEPSEEK_API_KEY`: bản đồ + POI vẫn chạy, chat báo lỗi rõ ràng. Không có cấu hình Circle/Arc: màn thanh toán báo "chưa cấu hình".

AI dùng **DeepSeek** qua cổng tương thích Anthropic (`https://api.deepseek.com/anthropic`, [tài liệu](https://api-docs.deepseek.com/guides/anthropic_api)). Model mặc định `deepseek-flash` (nhanh, rẻ); đổi sang `deepseek-v4-pro` bằng `DEEPSEEK_MODEL`. Chế độ suy nghĩ bật mặc định; `DEEPSEEK_THINKING=off` để trả lời nhanh hơn.

## 3. Arc testnet

Hợp đồng TouraEscrow đã deploy trên Arc testnet: [`0x838C515363b7BbFb69f68106b3530Aa5Ea9865fc`](https://explorer.testnet.arc.io/address/0x838C515363b7BbFb69f68106b3530Aa5Ea9865fc).

Giá trị trong `.env.example` lấy từ [docs.arc.io → Connect to Arc](https://docs.arc.io/arc/references/connect-to-arc) và [Contract addresses](https://docs.arc.io/arc/references/contract-addresses) ngày 2026-11-10 — **hãy kiểm tra lại** trước khi dùng:

| Biến | Giá trị |
|---|---|
| `ARC_CHAIN_ID` | `5042002` |
| `ARC_RPC_URL` | `https://rpc.testnet.arc.io` |
| `ARC_EXPLORER_URL` | `https://explorer.testnet.arc.io` |
| `USDC_ADDRESS` | `0x3600000000000000000000000000000000000000` (ERC-20 interface, 6 decimals — dùng cho trả tại quán; mặc định địa chỉ này; escrow dùng USDC native) |
| Faucet | `https://faucet.circle.com` (chọn Arc Testnet) |

Lưu ý Arc: USDC là gas token native (**18 decimals**) và cùng số dư đó lộ ra qua ERC-20 interface (**6 decimals**). Escrow v2 nhận **USDC native qua `msg.value`** nên thanh toán chỉ **1 giao dịch** (không cần `approve`). Base fee tối thiểu 20 gwei.

### Deploy escrow (M4)

```bash
cd contracts
forge test                                    # 24 tests
# Ví operator: tạo ví testnet riêng (cast wallet new → OPERATOR_PRIVATE_KEY trong apps/web/.env),
# nạp USDC testnet từ faucet để trả gas, rồi:
cd ../apps/web && npm run deploy:arc          # deploy + tự ghi ESCROW_ADDRESS vào .env
```

Deployer = operator = owner (đổi operator sau bằng `setOperator`). Operator **chỉ trả gas**: không giải ngân được nếu thiếu mã của khách, và hoàn tiền chỉ về ví người trả. Arc khuyến nghị `arc-forge` ([arc-foundry](https://github.com/circlefin/arc-foundry/releases)) — `arc-forge test --network arc` để test với runtime của Arc. Nếu tx bị drop vì phí, thêm `--with-gas-price 25gwei`.

Sau khi sửa contract: `forge build && (cd ../apps/web && npm run abi)` để cập nhật ABI.

## 4. Circle wallet (M5–M6)

**Chế độ hiện tại — ví PIN (không cần Google):** chỉ cần `CIRCLE_API_KEY` + `NEXT_PUBLIC_CIRCLE_APP_ID` (lấy App ID: `curl -H "Authorization: Bearer $CIRCLE_API_KEY" https://api.circle.com/v1/w3s/config/entity`). Bấm **Bắt đầu / Get started** → server tạo Circle user cho id ngẫu nhiên của trình duyệt (`/api/circle/pin-session`) → cửa sổ Circle yêu cầu đặt PIN + câu hỏi bảo mật → ví SCA trên ARC-TESTNET được tạo. Mọi giao dịch sau đó xác nhận bằng PIN trong UI của Circle; token hết hạn được cấp lại tự động. Lưu ý: ví gắn với trình duyệt (localStorage) — xoá dữ liệu trình duyệt là mất liên kết tới ví.

**Chế độ Google (sau này):** điền `NEXT_PUBLIC_GOOGLE_CLIENT_ID` là app tự chuyển sang đăng nhập Google:

1. **Google Cloud Console** → APIs & Services → Credentials → OAuth client ID (Web):
   - Authorized JavaScript origins: `http://localhost:3000`
   - Authorized redirect URIs: **`http://localhost:3000/auth/callback`**
2. **Circle Console** → Wallets → User Controlled → Configurator:
   - Authentication Methods → Social Logins → Google: dán Google Client ID
   - Copy **App ID** → `NEXT_PUBLIC_CIRCLE_APP_ID`
   - API key (server) → `CIRCLE_API_KEY`
3. `NEXT_PUBLIC_GOOGLE_CLIENT_ID` = Google Client ID. Khởi động lại `npm run dev` (biến `NEXT_PUBLIC_*` được build vào client).

Luồng: `/trips/[id]` (bước Thanh toán) → "Đăng nhập Google & thanh toán" → Google → `/auth/callback` (SDK đọc token từ redirect) → tạo ví SCA trên `ARC-TESTNET` nếu chưa có (user xác nhận trong UI Circle) → quay lại `/trips/[id]` → trình duyệt tạo **mã check-in bí mật cho từng điểm** (lưu trên máy, chỉ gửi mã băm) → **deposit** bằng USDC native (1 lần xác nhận PIN) → server đọc escrow on-chain, đối chiếu merchant + số tiền + mã băm, ghi `PAID` + tx hash.

Nạp USDC testnet: copy địa chỉ ví trên màn thanh toán → faucet.

Private key của user không bao giờ đi qua server: mọi chữ ký diễn ra trong iframe của Circle sau khi user xác nhận. Server chỉ tạo challenge từ dữ liệu DB (không tin số tiền từ client).

## 5. QR check-in + hoàn tiền (M7–M8)

- **Đi nhóm & chia tiền**: người lập chuyến bật "Đi nhóm" trên lịch nháp rồi gửi link. Phần trả trước chia đều theo người; mỗi thành viên tự trả phần mình (có thể trả thay người đi cùng) bằng một lần ký quỹ riêng với mã check-in riêng. Tới quán, mã của ai thì giải ngân phần người đó; ai không đi/huỷ thì phần người đó hoàn về đúng ví đã trả. Hợp đồng ký quỹ giữ nguyên (`lib/group.ts`, `app/api/group/*`). Đã chạy thử trên Anvil: 31 kiểm tra đều đạt.
- **Ba cách trả** (gắn cho từng điểm khi AI tạo lịch trình, `Stop.payMode`):
  - `ESCROW` — **trả trước**: quán có `prepay: true` trong `apps/web/data/merchants.json` (nhận đặt chỗ, ví dụ Gành Hào). Gộp vào một giao dịch deposit.
  - `VENUE` — **trả tại quán**: quán đối tác không cần đặt chỗ (Cafe Suối Bên Biển, Bánh khọt Bà Hai). Tới nơi quét mã QR của quán → nhập số tiền trên hoá đơn → xác nhận PIN → `USDC.transfer(ví quán, số tiền)` qua giao diện ERC-20 của Arc (`0x3600…`, 6 số lẻ) → server tìm sự kiện `Transfer` từ ví khách tới ví quán trên chuỗi rồi mới ghi đã trả (mỗi giao dịch chỉ tính cho một điểm). Đóng trang giữa chừng thì lần mở sau trang tự kiểm tra lại, không bắt trả lần nữa.
  - `SELF` — **tự trả**: quán chưa là đối tác, giá chỉ là ước tính, không đi qua app (bỏ ví "Partner Pool").
  - Chuyến không có khoản trả trước thì bấm **Bắt đầu chuyến đi** (không có giao dịch, chỉ gắn chuyến với ví) rồi trả từng quán khi tới nơi.

- **Trả tại quán, 2 cách** (`/trips/[id]`, bước Đi & quét mã):
  - **Khách quét mã QR của quán** (cách chính, như VietQR): mã quán in ở quầy (`toura://venue?m={merchantId}`, lấy ở cổng đối tác) → app tìm điểm khớp → điểm trả trước: "Trả 24 USDC cho …?" → gửi mã check-in của điểm đó; điểm trả tại quán: nhập số tiền trên hoá đơn rồi trả thẳng.
  - **Quán quét mã của khách**: `toura://checkin?s={stopId}&c={code}` — mã chỉ được tạo trên máy khách, nên link chuyến đi chia sẻ được mà không lộ mã. Có nút "Lưu ảnh mã QR".
  - Hợp đồng kiểm tra `keccak256(code)` và **chỉ trả cho đúng quán đã chọn lúc ký quỹ**; ai gửi cũng được, server chỉ chuyển tiếp + trả gas.
- Cấu trúc trang của khách: `/` (Khám phá · Bản đồ · Hỏi AI) → `/trips` (mọi chuyến đi) → `/trips/[id]` (một trang cho mỗi chuyến: Lên lịch → Thanh toán → Đi & quét mã → Xong) · `/wallet` (số dư, tiền đang giữ, lịch sử). Link cũ `/pay/[id]`, `/itinerary/[id]`, `/dashboard` tự chuyển sang trang mới.
- `/merchant` (mở trên máy khác) — mở từ chân trang ("Bạn là chủ quán?"): chọn quán → hiện **mã QR của quán** (in/lưu ảnh) hoặc quét mã của khách (hoặc dán nội dung QR) → server kiểm tra mã, đúng quán, `PENDING`, itinerary `PAID`, chưa quá deadline → chuyển tiếp `release(id, i, code)` → quán nhận USDC (xem số dư + link explorer).
- **Huỷ điểm** (nút trên `/trips/[id]`): user chứng minh quyền bằng Circle user token (ví của user phải là payer on-chain) → operator `refund()`.
- **Hết hạn**: điểm trả tại quán chưa trả được ghi "Không ghé" (không có tiền nào bị giữ); điểm trả trước tự hoàn khi chuyến quá hạn được mở (trang chuyến đi, danh sách chuyến đi); ngoài ra `npm run refund:sweep` (hoặc cron `POST /api/refund {"mode":"sweep"}`, header `x-cron-secret` nếu đặt `CRON_SECRET`) hoàn các điểm `PENDING` của lịch trình đã qua `endAt + 2h`. Payer cũng tự gọi `refund()` trực tiếp trên contract được sau deadline.

Ví merchant demo (chỉ địa chỉ) ở `apps/web/data/merchants.json`; private key tương ứng ở `apps/web/data/merchant-keys.local.json` (gitignored — dùng nếu muốn rút USDC testnet). Quán chưa có ví riêng không còn được ký quỹ vào ví chung "Toura Partner Pool" nữa — các điểm đó là "tự trả".

## 6. Kiến trúc nhanh

| Phần | File |
|---|---|
| AI agent (stream SSE, vòng lặp tool, lưu hội thoại append-only theo session) | `lib/agent.ts`, `app/api/chat/route.ts` |
| Tools `search_places` / `get_route` / `build_itinerary` (zod validate, server tự tính lại giờ đến, giờ mở cửa, giá) | `lib/ai-tools.ts` |
| POI: seed + Overpass (cache 24h memory+disk, fallback seed khi Overpass lỗi) | `lib/places.ts`, `lib/overpass.ts` |
| Routing OSRM (+ ước lượng walking/bike vì demo server chỉ có car; fallback đường chim bay ×1.3) | `lib/osrm.ts` |
| Giờ mở cửa (`opening_hours`, theo giờ Asia/Ho_Chi_Minh) | `lib/hours.ts` |
| Circle REST (server) / Web SDK (client) | `lib/circle.ts`, `lib/circle-client.ts` |
| Chain (viem): đọc escrow, release/refund bằng operator | `lib/chain.ts` |
| Chat AI chỉ cho ví đã đăng nhập (Circle user token → địa chỉ ví, cache 5 phút; mỗi cuộc chat gắn với ví đã mở nó). Giới hạn: 20 tin/phút/IP, 10 tin/phút và 200 tin/ngày mỗi ví (in-memory) | `lib/wallet-auth.ts`, `app/api/chat/route.ts`, `lib/rate-limit.ts` |

Trạng thái itinerary: `DRAFT → PAID → COMPLETED | REFUNDED | PARTIAL`. Stop: `FREE | PENDING → (CHECKED_IN) → RELEASED` hoặc `PENDING → (REFUNDING) → REFUNDED`.

## 7. Đã kiểm thử

- `forge test`: 24/24 pass (deposit 1 giao dịch bằng USDC native, sai số tiền, release cần đúng mã, operator không có mã bị chặn, quét lại, quá hạn, re-entrancy, quán từ chối nhận tiền, fuzz 256 lần đoán mã).
- `tsc` + `next build` sạch.
- Tools AI (không qua model): loại điểm đóng cửa, tính lại lịch theo OSRM thật, từ chối osmId bịa / điểm đóng cửa / quá giờ, chỉnh sửa cập nhật đúng DRAFT cũ.
- End-to-end **trên Anvil local** với Circle API giả lập (stub ký thay user), escrow v2: deposit 30 USDC trong 1 giao dịch → confirm `PAID` (đối chiếu merchant + số tiền + mã băm) → mã sai bị chặn → mã đúng trả đúng 6 USDC cho quán → quét lại bị chặn → operator không có mã không giải ngân được → huỷ điểm hoàn đúng 24 USDC → escrow về 0.
- Quét mã QR của quán bằng **camera giả lập** (video chứa mã QR): quán nhận 6 rồi 24 USDC, chuyến chuyển sang "Xong".
- Hoàn tiền tự động khi mở chuyến quá hạn: khách nhận lại đúng 30 USDC, escrow về 0.
- Chuyến **kết hợp** trên Anvil (27 kiểm tra), dùng hợp đồng giả cho giao diện ERC-20 USDC của Arc (`contracts/test/mocks/MockArcUsdc.sol`): chỉ trả trước 24/35 USDC → quét nhầm quán, ví khác trả thay, số tiền sai, trả thẳng cho điểm đã trả trước đều bị chặn → quán cà phê nhận đúng 6,5 USDC (số trên hoá đơn) thẳng từ ví khách, xác nhận bằng sự kiện `Transfer` → trả lần hai bị chặn → điểm trả trước giải ngân bằng mã → chuyến "Hoàn tất", điểm tự trả không đụng tới chuỗi. Chuyến không có khoản trả trước bắt đầu mà không cần giao dịch; điểm trả tại quán chưa trả được ghi "Không ghé" khi quá hạn; một giao dịch không bao giờ tính cho hai điểm.
- Trên trình duyệt (camera giả lập): bắt đầu chuyến → quét mã quán cà phê → nhập 7,5 → tải lại trang, trang tự tìm thấy giao dịch trên chuỗi.

**Chưa chạy được ở đây** (cần key/tài khoản của bạn): chat với DeepSeek thật, hoàn tất bước đặt PIN Circle thật, deploy + giao dịch trên Arc testnet thật (ví operator cần USDC testnet; định dạng trường `amount` của Circle — số USDC dạng thập phân — cần xác nhận bằng một giao dịch thật), và một lần trả tại quán thật qua Circle trên Arc (`contractExecution` gọi `transfer(address,uint256)` trên `0x3600…0000`; sự kiện `Transfer` của USDC trên Arc testnet đã được kiểm tra là có thật).

## 8. Giới hạn của MVP

- Mã check-in nằm trên trình duyệt đã thanh toán (như ví PIN). Mất dữ liệu trình duyệt → không check-in được điểm đó, nhưng tiền vẫn hoàn được. `/merchant` chưa có đăng nhập (an toàn về tiền vì hợp đồng chỉ trả cho đúng quán, nhưng ai cũng xem được doanh thu).
- Rate limit + lock chat ở bộ nhớ process (1 instance). Dùng Redis khi scale.
- Bản đồ mặc định dùng style vector miễn phí của [OpenFreeMap](https://openfreemap.org) (dữ liệu OSM, không cần key) vì `tile.openstreetmap.org` bị chặn ở một số mạng và CARTO nay cần API key. Overpass/OSRM public chỉ dùng cho demo — production nên tự host hoặc dùng nhà cung cấp trả phí (`NEXT_PUBLIC_MAP_STYLE_URL`/`NEXT_PUBLIC_MAP_TILE_URL`, `OVERPASS_URL`, `OSRM_URL`).
- Ô "Vị trí của bạn": GPS → tên phường/quận + tỉnh/thành (trình duyệt gọi [BigDataCloud](https://www.bigdatacloud.com/free-api/free-reverse-geocode-to-city-api) miễn phí; server dự phòng bằng [Photon](https://photon.komoot.io)/OSM; toạ độ làm tròn ~100 m trước khi gửi), thời tiết hiện tại + giờ hoàng hôn ([Open-Meteo](https://open-meteo.com)), và ảnh địa danh nổi bật của 34 tỉnh/thành sau sáp nhập 2025 (`apps/web/data/landmarks.json` — ảnh Wikimedia Commons giấy phép tự do, luôn hiển thị tác giả + giấy phép). Lạng Sơn, Lai Châu và nơi ngoài Việt Nam dùng ảnh mặc định.
- "Khám phá gần …" và chat AI dùng vị trí GPS thật ở bất kỳ đâu (không GPS → trung tâm Vũng Tàu). Địa điểm lấy từ dữ liệu OSM: chính là các ô bản đồ vector OpenFreeMap (lớp `poi`, giải mã trên server, cache 7 ngày — nguồn ổn định nhất), bổ sung Overpass (có giờ mở cửa) khi trả lời kịp và Photon khi dữ liệu còn mỏng; chip "Món nên thử" theo tỉnh/thành (`apps/web/data/specialties.json`) chỉ dùng làm từ khoá tìm quán thật trong dữ liệu OSM. Ngoài các quán đối tác demo, điểm có phí là "tự trả" (chỉ hiện giá ước tính).
- Dịch vụ OSM bị chặn ở một số mạng (đã gặp ở VN): `tile.openstreetmap.org`, Nominatim và Photon công cộng bị từ chối kết nối; `overpass-api.de` thường quá tải. App không phụ thuộc vào chúng:
  - bản đồ + danh sách địa điểm: ô vector OpenFreeMap;
  - tên khu vực: BigDataCloud (gọi từ trình duyệt);
  - giờ mở cửa: Overpass **theo id** chỉ cho các địa điểm đang hiển thị (1 request nhỏ, cache 7 ngày), thử lần lượt `OVERPASS_URL` (mặc định `overpass.openstreetmap.fr` rồi `overpass-api.de`), máy chủ lỗi bị bỏ qua 10 phút;
  - Photon tắt mặc định (`PHOTON_URL` rỗng) — bật lại khi có máy chủ truy cập được (tự host).
- Giao diện (một font Be Vietnam Pro, xanh đậm/mint). Ảnh Unsplash là ảnh minh hoạ theo loại địa điểm, không phải ảnh thật của từng nơi.
- PWA: có manifest + icon, chưa có service worker/offline.
- "Mũi Nghinh Phong" và "Bến Đình" chưa có trong seed vì không lấy được osmId xác thực lúc tạo dữ liệu (Overpass/Nominatim bị giới hạn) — thay bằng Bãi Vọng Nguyệt (cạnh Nghinh Phong) và Nhà hàng Gành Hào. Thêm bằng cách tra OSM rồi bổ sung vào `apps/web/data/vungtau_pois.json`.

© OpenStreetMap contributors — dữ liệu bản đồ theo ODbL.

## 9. Triển khai lên Vercel

Code đã sẵn cho Vercel: trên Vercel dùng **Postgres** (máy local vẫn dùng SQLite), dữ liệu trong `apps/web/data/` được đóng gói vào bản build, bộ nhớ đệm bản đồ ghi vào `/tmp`, việc hoàn tiền khi mở chuyến quá hạn chạy bằng `after()` của Next.js, và có cron hằng ngày (`apps/web/vercel.json`) làm lưới an toàn.

1. **Deploy hợp đồng trước** (nếu chưa): `cd apps/web && npm run deploy:arc` → lấy `ESCROW_ADDRESS` trong `.env`. Chưa có thì web vẫn chạy, chỉ phần thanh toán báo "chưa cấu hình".
2. Vercel → **Add New → Project** → import repo GitHub.
3. **Root Directory: `apps/web`** (bắt buộc). Framework: Next.js. Giữ bật "Include files outside the root directory" (mặc định) vì dữ liệu nằm ở `apps/web/data/`. Lệnh build lấy từ `vercel.json` (`npm run vercel-build`).
4. **Storage → Create Database → Postgres (Neon)** → connect vào project. Vercel tự thêm `DATABASE_URL` và `DATABASE_URL_UNPOOLED`. (Hoặc dán URL Postgres của Neon/Supabase vào `DATABASE_URL`.)
5. **Settings → Environment Variables**, thêm (lấy giá trị từ `apps/web/.env`, **trừ** `DATABASE_URL`):

   | Biến | Ghi chú |
   |---|---|
   | `DEEPSEEK_API_KEY` | chat AI |
   | `CIRCLE_API_KEY`, `NEXT_PUBLIC_CIRCLE_APP_ID` | ví Circle (biến `NEXT_PUBLIC_*` được nhúng lúc build — đổi thì phải deploy lại) |
   | `ARC_RPC_URL`, `ARC_CHAIN_ID`, `ARC_EXPLORER_URL`, `NEXT_PUBLIC_FAUCET_URL` | như `.env.example` |
   | `ESCROW_ADDRESS`, `OPERATOR_PRIVATE_KEY` | `OPERATOR_PRIVATE_KEY` là khoá bí mật — chỉ dán vào Vercel, không commit |
   | `CRON_SECRET` | chuỗi ngẫu nhiên bất kỳ; bật cron hoàn tiền hằng ngày |
   | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | chỉ khi dùng đăng nhập Google — nhớ thêm `https://<tên-miền>/auth/callback` vào redirect URI của Google |

6. **Deploy**. Lệnh build sẽ: tạo `prisma/schema.postgres.prisma` → `prisma db push` (tạo/cập nhật bảng) → nạp 4 quán từ `apps/web/data/merchants.json` → `next build`. Nếu một thay đổi schema có thể làm mất dữ liệu, build sẽ dừng thay vì tự xoá.

Ghi chú:
- Dữ liệu chuyến đi trong `dev.db` ở máy không được chuyển lên — Postgres trên Vercel bắt đầu trống (trừ danh sách quán).
- Thử build Vercel ngay trên máy: `DATABASE_URL=postgresql://… npm run vercel-build` (cần một Postgres).
- Giới hạn tần suất (`lib/rate-limit.ts`) nằm trong bộ nhớ từng instance — đủ cho demo; production nên dùng Redis/Upstash.
- Route chat để `maxDuration = 300` giây; nếu gói Vercel của bạn báo vượt giới hạn thời gian, bật **Fluid compute** trong Settings → Functions hoặc giảm con số này.
