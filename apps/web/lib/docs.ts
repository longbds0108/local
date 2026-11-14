// Content of the /docs page, one dictionary per UI language (never mixed on one screen).
import type { Locale } from "./i18n";

export type DocLink = { label: string; href: string; external?: boolean };
export type DocCard = { title: string; when: string; body: string };
export type DocSection = {
  id: string;
  title: string;
  intro?: string;
  steps?: string[];
  cards?: DocCard[];
  bullets?: string[];
  links?: DocLink[];
};
export type Docs = {
  eyebrow: string;
  title: string;
  lead: string;
  tocLabel: string;
  whenLabel: string;
  sections: DocSection[];
};

export const FAUCET_URL = process.env.NEXT_PUBLIC_FAUCET_URL || "https://faucet.circle.com";

const vi: Docs = {
  eyebrow: "TÀI LIỆU",
  title: "Cách Toura hoạt động",
  lead: "Toura lên lịch trình cho vài giờ tới bằng cách trò chuyện với AI, rồi trả USDC cho từng điểm theo đúng cách của quán đó. Tiền trả trước chỉ đến tay quán khi bạn thật sự tới nơi.",
  tocLabel: "Mục lục",
  whenLabel: "Khi nào trả",
  sections: [
    {
      id: "bat-dau",
      title: "Bắt đầu",
      steps: [
        "Bấm “Bắt đầu” để tạo ví du lịch. Bạn chỉ cần đặt mã PIN trong cửa sổ của Circle, không phải cài thêm gì. Cần có ví mới trò chuyện được với AI.",
        "Hỏi AI về chuyến đi bạn muốn, ví dụ “chiều nay 4 tiếng, 2 người, thích biển”.",
        "Nạp USDC thử nghiệm vào ví (xem mục bên dưới), rồi thanh toán hoặc bắt đầu chuyến đi.",
      ],
      links: [{ label: "Hỏi AI", href: "/#ask" }],
    },
    {
      id: "usdc-thu-nghiem",
      title: "Nhận USDC thử nghiệm",
      intro: "Toura đang chạy trên mạng thử nghiệm Arc. USDC để dùng ở đây được phát miễn phí.",
      steps: [
        "Mở trang Ví và sao chép địa chỉ ví của bạn.",
        "Mở trang nhận USDC thử nghiệm của Circle, chọn mạng “Arc Testnet” và dán địa chỉ vào.",
        "Quay lại Toura, số dư tự cập nhật sau ít giây.",
      ],
      links: [
        { label: "Mở trang Ví", href: "/wallet" },
        { label: "Nhận USDC thử nghiệm", href: FAUCET_URL, external: true },
      ],
    },
    {
      id: "len-lich-trinh",
      title: "Lên lịch trình với AI",
      bullets: [
        "AI chỉ gợi ý địa điểm có thật trong dữ liệu OpenStreetMap quanh vị trí của bạn.",
        "Giờ đến từng điểm được tính theo đường đi thật và giờ mở cửa của quán.",
        "Muốn đổi gì cứ nói tiếp với AI: thêm điểm, bớt điểm, đổi giờ, đổi ngân sách.",
        "Chưa có khoản tiền nào bị trừ cho tới khi chính bạn xác nhận bằng mã PIN.",
      ],
    },
    {
      id: "ba-cach-tra",
      title: "Ba cách trả tiền",
      intro: "Mỗi điểm trong lịch trình được gắn sẵn một cách trả, tuỳ theo quán đó làm việc thế nào.",
      cards: [
        {
          title: "Trả trước",
          when: "Ngay khi xác nhận lịch trình, gộp một lần cho mọi điểm cần đặt chỗ",
          body: "Dành cho quán nhận đặt chỗ. Tiền được giữ trong hợp đồng, chỉ chuyển cho quán khi bạn tới nơi; không tới thì được hoàn lại.",
        },
        {
          title: "Trả tại quán",
          when: "Khi bạn tới nơi",
          body: "Dành cho quán đối tác không cần đặt chỗ. Quét mã QR ở quầy, nhập số tiền trên hoá đơn và xác nhận bằng mã PIN. USDC đi thẳng vào ví của quán.",
        },
        {
          title: "Tự trả",
          when: "Khi bạn tới nơi",
          body: "Quán chưa là đối tác của Toura. Giá chỉ là ước tính, bạn trả trực tiếp tại quán như bình thường.",
        },
      ],
      bullets: ["Chuyến không có điểm nào cần trả trước thì bạn chỉ cần bấm “Bắt đầu chuyến đi”, không có giao dịch nào."],
    },
    {
      id: "di-nhom",
      title: "Đi nhóm và chia tiền",
      steps: [
        "Trên lịch trình nháp từ 2 người trở lên, bấm “Đi nhóm: mỗi người tự trả phần mình”, rồi gửi link chuyến đi (hoặc mã QR mời) cho cả nhóm.",
        "Mỗi người mở link, đăng nhập ví và tham gia, có thể tham gia thay cho người đi cùng. Chuyến có quán cần đặt chỗ thì tham gia bằng cách trả trước phần của mình (hạn là giờ bắt đầu chuyến).",
        "Quán trả tại chỗ: một người quét mã QR của quán và nhập tổng hoá đơn. App chia đều (bỏ chọn người vắng mặt hoặc sửa số tiền nếu cần), mỗi người tự xác nhận phần của mình bằng mã PIN và tiền đi thẳng vào ví của quán.",
        "Quán đã trả trước: mỗi người tự quét mã của quán khi tới, phần của ai thì chuyển cho quán khi người đó tới. Ai không đi hoặc huỷ thì phần của người đó tự hoàn về đúng ví đã trả.",
      ],
    },
    {
      id: "khi-toi-noi",
      title: "Khi tới nơi",
      steps: [
        "Mở trang chuyến đi và quét mã QR của quán dán ở quầy.",
        "Điểm đã trả trước: xác nhận để tiền đang giữ được chuyển cho quán.",
        "Điểm trả tại quán: nhập số tiền trên hoá đơn rồi xác nhận bằng mã PIN.",
        "Hoặc mở mã QR của bạn cho quán quét, nếu quán dùng cổng đối tác.",
      ],
    },
    {
      id: "vi",
      title: "Gửi, nhận và quét mã trong Ví",
      bullets: [
        "Gửi: nhập địa chỉ ví và số tiền, kiểm tra lại rồi xác nhận bằng mã PIN. Giao dịch trên chuỗi khối không thể hoàn tác.",
        "Nhận: cho người gửi quét mã QR địa chỉ ví của bạn, hoặc sao chép địa chỉ gửi cho họ.",
        "Quét QR: mã của quán có trong chuyến đi sẽ mở thẳng chuyến đi để trả đúng điểm đó; mã của quán khác hoặc mã địa chỉ ví sẽ mở sẵn phần Gửi.",
      ],
      links: [{ label: "Mở trang Ví", href: "/wallet" }],
    },
    {
      id: "huy-va-hoan-tien",
      title: "Huỷ và hoàn tiền",
      bullets: [
        "Không đến được một điểm đã trả trước? Bấm “Huỷ điểm này” trên trang chuyến đi, USDC về lại ví của bạn.",
        "Hết khung giờ của chuyến mà còn điểm trả trước chưa dùng, tiền của điểm đó được hoàn tự động.",
        "Điểm trả tại quán mà bạn không ghé thì không có khoản tiền nào bị giữ.",
      ],
    },
    {
      id: "an-toan",
      title: "Tiền của bạn được bảo vệ thế nào",
      bullets: [
        "Tiền trả trước chỉ có thể đi tới hai nơi: đúng quán đã chọn lúc thanh toán, hoặc quay về ví của bạn.",
        "Mỗi điểm trả trước có một mã bí mật chỉ nằm trên máy của bạn. Không có mã đó, kể cả Toura cũng không chuyển được tiền cho quán.",
        "Khoá ví của bạn nằm trong Circle. Toura không bao giờ thấy hay giữ khoá ví, mọi giao dịch đều cần mã PIN của bạn.",
        "Ví và mã gắn với trình duyệt đang dùng. Xoá dữ liệu trình duyệt thì không quét mã được nữa, nhưng tiền vẫn được hoàn.",
      ],
    },
    {
      id: "chu-quan",
      title: "Dành cho chủ quán",
      steps: [
        "Mở cổng đối tác và chọn quán của bạn.",
        "In hoặc lưu mã QR của quán, đặt ở quầy. Khách quét để trả, dù đã đặt trước hay trả tại chỗ.",
        "Cũng có thể quét mã QR của khách. Tiền về thẳng ví của quán, xem được số dư và giao dịch ngay trong cổng.",
      ],
      links: [{ label: "Mở cổng đối tác", href: "/merchant" }],
    },
    {
      id: "luu-y",
      title: "Lưu ý",
      bullets: [
        "Giá các điểm hiện là giá mẫu.",
        "Dữ liệu địa điểm và bản đồ lấy từ OpenStreetMap, có thể thiếu hoặc chưa cập nhật giờ mở cửa.",
      ],
    },
  ],
};

const en: Docs = {
  eyebrow: "DOCS",
  title: "How Toura works",
  lead: "Toura plans your next few hours by chatting with AI, then pays each stop in USDC the way that venue works. Prepaid money only reaches the venue when you actually arrive.",
  tocLabel: "On this page",
  whenLabel: "When you pay",
  sections: [
    {
      id: "get-started",
      title: "Get started",
      steps: [
        "Tap “Get started” to create a travel wallet. You only set a PIN in Circle's window; nothing to install. You need a wallet to chat with the AI.",
        "Ask the AI for the trip you want, e.g. “4 hours this afternoon, 2 people, love the beach”.",
        "Add test USDC to the wallet (see below), then pay for or start your trip.",
      ],
      links: [{ label: "Ask AI", href: "/#ask" }],
    },
    {
      id: "test-usdc",
      title: "Get test USDC",
      intro: "Toura runs on the Arc testnet. The USDC used here is handed out for free.",
      steps: [
        "Open the Wallet page and copy your wallet address.",
        "Open Circle's test USDC page, choose the “Arc Testnet” network and paste the address.",
        "Come back to Toura; the balance updates within a few seconds.",
      ],
      links: [
        { label: "Open Wallet", href: "/wallet" },
        { label: "Get test USDC", href: FAUCET_URL, external: true },
      ],
    },
    {
      id: "plan",
      title: "Plan a trip with AI",
      bullets: [
        "The AI only suggests places that really exist in OpenStreetMap data around you.",
        "Arrival times follow real routes and each venue's opening hours.",
        "To change anything, just keep chatting: add or drop stops, shift times, change the budget.",
        "No money moves until you confirm with your PIN.",
      ],
    },
    {
      id: "ways-to-pay",
      title: "Three ways to pay",
      intro: "Each stop in a plan comes with a way to pay, depending on how that venue works.",
      cards: [
        {
          title: "Prepaid",
          when: "When you confirm the plan, once for every stop that takes bookings",
          body: "For venues that take bookings. The money is held in a contract and only goes to the venue when you arrive; if you don't, it comes back to you.",
        },
        {
          title: "Pay at venue",
          when: "When you arrive",
          body: "For partner venues you just walk into. Scan the QR at the counter, enter the bill and confirm with your PIN. USDC goes straight to the venue's wallet.",
        },
        {
          title: "Pay yourself",
          when: "When you arrive",
          body: "The venue isn't a Toura partner yet. The price is an estimate and you pay there as usual.",
        },
      ],
      bullets: ["If nothing on a trip needs prepaying, just tap “Start this trip”; no transaction is made."],
    },
    {
      id: "group",
      title: "Group trips and splitting the bill",
      steps: [
        "On a draft for 2 or more people, tap “Go as a group: everyone pays their own share”, then send the trip link (or the invite QR code) to the group.",
        "Each person opens the link, signs in with their wallet and joins, and can cover someone travelling with them. On a trip with a venue that takes bookings, you join by prepaying your share (before the trip starts).",
        "Venues paid on the spot: one person scans the venue's QR code and enters the bill total. The app splits it evenly (untick anyone absent or change an amount if needed), everyone confirms their own part with their PIN, and the money goes straight to the venue.",
        "Prepaid venues: everyone scans the venue's QR code on arrival and their part goes to the venue. If you don't go or cancel, your part goes back to the wallet that paid it.",
      ],
    },
    {
      id: "arrive",
      title: "When you arrive",
      steps: [
        "Open your trip and scan the venue's QR code at the counter.",
        "Prepaid stop: confirm, and the held money goes to the venue.",
        "Pay-at-venue stop: enter the bill and confirm with your PIN.",
        "Or show your own QR code for the venue to scan, if they use the partner portal.",
      ],
    },
    {
      id: "wallet",
      title: "Send, receive and scan in Wallet",
      bullets: [
        "Send: enter a wallet address and an amount, check it, then confirm with your PIN. Blockchain transfers can't be undone.",
        "Receive: let the sender scan your wallet address QR code, or copy the address for them.",
        "Scan QR: a venue on your trip opens that trip to pay the right stop; any other venue or a wallet address opens Send, filled in.",
      ],
      links: [{ label: "Open Wallet", href: "/wallet" }],
    },
    {
      id: "refunds",
      title: "Cancelling and refunds",
      bullets: [
        "Can't make a prepaid stop? Tap “Cancel this stop” on the trip page and the USDC returns to your wallet.",
        "When the trip's time window ends, any unused prepaid stop is refunded automatically.",
        "A pay-at-venue stop you skip never held any money.",
      ],
    },
    {
      id: "safety",
      title: "How your money is protected",
      bullets: [
        "Prepaid money can only go two places: the venue chosen when you paid, or back to your wallet.",
        "Each prepaid stop has a secret code that lives only on your device. Without it, not even Toura can pay the venue.",
        "Your wallet keys live with Circle. Toura never sees or holds them, and every transaction needs your PIN.",
        "Your wallet and codes are tied to this browser. Clearing its data means you can't scan codes any more, but refunds still work.",
      ],
    },
    {
      id: "venues",
      title: "For venues",
      steps: [
        "Open the partner portal and pick your venue.",
        "Print or save your venue's QR code and put it at the counter. Guests scan it to pay, whether they booked or just walked in.",
        "You can also scan a guest's QR code. Money goes straight to your wallet; the portal shows the balance and payments.",
      ],
      links: [{ label: "Open the partner portal", href: "/merchant" }],
    },
    {
      id: "notes",
      title: "Good to know",
      bullets: [
        "Venue prices are sample prices for now.",
        "Places and maps come from OpenStreetMap and may be missing or have outdated opening hours.",
      ],
    },
  ],
};

export const docs: Record<Locale, Docs> = { vi, en };
