import { findOrder } from "../../src/mastra/lib/refund-engine";
import {
  orders,
  returnRequests,
  type Order,
  type ReturnRequest,
} from "../../src/mastra/data/orders";
import type { ScorerToolInvocation } from "../../src/mastra/lib/scorer-trace";

export type StateSnapshot = {
  orders: Order[];
  returnRequests: ReturnRequest[];
};

export type OrderState = {
  status: Order["status"];
  refundedAmount: number;
  items: { sku: string; refundedQty: number }[];
};

/**
 * The tools mutate the in-memory `orders` and `returnRequests` arrays. Each case
 * gets a fresh copy so a write case cannot leak a refund into the next case.
 */
export function snapshotState(): StateSnapshot {
  return {
    orders: structuredClone(orders),
    returnRequests: structuredClone(returnRequests),
  };
}

/**
 * Restores in place: `orders` is the same array reference every tool and engine
 * function closes over, so replacing the array would not undo anything.
 */
export function restoreState(snapshot: StateSnapshot): void {
  orders.splice(0, orders.length, ...snapshot.orders);
  returnRequests.splice(0, returnRequests.length, ...snapshot.returnRequests);
}

export function captureOrderState(orderId: string): OrderState | undefined {
  const order = findOrder(orderId);
  if (!order) return undefined;
  return {
    status: order.status,
    refundedAmount: order.refundedAmount,
    items: order.items.map((item) => ({
      sku: item.sku,
      refundedQty: item.refundedQty,
    })),
  };
}

export type WriteVerification = {
  ok: boolean;
  rmaNumber?: string;
  refundAmount?: number;
  problems: string[];
};

/**
 * "The agent asked for a refund" and "a refund happened" are different claims.
 * This checks the tool result, then the order state the tool mutated.
 */
export function verifyWriteMutation(
  orderId: string | undefined,
  before: OrderState | undefined,
  invocations: ScorerToolInvocation[],
): WriteVerification {
  const problems: string[] = [];
  const write = [...invocations]
    .reverse()
    .find(
      (invocation) =>
        invocation.toolName === "process-return-request" &&
        invocation.result !== undefined,
    );

  if (!write) {
    return { ok: false, problems: ["process-return-request never returned a result"] };
  }

  const result = write.result ?? {};
  const rmaNumber = result.rmaNumber as string | undefined;
  const refundAmount = result.refundAmount as number | undefined;

  if (result.success !== true) {
    problems.push(`process-return-request failed: ${result.message ?? "no message"}`);
  }
  if (!rmaNumber || !/^RMA-\d+$/.test(rmaNumber)) {
    problems.push(`no RMA number returned (got ${JSON.stringify(rmaNumber)})`);
  }
  if (typeof refundAmount !== "number") {
    problems.push("tool returned no refundAmount");
  }

  if (!orderId || !before) {
    problems.push("cannot verify order state without a known order");
    return { ok: problems.length === 0, rmaNumber, refundAmount, problems };
  }

  const after = captureOrderState(orderId);
  if (!after) {
    problems.push(`order ${orderId} disappeared during the run`);
    return { ok: false, rmaNumber, refundAmount, problems };
  }

  const createdReturn = returnRequests.some(
    (request) => request.rmaNumber === rmaNumber,
  );
  if (!createdReturn) {
    problems.push(`no return request was persisted for ${rmaNumber}`);
  }

  if (result.status === "pending_manual_review") {
    // Manual review intentionally leaves the order untouched.
    return { ok: problems.length === 0, rmaNumber, refundAmount, problems };
  }

  if (after.status === before.status && after.refundedAmount === before.refundedAmount) {
    problems.push(
      `order state did not change (status ${after.status}, refundedAmount ${after.refundedAmount})`,
    );
  }

  if (typeof refundAmount === "number") {
    const delta = Math.round((after.refundedAmount - before.refundedAmount) * 100) / 100;
    if (Math.abs(delta - refundAmount) > 0.005) {
      problems.push(
        `refundedAmount changed by $${delta.toFixed(2)}, tool reported $${refundAmount.toFixed(2)}`,
      );
    }
  }

  for (const item of after.items) {
    const previous = before.items.find((i) => i.sku === item.sku);
    if (previous && item.refundedQty < previous.refundedQty) {
      problems.push(`${item.sku} refundedQty went backwards`);
    }
  }

  if (after.items.every((item) => item.refundedQty === 0)) {
    problems.push("no item refundedQty was incremented");
  }

  return { ok: problems.length === 0, rmaNumber, refundAmount, problems };
}
