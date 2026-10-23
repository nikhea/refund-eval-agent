// ---------- Types ----------
export const CATEGORIES = [
  "electronics",
  "apparel",
  "footwear",
  "home",
  "furniture",
  "beauty",
  "grocery",
  "digital",
  "gift_card",
  "toys",
  "sports",
  "books",
  "jewelry",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type OrderStatus =
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "partially_refunded"
  | "refunded";
export type PaymentMethod =
  | "visa"
  | "mastercard"
  | "paypal"
  | "apple_pay"
  | "bank_transfer"
  | "store_credit";
export type CustomerTier = "standard" | "plus" | "vip";

export const RETURN_REASONS = [
  "defective",
  "damaged_in_transit",
  "wrong_item",
  "not_as_described",
  "changed_mind",
  "size_or_fit",
  "late_delivery",
] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

export const ITEM_CONDITIONS = ["unopened", "opened", "used"] as const;
export type ItemCondition = (typeof ITEM_CONDITIONS)[number];

export interface Customer {
  customerId: string;
  name: string;
  /** All emails on the account, primary first. */
  emails: string[];
  tier: CustomerTier;
}

export interface OrderItem {
  sku: string;
  name: string;
  category: Category;
  quantity: number;
  unitPrice: number;
  refundedQty: number;
  finalSale?: boolean;
  finalSaleReason?: string;
}

export interface Order {
  orderId: string;
  customer: Customer;
  status: OrderStatus;
  orderDate: string;
  deliveredDate: string | null;
  paymentMethod: PaymentMethod;
  carrier: string | null;
  trackingNumber: string | null;
  items: OrderItem[];
  subtotal: number;
  shippingCost: number;
  taxRate: number;
  tax: number;
  total: number;
  refundedAmount: number;
  notes?: string;
}

export interface ReturnRequest {
  rmaNumber: string;
  orderId: string;
  items: { sku: string; quantity: number }[];
  reason: ReturnReason;
  condition: ItemCondition;
  refundAmount: number;
  refundMethod: string;
  status: "approved" | "pending_manual_review";
  createdAt: string;
  customerNote?: string;
}

// ---------- Refund policy (the "refund_policy" box in the diagram) ----------
export const refundPolicy = {
  currency: "USD",
  windowDays: {
    electronics: 15,
    apparel: 30,
    footwear: 30,
    home: 30,
    furniture: 30,
    beauty: 30,
    grocery: 7,
    digital: 14,
    gift_card: 0,
    toys: 30,
    sports: 30,
    books: 30,
    jewelry: 30,
  } as Record<Category, number>,
  defectiveWindowDays: 90, // manufacturer defects
  faultWindowDays: 30, // damaged in transit / wrong item / not as described
  vipWindowBonusDays: 15, // added to standard windows for change-of-mind returns
  restockingFeeRate: { electronics: 0.15, furniture: 0.1 } as Partial<
    Record<Category, number>
  >, // only if opened, non-fault
  manualReviewThreshold: 1000, // refunds above this need a human
  shippingRefundedWhen:
    "Fault-based return of ALL remaining items and no prior refund on the order",
  nonReturnable: {
    gift_card: "Gift cards are never refundable.",
    digital:
      "Digital products are refundable only if defective, within 14 days.",
    grocery:
      "Perishables are refundable only if spoiled, damaged or wrong item, within 7 days.",
  },
  rules: [
    "Change-of-mind returns must be unused. Beauty items must also be unopened.",
    "Opened electronics (15%) and furniture (10%) carry a restocking fee on change-of-mind returns.",
    "Final-sale and personalized items are refundable only for defective / damaged / wrong item.",
    "Refunds go to the original payment method (store credit stays store credit).",
    "Return shipping is prepaid by us for fault-based returns; customer pays for change-of-mind.",
  ],
};

// ---------- Helpers for building demo data ----------
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
const TAX_RATE = 0.08;
const round2 = (n: number) => Math.round(n * 100) / 100;

const cust = (
  customerId: string,
  name: string,
  tier: CustomerTier = "standard",
  additionalEmails: string[] = [],
): Customer => {
  const primaryEmail = `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`;
  return {
    customerId,
    name,
    emails: [primaryEmail, ...additionalEmails],
    tier,
  };
};

const item = (
  sku: string,
  name: string,
  category: Category,
  quantity: number,
  unitPrice: number,
  extra: Partial<OrderItem> = {},
): OrderItem => ({
  sku,
  name,
  category,
  quantity,
  unitPrice,
  refundedQty: 0,
  ...extra,
});

interface BuildArgs {
  id: string;
  customer: Customer;
  status: OrderStatus;
  ordered: number; // days ago
  delivered: number | null; // days ago, null if not delivered
  payment: PaymentMethod;
  shipping?: number;
  items: OrderItem[];
  refunded?: "full" | number;
  notes?: string;
}

function build(a: BuildArgs): Order {
  const subtotal = round2(
    a.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0),
  );
  const shippingCost = a.shipping ?? 0;
  const tax = round2(subtotal * TAX_RATE);
  const total = round2(subtotal + tax + shippingCost);
  const shipped = a.status !== "processing" && a.status !== "cancelled";
  return {
    orderId: `ORD-${a.id}`,
    customer: a.customer,
    status: a.status,
    orderDate: daysAgo(a.ordered),
    deliveredDate: a.delivered === null ? null : daysAgo(a.delivered),
    paymentMethod: a.payment,
    carrier: shipped ? (Number(a.id) % 2 ? "DHL Express" : "FedEx") : null,
    trackingNumber: shipped
      ? `TRK${a.id}${String(Number(a.id) * 7919).slice(0, 6)}`
      : null,
    items: a.items,
    subtotal,
    shippingCost,
    taxRate: TAX_RATE,
    tax,
    total,
    refundedAmount: a.refunded === "full" ? total : (a.refunded ?? 0),
    notes: a.notes,
  };
}

// ---------- Customers ----------
const amara = cust("CUS-001", "Amara Okafor", "plus", [
  "amara.okafor@workmail.example.com",
]);
const chidi = cust("CUS-002", "Chidi Eze", "standard", [
  "c.eze@workmail.example.com",
]);
const fatima = cust("CUS-003", "Fatima Bello");
const tunde = cust("CUS-004", "Tunde Adeyemi", "plus");
const ngozi = cust("CUS-005", "Ngozi Obi");
const emeka = cust("CUS-006", "Emeka Nwosu", "vip", [
  "emeka.nwosu@workmail.example.com",
]);
const zainab = cust("CUS-007", "Zainab Musa");
const kunle = cust("CUS-008", "Kunle Balogun");
const ada = cust("CUS-009", "Ada Eze");
const sade = cust("CUS-010", "Sade Williams", "plus", [
  "sade.williams@workmail.example.com",
]);
const ibrahim = cust("CUS-011", "Ibrahim Sani");
const blessing = cust("CUS-012", "Blessing Udo");
const obinna = cust("CUS-013", "Obinna Okeke", "vip", [
  "obinna.okeke@workmail.example.com",
]);
const halima = cust("CUS-014", "Halima Yusuf");
const david = cust("CUS-015", "David Mensah");
const chioma = cust("CUS-016", "Chioma Nnadi", "plus");
const yinka = cust("CUS-017", "Yinka Adebayo");
const samuel = cust("CUS-018", "Samuel Ojo", "vip", [
  "samuel.ojo@workmail.example.com",
]);
const linda = cust("CUS-019", "Linda Achebe");
const mohammed = cust("CUS-020", "Mohammed Garba");
const peace = cust("CUS-021", "Peace Ikpe");
const tobi = cust("CUS-022", "Tobi Alabi");
const rita = cust("CUS-023", "Rita Okon");
const femi = cust("CUS-024", "Femi Coker", "plus", [
  "femi.coker@workmail.example.com",
]);
const grace = cust("CUS-025", "Grace Eke");
const victor = cust("CUS-026", "Victor Onyeama");
const ifeoma = cust("CUS-027", "Ifeoma Dike");
const kelechi = cust("CUS-028", "Kelechi Ume");
const abdul = cust("CUS-029", "Abdul Lawal", "plus", [
  "abdul.lawal@workmail.example.com",
]);
const bola = cust("CUS-030", "Bola Adewale");
const jessica = cust("CUS-031", "Jessica Nwachukwu");
const daniel = cust("CUS-032", "Daniel Etim");
const hauwa = cust("CUS-033", "Hauwa Abubakar");
const chuka = cust("CUS-034", "Chuka Ibe");

// ---------- customers_db (34 customers) ----------
export const customers: Customer[] = [
  amara,
  chidi,
  fatima,
  tunde,
  ngozi,
  emeka,
  zainab,
  kunle,
  ada,
  sade,
  ibrahim,
  blessing,
  obinna,
  halima,
  david,
  chioma,
  yinka,
  samuel,
  linda,
  mohammed,
  peace,
  tobi,
  rita,
  femi,
  grace,
  victor,
  ifeoma,
  kelechi,
  abdul,
  bola,
  jessica,
  daniel,
  hauwa,
  chuka,
];

// ---------- orders_db (34 orders) ----------
export const orders: Order[] = [
  // 1001: electronics, 5d, in window
  build({
    id: "1001",
    customer: amara,
    status: "delivered",
    ordered: 9,
    delivered: 5,
    payment: "visa",
    shipping: 0,
    items: [
      item("EL-EARB-PRO", "Wireless Earbuds Pro", "electronics", 1, 129.99),
    ],
  }),
  // 1002: footwear + apparel, multi-item, in window
  build({
    id: "1002",
    customer: chidi,
    status: "delivered",
    ordered: 16,
    delivered: 12,
    payment: "mastercard",
    shipping: 6.99,
    items: [
      item("FW-RUN-042", "Trail Running Shoes (US 10)", "footwear", 2, 89.0),
      item("AP-SOCK-3PK", "Performance Socks 3-Pack", "apparel", 1, 14.5),
    ],
  }),
  // 1003: electronics, 20d, outside 15d window (standard tier)
  build({
    id: "1003",
    customer: fatima,
    status: "delivered",
    ordered: 24,
    delivered: 20,
    payment: "paypal",
    shipping: 0,
    items: [
      item("EL-WATCH-S5", "Smart Watch Series 5", "electronics", 7, 249.0),
    ],
  }),
  // 1004: electronics, 3d, two items
  build({
    id: "1004",
    customer: tunde,
    status: "delivered",
    ordered: 7,
    delivered: 3,
    payment: "apple_pay",
    shipping: 0,
    items: [
      item("EL-MON-27-4K", '27" 4K Monitor', "electronics", 1, 389.0),
      item("EL-HDMI-2M", "HDMI 2.1 Cable 2m", "electronics", 1, 12.99),
    ],
  }),
  // 1005: home, 45d, outside window
  build({
    id: "1005",
    customer: ngozi,
    status: "delivered",
    ordered: 50,
    delivered: 45,
    payment: "visa",
    shipping: 8.5,
    items: [item("HM-DUVET-LN-Q", "Linen Duvet Set (Queen)", "home", 1, 119.0)],
  }),
  // 1006: high value, needs manual review
  build({
    id: "1006",
    customer: emeka,
    status: "delivered",
    ordered: 12,
    delivered: 8,
    payment: "visa",
    shipping: 0,
    items: [
      item("EL-LAP-GAME-17", 'Gaming Laptop 17" RTX', "electronics", 1, 1899.0),
    ],
    notes: "High-value order. Refunds over $1,000 require manual approval.",
  }),
  // 1007: beauty, 2d, unopened-only category
  build({
    id: "1007",
    customer: zainab,
    status: "delivered",
    ordered: 5,
    delivered: 2,
    payment: "mastercard",
    shipping: 4.99,
    items: [
      item("BT-SERUM-VC", "Vitamin C Serum 30ml", "beauty", 1, 34.0),
      item("BT-MOIST-50", "Daily Moisturizer SPF30 50ml", "beauty", 1, 28.0),
    ],
  }),
  // 1008: in transit
  build({
    id: "1008",
    customer: kunle,
    status: "shipped",
    ordered: 3,
    delivered: null,
    payment: "bank_transfer",
    shipping: 9.99,
    items: [
      item(
        "EL-KB-MECH",
        "Mechanical Keyboard (Brown Switch)",
        "electronics",
        1,
        149.0,
      ),
    ],
  }),
  // 1009: processing
  build({
    id: "1009",
    customer: ada,
    status: "processing",
    ordered: 1,
    delivered: null,
    payment: "paypal",
    shipping: 5.99,
    items: [item("SP-YOGA-6MM", "Yoga Mat 6mm", "sports", 1, 39.0)],
  }),
  // 1010: cancelled
  build({
    id: "1010",
    customer: sade,
    status: "cancelled",
    ordered: 6,
    delivered: null,
    payment: "visa",
    shipping: 0,
    items: [item("JW-BAG-LTHR", "Leather Handbag", "apparel", 1, 210.0)],
    notes: "Cancelled by customer before shipment.",
  }),
  // 1011: gift card
  build({
    id: "1011",
    customer: ibrahim,
    status: "delivered",
    ordered: 11,
    delivered: 10,
    payment: "visa",
    shipping: 0,
    items: [item("GC-100", "Gift Card $100", "gift_card", 1, 100.0)],
  }),
  // 1012: digital, 6d
  build({
    id: "1012",
    customer: blessing,
    status: "delivered",
    ordered: 6,
    delivered: 6,
    payment: "paypal",
    shipping: 0,
    items: [
      item(
        "DG-PHOTO-LIC",
        "Photo Editing Software (1-yr license)",
        "digital",
        1,
        59.99,
      ),
    ],
  }),
  // 1013: furniture + shipping, VIP
  build({
    id: "1013",
    customer: obinna,
    status: "delivered",
    ordered: 19,
    delivered: 14,
    payment: "mastercard",
    shipping: 49.0,
    items: [
      item(
        "FN-DESK-STAND",
        "Electric Standing Desk 140cm",
        "furniture",
        1,
        449.0,
      ),
    ],
  }),
  // 1014: home, 25d, multi-qty
  build({
    id: "1014",
    customer: halima,
    status: "delivered",
    ordered: 30,
    delivered: 25,
    payment: "apple_pay",
    shipping: 6.0,
    items: [
      item("HM-CUSH-GR", "Cushion Cover 45x45 (Sage)", "home", 2, 22.0),
      item("HM-THROW-WL", "Wool Throw Blanket", "home", 1, 45.0),
    ],
  }),
  // 1015: grocery, 4d
  build({
    id: "1015",
    customer: david,
    status: "delivered",
    ordered: 6,
    delivered: 4,
    payment: "visa",
    shipping: 4.5,
    items: [
      item("GR-COFFEE-1KG", "Organic Coffee Beans 1kg", "grocery", 3, 18.5),
    ],
  }),
  // 1016: apparel with a final-sale item
  build({
    id: "1016",
    customer: chioma,
    status: "delivered",
    ordered: 15,
    delivered: 11,
    payment: "mastercard",
    shipping: 0,
    items: [
      item("AP-DENIM-JKT-M", "Denim Jacket (M)", "apparel", 1, 79.0),
      item("AP-CHINO-32", "Slim Chinos (32)", "apparel", 1, 55.0, {
        finalSale: true,
        finalSaleReason: "Clearance item",
      }),
    ],
  }),
  // 1017: partially refunded
  build({
    id: "1017",
    customer: yinka,
    status: "partially_refunded",
    ordered: 11,
    delivered: 7,
    payment: "paypal",
    shipping: 5.0,
    items: [
      item("TY-PUZZ-500", "Kids Puzzle 500pc", "toys", 3, 24.0, {
        refundedQty: 1,
      }),
    ],
    refunded: 25.92,
    notes: "One puzzle refunded earlier (RMA-0998).",
  }),
  // 1018: electronics 16d, VIP gets +15 day bonus
  build({
    id: "1018",
    customer: samuel,
    status: "delivered",
    ordered: 20,
    delivered: 16,
    payment: "visa",
    shipping: 0,
    items: [
      item("EL-MOUSE-WL", "Wireless Ergonomic Mouse", "electronics", 1, 35.0),
    ],
  }),
  // 1019: jewelry, 28d
  build({
    id: "1019",
    customer: linda,
    status: "delivered",
    ordered: 33,
    delivered: 28,
    payment: "apple_pay",
    shipping: 0,
    items: [
      item("JW-PEND-GOLD", "18k Gold Pendant Necklace", "jewelry", 1, 320.0),
    ],
  }),
  // 1020: fully refunded
  build({
    id: "1020",
    customer: mohammed,
    status: "refunded",
    ordered: 14,
    delivered: 9,
    payment: "visa",
    shipping: 0,
    items: [
      item("EL-SPK-BT", "Bluetooth Speaker", "electronics", 1, 79.0, {
        refundedQty: 1,
      }),
    ],
    refunded: "full",
    notes: "Fully refunded under RMA-1001.",
  }),
  // 1021: delivered 1d ago
  build({
    id: "1021",
    customer: peace,
    status: "delivered",
    ordered: 4,
    delivered: 1,
    payment: "mastercard",
    shipping: 0,
    items: [
      item(
        "EL-HEAD-ANC",
        "Noise-Cancelling Headphones",
        "electronics",
        1,
        199.0,
      ),
      item("EL-HEAD-CASE", "Headphone Travel Case", "electronics", 1, 25.0),
    ],
    notes: "Carrier flagged outer box as damaged on delivery.",
  }),
  // 1022: sports, 18d
  build({
    id: "1022",
    customer: tobi,
    status: "delivered",
    ordered: 22,
    delivered: 18,
    payment: "bank_transfer",
    shipping: 12.0,
    items: [
      item("SP-DUMB-20KG", "Adjustable Dumbbell Set 20kg", "sports", 1, 120.0),
      item("SP-BANDS-5", "Resistance Bands (5 pack)", "sports", 1, 18.0),
    ],
  }),
  // 1023: books, 31d (1 day over)
  build({
    id: "1023",
    customer: rita,
    status: "delivered",
    ordered: 35,
    delivered: 31,
    payment: "visa",
    shipping: 3.5,
    items: [item("BK-BOXSET-3", "Fantasy Trilogy Box Set", "books", 1, 45.0)],
  }),
  // 1024: home appliance, 6d
  build({
    id: "1024",
    customer: femi,
    status: "delivered",
    ordered: 10,
    delivered: 6,
    payment: "apple_pay",
    shipping: 0,
    items: [item("HM-ESPR-15BAR", "Espresso Machine 15-bar", "home", 1, 329.0)],
  }),
  // 1025: personalized final sale
  build({
    id: "1025",
    customer: grace,
    status: "delivered",
    ordered: 18,
    delivered: 13,
    payment: "paypal",
    shipping: 0,
    items: [
      item("JW-WATCH-ENG", "Engraved Wristwatch", "jewelry", 1, 180.0, {
        finalSale: true,
        finalSaleReason: "Personalized engraving",
      }),
    ],
  }),
  // 1026: 85d old electronics, only defective qualifies
  build({
    id: "1026",
    customer: victor,
    status: "delivered",
    ordered: 90,
    delivered: 85,
    payment: "mastercard",
    shipping: 0,
    items: [item("EL-TAB-10", '10" Tablet 128GB', "electronics", 1, 299.0)],
  }),
  // 1027: furniture, 22d
  build({
    id: "1027",
    customer: ifeoma,
    status: "delivered",
    ordered: 27,
    delivered: 22,
    payment: "visa",
    shipping: 39.0,
    items: [
      item("FN-CHAIR-ERGO", "Ergonomic Office Chair", "furniture", 1, 259.0),
    ],
  }),
  // 1028: beauty set, 29d
  build({
    id: "1028",
    customer: kelechi,
    status: "delivered",
    ordered: 33,
    delivered: 29,
    payment: "mastercard",
    shipping: 4.99,
    items: [item("BT-SKIN-SET4", "Skincare Set (4 pieces)", "beauty", 1, 88.0)],
  }),
  // 1029: high-value phone + accessories
  build({
    id: "1029",
    customer: abdul,
    status: "delivered",
    ordered: 6,
    delivered: 3,
    payment: "apple_pay",
    shipping: 0,
    items: [
      item("EL-PHONE-X15", "Smartphone X15 256GB", "electronics", 1, 899.0),
      item("EL-CASE-X15", "Protective Case X15", "electronics", 1, 19.99),
      item("EL-SCRN-X15", "Screen Protector X15", "electronics", 1, 9.99),
    ],
  }),
  // 1030: boundary: exactly 15 days electronics
  build({
    id: "1030",
    customer: bola,
    status: "delivered",
    ordered: 19,
    delivered: 15,
    payment: "visa",
    shipping: 0,
    items: [item("HM-AIRFRY-5L", "Air Fryer 5L", "home", 1, 99.0)],
  }),
  // 1031: store credit payment
  build({
    id: "1031",
    customer: jessica,
    status: "delivered",
    ordered: 23,
    delivered: 19,
    payment: "store_credit",
    shipping: 0,
    items: [
      item("FW-SNK-WHT-9", "Leather Sneakers (US 9)", "footwear", 1, 120.0),
      item("AP-HOOD-L", "Fleece Hoodie (L)", "apparel", 1, 65.0),
    ],
  }),
  // 1032: 40d old, defective strap claim possible
  build({
    id: "1032",
    customer: daniel,
    status: "delivered",
    ordered: 45,
    delivered: 40,
    payment: "paypal",
    shipping: 5.0,
    items: [item("SP-BKPK-LAP", "Laptop Backpack 25L", "sports", 1, 69.0)],
    notes:
      "Customer previously contacted support about a stitching issue on the strap.",
  }),
  // 1033: beauty fragrance
  build({
    id: "1033",
    customer: hauwa,
    status: "delivered",
    ordered: 5,
    delivered: 2,
    payment: "visa",
    shipping: 0,
    items: [
      item("BT-PERF-50", "Eau de Parfum 50ml", "beauty", 1, 95.0),
      item("HM-CNDL-LAV", "Lavender Scented Candle", "home", 2, 14.0),
    ],
  }),
  // 1034: 100d old TV, outside even defective window
  build({
    id: "1034",
    customer: chuka,
    status: "delivered",
    ordered: 105,
    delivered: 100,
    payment: "bank_transfer",
    shipping: 0,
    items: [item("EL-TV-55-OLED", '55" OLED TV', "electronics", 1, 599.0)],
  }),
];

// ---------- In-memory return requests (filled by processReturnRequest) ----------
export const returnRequests: ReturnRequest[] = [];
