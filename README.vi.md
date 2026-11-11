# Hedgora Travel — MVP (tiếng Việt)

> English: [README.md](README.md)

Trợ lý AI du lịch Vũng Tàu: tìm địa điểm **thật** (OpenStreetMap), lên lịch trình vài giờ tới bằng chat, **thanh toán USDC trên Arc testnet** bằng ví Circle (chỉ cần mã PIN), ký quỹ theo từng điểm trong **một giao dịch**, đến nơi quét mã QR để trả cho quán, hoàn tiền phần chưa dùng.

> ⚠️ Testnet only. USDC testnet không có giá trị thật. Giá địa điểm là ước tính cho demo.

```
apps/web/      Next.js 15 (App Router) + Tailwind 4 + Prisma/SQLite + MapLibre
contracts/     Foundry — HedgoraEscrow.sol (+ tests, deploy script)
data/          vungtau_pois.json (18 POI, toạ độ/osmId lấy từ OSM), merchants.json
.env.example   copy sang apps/web/.env
```

## 1. Yêu cầu

- Node 20+ (đã test trên Node 24), npm 10+
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `cast`)
- Tài khoản: [Anthropic API key](https://console.anthropic.com), [Circle Developer Console](https://console.circle.com), Google Cloud (OAuth client)

## 2. Chạy local (M1–M3 chỉ cần Anthropic key)

```bash
git clone --recursive https://github.com/longbds0108/local.git hedgora-travel && cd hedgora-travel
# (đã clone không có --recursive? chạy: git submodule update --init --recursive)
cp .env.example apps/web/.env       # rồi điền ANTHROPIC_API_KEY
cd apps/web
npm install
npm run setup                        # prisma db push + seed merchants
npm run dev                          # http://localhost:3000
```

Không có `ANTHROPIC_API_KEY`: bản đồ + POI vẫn chạy, chat báo lỗi rõ ràng. Không có cấu hình Circle/Arc: màn thanh toán báo "chưa cấu hình".

Model mặc định `claude-opus-5-5` (đổi bằng `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT`). Request bật **server-side refusal fallback** (`fallbacks: "default"`) — muốn tắt thì xoá 2 dòng `betas`/`fallbacks` trong `apps/web/lib/agent.ts`.

## 3. Arc testnet

Giá trị trong `.env.example` lấy từ [docs.arc.io → Connect to Arc](https://docs.arc.io/arc/references/connect-to-arc) và [Contract addresses](https://docs.arc.io/arc/references/contract-addresses) ngày 2026-11-10 — **hãy kiểm tra lại** trước khi dùng:

| Biến | Giá trị |
|---|---|
| `ARC_CHAIN_ID` | `5042002` |
| `ARC_RPC_URL` | `https://rpc.testnet.arc.io` |
| `ARC_EXPLORER_URL` | `https://explorer.testnet.arc.io` |
| `USDC_ADDRESS` | `0x3600000000000000000000000000000000000000` (ERC-20 interface, 6 decimals — escrow v2 không cần) |
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

- **Trả tại quán, 2 cách** (`/trips/[id]`, bước Đi & quét mã):
  - **Khách quét mã QR của quán** (cách chính, như VietQR): mã quán in ở quầy (`hedgora://venue?m={merchantId}`, lấy ở cổng đối tác) → app tìm điểm khớp → "Trả 24 USDC cho …?" → gửi mã check-in của điểm đó.
  - **Quán quét mã của khách**: `hedgora://checkin?s={stopId}&c={code}` — mã chỉ được tạo trên máy khách, nên link chuyến đi chia sẻ được mà không lộ mã. Có nút "Lưu ảnh mã QR".
  - Hợp đồng kiểm tra `keccak256(code)` và **chỉ trả cho đúng quán đã chọn lúc ký quỹ**; ai gửi cũng được, server chỉ chuyển tiếp + trả gas.
- Cấu trúc trang của khách: `/` (Khám phá · Bản đồ · Hỏi AI) → `/trips` (mọi chuyến đi) → `/trips/[id]` (một trang cho mỗi chuyến: Lên lịch → Thanh toán → Đi & quét mã → Xong) · `/wallet` (số dư, tiền đang giữ, lịch sử). Link cũ `/pay/[id]`, `/itinerary/[id]`, `/dashboard` tự chuyển sang trang mới.
- `/merchant` (mở trên máy khác) — mở từ chân trang ("Bạn là chủ quán?"): chọn quán → hiện **mã QR của quán** (in/lưu ảnh) hoặc quét mã của khách (hoặc dán nội dung QR) → server kiểm tra mã, đúng quán, `PENDING`, itinerary `PAID`, chưa quá deadline → chuyển tiếp `release(id, i, code)` → quán nhận USDC (xem số dư + link explorer).
- **Huỷ điểm** (nút trên `/trips/[id]`): user chứng minh quyền bằng Circle user token (ví của user phải là payer on-chain) → operator `refund()`.
- **Hết hạn**: tự hoàn khi chuyến quá hạn được mở (trang chuyến đi, danh sách chuyến đi); ngoài ra `npm run refund:sweep` (hoặc cron `POST /api/refund {"mode":"sweep"}`, header `x-cron-secret` nếu đặt `CRON_SECRET`) hoàn các điểm `PENDING` của lịch trình đã qua `endAt + 2h`. Payer cũng tự gọi `refund()` trực tiếp trên contract được sau deadline.

Ví merchant demo (chỉ địa chỉ) ở `data/merchants.json`; private key tương ứng ở `data/merchant-keys.local.json` (gitignored — dùng nếu muốn rút USDC testnet). Các điểm có phí chưa có ví riêng dùng ví "Hedgora Partner Pool".

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
| Rate limit chat 20 req/phút/IP (in-memory) | `lib/rate-limit.ts` |

Trạng thái itinerary: `DRAFT → PAID → COMPLETED | REFUNDED | PARTIAL`. Stop: `FREE | PENDING → (CHECKED_IN) → RELEASED` hoặc `PENDING → (REFUNDING) → REFUNDED`.

## 7. Đã kiểm thử

- `forge test`: 24/24 pass (deposit 1 giao dịch bằng USDC native, sai số tiền, release cần đúng mã, operator không có mã bị chặn, quét lại, quá hạn, re-entrancy, quán từ chối nhận tiền, fuzz 256 lần đoán mã).
- `tsc` + `next build` sạch.
- Tools AI (không qua model): loại điểm đóng cửa, tính lại lịch theo OSRM thật, từ chối osmId bịa / điểm đóng cửa / quá giờ, chỉnh sửa cập nhật đúng DRAFT cũ.
- End-to-end **trên Anvil local** với Circle API giả lập (stub ký thay user), escrow v2: deposit 30 USDC trong 1 giao dịch → confirm `PAID` (đối chiếu merchant + số tiền + mã băm) → mã sai bị chặn → mã đúng trả đúng 6 USDC cho quán → quét lại bị chặn → operator không có mã không giải ngân được → huỷ điểm hoàn đúng 24 USDC → escrow về 0.
- Quét mã QR của quán bằng **camera giả lập** (video chứa mã QR): quán nhận 6 rồi 24 USDC, chuyến chuyển sang "Xong".
- Hoàn tiền tự động khi mở chuyến quá hạn: khách nhận lại đúng 30 USDC, escrow về 0.

**Chưa chạy được ở đây** (cần key/tài khoản của bạn): chat với Claude thật, hoàn tất bước đặt PIN Circle thật, deploy + giao dịch trên Arc testnet thật (ví operator cần USDC testnet; định dạng trường `amount` của Circle — số USDC dạng thập phân — cần xác nhận bằng một giao dịch thật).

## 8. Giới hạn của MVP

- Mã check-in nằm trên trình duyệt đã thanh toán (như ví PIN). Mất dữ liệu trình duyệt → không check-in được điểm đó, nhưng tiền vẫn hoàn được. `/merchant` chưa có đăng nhập (an toàn về tiền vì hợp đồng chỉ trả cho đúng quán, nhưng ai cũng xem được doanh thu).
- Rate limit + lock chat ở bộ nhớ process (1 instance). Dùng Redis khi scale.
- Bản đồ mặc định dùng style vector miễn phí của [OpenFreeMap](https://openfreemap.org) (dữ liệu OSM, không cần key) vì `tile.openstreetmap.org` bị chặn ở một số mạng và CARTO nay cần API key. Overpass/OSRM public chỉ dùng cho demo — production nên tự host hoặc dùng nhà cung cấp trả phí (`NEXT_PUBLIC_MAP_STYLE_URL`/`NEXT_PUBLIC_MAP_TILE_URL`, `OVERPASS_URL`, `OSRM_URL`).
- Ô "Vị trí của bạn": GPS → tên phường/quận + tỉnh/thành (trình duyệt gọi [BigDataCloud](https://www.bigdatacloud.com/free-api/free-reverse-geocode-to-city-api) miễn phí; server dự phòng bằng [Photon](https://photon.komoot.io)/OSM; toạ độ làm tròn ~100 m trước khi gửi), thời tiết hiện tại + giờ hoàng hôn ([Open-Meteo](https://open-meteo.com)), và ảnh địa danh nổi bật của 34 tỉnh/thành sau sáp nhập 2025 (`data/landmarks.json` — ảnh Wikimedia Commons giấy phép tự do, luôn hiển thị tác giả + giấy phép). Lạng Sơn, Lai Châu và nơi ngoài Việt Nam dùng ảnh mặc định.
- "Khám phá gần …" và chat AI dùng vị trí GPS thật ở bất kỳ đâu (không GPS → trung tâm Vũng Tàu). Địa điểm lấy từ dữ liệu OSM: chính là các ô bản đồ vector OpenFreeMap (lớp `poi`, giải mã trên server, cache 7 ngày — nguồn ổn định nhất), bổ sung Overpass (có giờ mở cửa) khi trả lời kịp và Photon khi dữ liệu còn mỏng; chip "Món nên thử" theo tỉnh/thành (`data/specialties.json`) chỉ dùng làm từ khoá tìm quán thật trong dữ liệu OSM. Ngoài Vũng Tàu, điểm có phí được ký quỹ cho ví "Partner Pool" (chưa có ví merchant riêng).
- Dịch vụ OSM bị chặn ở một số mạng (đã gặp ở VN): `tile.openstreetmap.org`, Nominatim và Photon công cộng bị từ chối kết nối; `overpass-api.de` thường quá tải. App không phụ thuộc vào chúng:
  - bản đồ + danh sách địa điểm: ô vector OpenFreeMap;
  - tên khu vực: BigDataCloud (gọi từ trình duyệt);
  - giờ mở cửa: Overpass **theo id** chỉ cho các địa điểm đang hiển thị (1 request nhỏ, cache 7 ngày), thử lần lượt `OVERPASS_URL` (mặc định `overpass.openstreetmap.fr` rồi `overpass-api.de`), máy chủ lỗi bị bỏ qua 10 phút;
  - Photon tắt mặc định (`PHOTON_URL` rỗng) — bật lại khi có máy chủ truy cập được (tự host).
- Giao diện theo thiết kế LocalMate (một font Be Vietnam Pro, xanh đậm/mint). Ảnh Unsplash là ảnh minh hoạ theo loại địa điểm, không phải ảnh thật của từng nơi.
- PWA: có manifest + icon, chưa có service worker/offline.
- "Mũi Nghinh Phong" và "Bến Đình" chưa có trong seed vì không lấy được osmId xác thực lúc tạo dữ liệu (Overpass/Nominatim bị giới hạn) — thay bằng Bãi Vọng Nguyệt (cạnh Nghinh Phong) và Nhà hàng Gành Hào. Thêm bằng cách tra OSM rồi bổ sung vào `data/vungtau_pois.json`.

© OpenStreetMap contributors — dữ liệu bản đồ theo ODbL.
