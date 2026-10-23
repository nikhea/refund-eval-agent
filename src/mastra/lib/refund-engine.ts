import {
  orders,
  customers,
  refundPolicy,
  type Order,
  type OrderItem,
  type Customer,
  type ReturnReason,
  type ItemCondition,
  type Category,
} from "../data/orders";

const DAY = 86_400_000;
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const daysSince = (iso: string) =>
  Math.floor((Date.now() - new Date(iso).getTime()) / DAY);

export const FAULT_REASONS: ReturnReason[] = [
  "defective",
  "damaged_in_transit",
  "wrong_item",
  "not_as_described",
];
export const isFault = (r: ReturnReason) => FAULT_REASONS.includes(r);

export interface RequestedItem {
  sku?: string;
  /** Human name (or distinctive part of it), used when the caller has no SKU. */
  name?: string;
  quantity?: number;
}

type ItemResolution =
  | { kind: "found"; item: OrderItem }
  | { kind: "not_found"; message: string }
  | { kind: "ambiguous"; message: string };

const normalizeItemText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Resolves what the model asked for (SKU first, then name) to an order item.
 * Name matching is intentionally forgiving: exact normalized name, substring,
 * then all query words present in the item name. Ambiguous matches are
 * reported instead of guessing.
 */
export function resolveOrderItem(
  order: Order,
  requested: RequestedItem,
): ItemResolution {
  if (requested.sku) {
    const sku = normalizeItemText(requested.sku);
    const bySku = order.items.find((i) => normalizeItemText(i.sku) === sku);
    if (bySku) return { kind: "found", item: bySku };
  }

  if (requested.name) {
    const needle = normalizeItemText(requested.name);
    if (needle) {
      const bySubstring = order.items.filter((item) => {
        const haystack = normalizeItemText(item.name);
        return haystack.includes(needle) || needle.includes(haystack);
      });
      if (bySubstring.length === 1)
        return { kind: "found", item: bySubstring[0] };
      if (bySubstring.length > 1) {
        return {
          kind: "ambiguous",
          message: `"${requested.name}" matches several items (${bySubstring
            .map((i) => `${i.name} [${i.sku}]`)
            .join(", ")}). Pass the sku to pick one.`,
        };
      }

      const words = needle.split(" ").filter(Boolean);
      const byWords = order.items.filter((item) => {
        const itemWords = normalizeItemText(item.name).split(" ");
        return words.every((word) =>
          itemWords.some((candidate) => candidate.startsWith(word)),
        );
      });
      if (byWords.length === 1) return { kind: "found", item: byWords[0] };
      if (byWords.length > 1) {
        return {
          kind: "ambiguous",
          message: `"${requested.name}" matches several items (${byWords
            .map((i) => `${i.name} [${i.sku}]`)
            .join(", ")}). Pass the sku to pick one.`,
        };
      }
    }
  }

  if (!requested.sku && !requested.name) {
    return {
      kind: "not_found",
      message:
        "No item identified. Pass the sku from get-order-details or the item name.",
    };
  }

  const label = requested.sku ?? requested.name;
  return {
    kind: "not_found",
    message: `Item "${label}" is not part of order ${order.orderId}.`,
  };
}

export interface ItemEvaluation {
  sku: string;
  name: string;
  category: Category | "unknown";
  unitPrice: number;
  quantityRequested: number;
  quantityEligible: number;
  eligible: boolean;
  windowDays: number;
  daysSinceDelivery: number | null;
  restockingFeeRate: number;
  blockers: string[];
  notes: string[];
}

export function findOrder(raw: string): Order | undefined {
  const id = raw.trim().toUpperCase();
  const normalized = /^\d+$/.test(id) ? `ORD-${id}` : id;
  return orders.find((o) => o.orderId === normalized);
}

export function findCustomer(raw: string): Customer | undefined {
  const id = raw.trim().toUpperCase();
  const normalized = /^\d+$/.test(id)
    ? `CUS-${id.padStart(3, "0")}`
    : id;
  return customers.find((c) => c.customerId === normalized);
}

export function findCustomerByEmail(email: string): Customer | undefined {
  const needle = email.trim().toLowerCase();
  return customers.find((c) =>
    c.emails.some((e) => e.toLowerCase() === needle),
  );
}

export function customerHasEmail(customer: Customer, email: string): boolean {
  const needle = email.trim().toLowerCase();
  return customer.emails.some((e) => e.toLowerCase() === needle);
}

export function ordersForCustomer(customerId: string): Order[] {
  return orders.filter((o) => o.customer.customerId === customerId);
}

export function findOrdersByEmail(email: string): Order[] {
  const needle = email.trim().toLowerCase();
  return orders.filter((o) =>
    o.customer.emails.some((e) => e.toLowerCase() === needle),
  );
}

export function orderLevelIssues(order: Order): string[] {
  switch (order.status) {
    case "cancelled":
      return ["Order was cancelled, so there is nothing to return or refund."];
    case "processing":
      return [
        "Order has not shipped yet. Suggest cancelling the order instead of a return.",
      ];
    case "shipped":
      return ["Order is still in transit. Returns open once it is delivered."];
    case "refunded":
      return ["Order has already been fully refunded."];
    default:
      return [];
  }
}

export function evaluateItems(
  order: Order,
  reason: ReturnReason,
  condition: ItemCondition,
  requested?: RequestedItem[],
): ItemEvaluation[] {
  const fault = isFault(reason);
  const delivered = order.deliveredDate ? daysSince(order.deliveredDate) : null;
  const vipBonus =
    order.customer.tier === "vip" ? refundPolicy.vipWindowBonusDays : 0;
  const targets: RequestedItem[] = requested?.length
    ? requested
    : order.items.map((i) => ({ sku: i.sku }));

  return targets.map((t): ItemEvaluation => {
    const resolution = resolveOrderItem(order, t);
    if (resolution.kind !== "found") {
      return {
        sku: t.sku ?? t.name ?? "unknown",
        name: t.name ?? "Unknown item",
        category: "unknown",
        unitPrice: 0,
        quantityRequested: t.quantity ?? 0,
        quantityEligible: 0,
        eligible: false,
        windowDays: 0,
        daysSinceDelivery: delivered,
        restockingFeeRate: 0,
        blockers: [resolution.message],
        notes: [],
      };
    }

    const item = resolution.item;

    const blockers: string[] = [];
    const notes: string[] = [];
    const remaining = item.quantity - item.refundedQty;
    const qty = Math.min(t.quantity ?? remaining, Math.max(remaining, 0));

    if (remaining <= 0)
      blockers.push("This item has already been fully refunded.");
    if (t.quantity && t.quantity > remaining && remaining > 0) {
      notes.push(
        `Requested ${t.quantity} but only ${remaining} remain refundable; quantity capped.`,
      );
    }
    if (delivered === null) blockers.push("Item has not been delivered yet.");

    // Window by category + reason
    let windowDays: number;
    if (item.category === "gift_card") {
      windowDays = 0;
      blockers.push(refundPolicy.nonReturnable.gift_card);
    } else if (item.category === "digital") {
      windowDays = refundPolicy.windowDays.digital;
      if (reason !== "defective")
        blockers.push(refundPolicy.nonReturnable.digital);
    } else if (item.category === "grocery") {
      windowDays = refundPolicy.windowDays.grocery;
      if (!fault) blockers.push(refundPolicy.nonReturnable.grocery);
    } else if (reason === "defective") {
      windowDays = refundPolicy.defectiveWindowDays;
    } else if (fault) {
      windowDays = refundPolicy.faultWindowDays;
    } else {
      windowDays = refundPolicy.windowDays[item.category] + vipBonus;
      if (vipBonus)
        notes.push(`VIP tier: window extended by ${vipBonus} days.`);
    }

    if (delivered !== null && windowDays > 0 && delivered > windowDays) {
      blockers.push(
        `Outside the ${windowDays}-day return window (delivered ${delivered} days ago).`,
      );
    }

    // Final sale
    const finalSaleOk = [
      "defective",
      "damaged_in_transit",
      "wrong_item",
    ].includes(reason);
    if (item.finalSale && !finalSaleOk) {
      blockers.push(
        `Final sale item (${item.finalSaleReason ?? "non-returnable"}).`,
      );
    }

    // Condition rules (change-of-mind style only)
    let restockingFeeRate = 0;
    if (!fault) {
      if (condition === "used")
        blockers.push(
          "Used items are not accepted for change-of-mind returns.",
        );
      if (item.category === "beauty" && condition !== "unopened") {
        blockers.push(
          "Beauty products must be unopened for change-of-mind returns.",
        );
      }
      if (condition === "opened") {
        restockingFeeRate = refundPolicy.restockingFeeRate[item.category] ?? 0;
        if (restockingFeeRate)
          notes.push(
            `Opened item: ${restockingFeeRate * 100}% restocking fee applies.`,
          );
      }
    }

    return {
      sku: item.sku,
      name: item.name,
      category: item.category,
      unitPrice: item.unitPrice,
      quantityRequested: t.quantity ?? remaining,
      quantityEligible: blockers.length ? 0 : qty,
      eligible: blockers.length === 0 && qty > 0,
      windowDays,
      daysSinceDelivery: delivered,
      restockingFeeRate,
      blockers,
      notes,
    };
  });
}

export function computeRefund(
  order: Order,
  evals: ItemEvaluation[],
  reason: ReturnReason,
) {
  const lines = evals.filter((e) => e.eligible);
  const itemsSubtotal = round2(
    lines.reduce((s, l) => s + l.unitPrice * l.quantityEligible, 0),
  );
  const restockingFee = round2(
    lines.reduce(
      (s, l) => s + l.unitPrice * l.quantityEligible * l.restockingFeeRate,
      0,
    ),
  );
  const taxRefund = round2((itemsSubtotal - restockingFee) * order.taxRate);

  const allRemainingReturned =
    lines.length > 0 &&
    order.items.every((i) => {
      const rem = i.quantity - i.refundedQty;
      const l = lines.find((x) => x.sku === i.sku);
      return rem === 0 || (l !== undefined && l.quantityEligible === rem);
    });
  const shippingRefund =
    isFault(reason) && allRemainingReturned && order.refundedAmount === 0
      ? order.shippingCost
      : 0;

  const uncapped = round2(
    itemsSubtotal - restockingFee + taxRefund + shippingRefund,
  );
  const maxRefundable = round2(order.total - order.refundedAmount);
  const total = Math.min(uncapped, maxRefundable);

  const refundMethod =
    order.paymentMethod === "store_credit"
      ? "store_credit"
      : "original_payment_method";
  const etaDays =
    order.paymentMethod === "bank_transfer"
      ? "7-10 business days"
      : order.paymentMethod === "paypal" || order.paymentMethod === "apple_pay"
        ? "3-5 business days"
        : order.paymentMethod === "store_credit"
          ? "instant"
          : "5-7 business days";

  return {
    currency: refundPolicy.currency,
    lines: lines.map((l) => ({
      sku: l.sku,
      name: l.name,
      quantity: l.quantityEligible,
      unitPrice: l.unitPrice,
      lineTotal: round2(l.unitPrice * l.quantityEligible),
    })),
    itemsSubtotal,
    restockingFee,
    taxRefund,
    shippingRefund,
    totalRefund: total,
    cappedAtRemainingBalance: uncapped > maxRefundable,
    refundMethod,
    paymentMethod: order.paymentMethod,
    estimatedArrival: etaDays,
    requiresManualReview: total > refundPolicy.manualReviewThreshold,
    returnShippingPaidBy: isFault(reason) ? "merchant" : "customer",
  };
}
