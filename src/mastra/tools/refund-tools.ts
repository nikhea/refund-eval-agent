import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  RETURN_REASONS,
  ITEM_CONDITIONS,
  returnRequests,
  refundPolicy,
  type ReturnReason,
  type ItemCondition,
} from "../data/orders";
import {
  findOrder,
  findCustomer,
  findCustomerByEmail,
  customerHasEmail,
  ordersForCustomer,
  findOrdersByEmail,
  orderLevelIssues,
  evaluateItems,
  computeRefund,
  daysSince,
  round2,
} from "../lib/refund-engine";
import { createToolLogger } from "../lib/tool-logging";

// Models often send the human phrasing ("changed mind") instead of the enum
// value. Normalize separators and a few common aliases before validating.
const REASON_ALIASES: Record<string, ReturnReason> = {
  change_mind: "changed_mind",
  changedmind: "changed_mind",
  size_fit: "size_or_fit",
  sizing: "size_or_fit",
  fit: "size_or_fit",
  damaged: "damaged_in_transit",
  damage: "damaged_in_transit",
  broken: "defective",
  defect: "defective",
  defective_item: "defective",
  wrong_product: "wrong_item",
};

const normalizeEnumValue = (value: unknown) =>
  typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_")
    : value;

const normalizeReason = (value: unknown) => {
  const key = normalizeEnumValue(value);
  return typeof key === "string" ? (REASON_ALIASES[key] ?? key) : key;
};

const normalizeCondition = (value: unknown): unknown => {
  const key = normalizeEnumValue(value);
  if (key === "new" || key === "brand_new" || key === "sealed")
    return "unopened";
  if (key === "used_item") return "used";
  return key;
};

// Models often include optional fields as empty strings instead of omitting
// them. Treat blank strings as "not provided" so `.optional()` works as meant.
const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalEmailSchema = z
  .preprocess(blankToUndefined, z.string().email().optional())
  .describe("Any email on the customer's account.");

const reasonSchema = z
  .preprocess(normalizeReason, z.enum(RETURN_REASONS))
  .describe(
    "Why the customer wants to return the item(s). One of: defective, damaged_in_transit, wrong_item, not_as_described, changed_mind, size_or_fit, late_delivery.",
  );
const conditionSchema = z
  .preprocess(normalizeCondition, z.enum(ITEM_CONDITIONS))
  .describe(
    "Current condition of the item(s) as stated by the customer. One of: unopened, opened, used.",
  );
const itemsSchema = z
  .array(
    z
      .object({
        sku: z
          .string()
          .optional()
          .describe("SKU from get-order-details. Preferred when known."),
        name: z
          .string()
          .optional()
          .describe(
            "Item name or a distinctive part of it (e.g. 'HDMI cable') when the SKU is unknown.",
          ),
        quantity: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Units to return. Defaults to all remaining units."),
      })
      .refine((item) => Boolean(item.sku?.trim() || item.name?.trim()), {
        message: "Provide the item sku or a name.",
        path: ["sku"],
      }),
  )
  .optional()
  .describe(
    "Only the items the customer wants to return. Omit to evaluate every item on the order.",
  );

const orderNotFound = (orderId: string) => ({
  found: false as const,
  message: `No order found for "${orderId}". Ask the customer to double-check the order number (format ORD-1234).`,
});

// ---------------------------------------------------------------- 1. Get Customer
export const getCustomerTool = createTool({
  id: "get-customer",
  description:
    "Look up a customer profile by customer ID or by any email on the account. Returns the customer's name, all emails on file, loyalty tier, order count, lifetime spend, total refunded, and a summary of their orders. Use this when the customer gives an email or customer ID instead of an order number.",
  inputSchema: z.object({
    customerId: z
      .string()
      .optional()
      .describe("Customer ID like CUS-001 (or just 1)."),
    email: optionalEmailSchema,
  }),
  outputSchema: z.object({
    found: z.boolean(),
    message: z.string().optional(),
    customer: z.any().optional(),
    orders: z.array(z.any()).optional(),
  }),
  execute: async (inputData, context) => {
    const { customerId, email } = inputData;
    const log = createToolLogger("get-customer", context);

    log.start({
      lookupBy: customerId ? "customerId" : email ? "email" : "none",
      customerId,
      email,
    });

    try {
      if (!customerId && !email) {
        log.warn("input", "missing lookup key");
        return { found: false, message: "Provide a customerId or an email." };
      }

      const customer = await log.stage(
        customerId ? "lookup customer by id" : "lookup customer by email",
        () =>
          customerId
            ? findCustomer(customerId)
            : findCustomerByEmail(email ?? ""),
        { customerId, email },
      );

      if (!customer) {
        log.warn("lookup", "customer not found", { customerId, email });
        return {
          found: false,
          message: customerId
            ? `No customer found for "${customerId}". Ask the customer to double-check their customer ID (format CUS-001).`
            : `No customer found for ${email}.`,
        };
      }

      const emailMatches = email
        ? await log.stage(
            "verify email",
            () => customerHasEmail(customer, email),
            { customerId: customer.customerId },
          )
        : true;

      if (!emailMatches) {
        log.warn("verify", "email does not belong to customer", {
          customerId: customer.customerId,
        });
        return {
          found: false,
          message: `Customer ${customer.customerId} is not registered with ${email}.`,
        };
      }

      const customerOrders = await log.stage(
        "load customer orders",
        () => ordersForCustomer(customer.customerId),
        { customerId: customer.customerId },
      );

      const { totalSpent, totalRefunded, orderSummaries } = await log.stage(
        "build customer summary",
        () => ({
          totalSpent: round2(
            customerOrders
              .filter((o) => o.status !== "cancelled")
              .reduce((sum, o) => sum + o.total, 0),
          ),
          totalRefunded: round2(
            customerOrders.reduce((sum, o) => sum + o.refundedAmount, 0),
          ),
          orderSummaries: customerOrders.map((o) => ({
            orderId: o.orderId,
            status: o.status,
            orderDate: o.orderDate,
            deliveredDate: o.deliveredDate,
            itemCount: o.items.length,
            total: o.total,
            refundedAmount: o.refundedAmount,
            remainingRefundableAmount: round2(o.total - o.refundedAmount),
          })),
        }),
        { customerId: customer.customerId, orderCount: customerOrders.length },
      );

      log.done("result", "customer returned", {
        customerId: customer.customerId,
        tier: customer.tier,
        emailCount: customer.emails.length,
        orderCount: customerOrders.length,
        totalSpent,
        totalRefunded,
      });

      return {
        found: true,
        customer: {
          customerId: customer.customerId,
          name: customer.name,
          emails: customer.emails,
          tier: customer.tier,
          orderCount: customerOrders.length,
          totalSpent,
          totalRefunded,
        },
        orders: orderSummaries,
      };
    } catch (error) {
      log.error("execute", error, { customerId });
      throw error;
    }
  },
});

// ---------------------------------------------------------------- 2. Get Order Details
export const getOrderDetailsTool = createTool({
  id: "get-order-details",
  description:
    "Look up an order by order ID, or list a customer's orders by email. Returns items, payment, delivery status, days since delivery, prior refunds, and remaining refundable quantity per item.",
  inputSchema: z
    .object({
      orderId: z
        .string()
        .optional()
        .describe("Order ID like ORD-1001 (or just 1001)."),
      customerEmail: z
        .preprocess(blankToUndefined, z.string().email().optional())
        .describe("Use when the customer does not know the order ID."),
    })
    .refine((value) => Boolean(value.orderId?.trim() || value.customerEmail), {
      message: "Provide an orderId or a customerEmail.",
      path: ["orderId"],
    }),
  outputSchema: z.object({
    found: z.boolean(),
    message: z.string().optional(),
    order: z.any().optional(),
    orders: z.array(z.any()).optional(),
  }),
  execute: async (inputData, context) => {
    const { orderId, customerEmail } = inputData;
    const log = createToolLogger("get-order-details", context);

    log.start({
      lookupBy: orderId ? "orderId" : customerEmail ? "customerEmail" : "none",
      orderId,
    });

    try {
      if (orderId) {
        const o = await log.stage(
          "lookup order by id",
          () => findOrder(orderId),
          {
            orderId,
          },
        );
        if (!o) {
          log.warn("lookup", "order not found", { orderId });
          return orderNotFound(orderId);
        }

        const days = o.deliveredDate ? daysSince(o.deliveredDate) : null;
        log.info("lookup", "order found", {
          orderId: o.orderId,
          status: o.status,
          itemCount: o.items.length,
          daysSinceDelivery: days,
        });

        const order = await log.stage(
          "build order summary",
          () => ({
            orderId: o.orderId,
            status: o.status,
            customer: {
              name: o.customer.name,
              emails: o.customer.emails,
              email: o.customer.emails[0],
              tier: o.customer.tier,
            },
            orderDate: o.orderDate,
            deliveredDate: o.deliveredDate,
            daysSinceDelivery: days,
            paymentMethod: o.paymentMethod,
            carrier: o.carrier,
            trackingNumber: o.trackingNumber,
            items: o.items.map((i) => ({
              sku: i.sku,
              name: i.name,
              category: i.category,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              refundedQty: i.refundedQty,
              remainingRefundableQty: i.quantity - i.refundedQty,
              finalSale: i.finalSale ?? false,
              finalSaleReason: i.finalSaleReason,
            })),
            subtotal: o.subtotal,
            shippingCost: o.shippingCost,
            tax: o.tax,
            total: o.total,
            refundedAmount: o.refundedAmount,
            remainingRefundableAmount: round2(o.total - o.refundedAmount),
            notes: o.notes,
          }),
          { orderId: o.orderId, itemCount: o.items.length },
        );

        log.done("result", "returning order details", {
          orderId: o.orderId,
          status: o.status,
          itemCount: o.items.length,
          total: o.total,
          remainingRefundableAmount: order.remainingRefundableAmount,
        });
        return { found: true, order };
      }

      if (customerEmail) {
        const list = await log.stage(
          "lookup orders by email",
          () => findOrdersByEmail(customerEmail),
          { customerEmail },
        );
        if (!list.length) {
          log.warn("lookup", "no orders for email", { customerEmail });
          return {
            found: false,
            message: `No orders found for ${customerEmail}.`,
          };
        }

        log.done("result", "returning order list", {
          customerEmail,
          orderCount: list.length,
        });
        return {
          found: true,
          orders: list.map((o) => ({
            orderId: o.orderId,
            status: o.status,
            total: o.total,
            orderDate: o.orderDate,
            items: o.items.map((i) => i.name),
          })),
        };
      }

      log.warn("input", "missing lookup key");
      return {
        found: false,
        message: "Provide an orderId or a customerEmail.",
      };
    } catch (error) {
      log.error("execute", error, { orderId });
      throw error;
    }
  },
});

// ---------------------------------------------------------------- 3. Check Refund Eligibility
export const checkRefundEligibilityTool = createTool({
  id: "check-refund-eligibility",
  description:
    "Check whether an order (or specific items) can be refunded under the refund policy, given the return reason and item condition. Returns per-item eligibility with blockers, window info, and restocking fee notes. Does NOT change any data.",
  inputSchema: z.object({
    orderId: z.string(),
    reason: reasonSchema,
    condition: conditionSchema,
    items: itemsSchema,
  }),
  outputSchema: z.object({
    found: z.boolean(),
    message: z.string().optional(),
    orderId: z.string().optional(),
    decision: z
      .enum(["eligible", "partially_eligible", "ineligible"])
      .optional(),
    orderLevelIssues: z.array(z.string()).optional(),
    items: z.array(z.any()).optional(),
    policyHighlights: z.array(z.string()).optional(),
  }),
  execute: async (inputData, context) => {
    const { orderId, reason, condition, items } = inputData;
    const log = createToolLogger("check-refund-eligibility", context);

    log.start({
      orderId,
      reason,
      condition,
      requestedItems: items?.map((i) => i.sku ?? i.name) ?? "all",
    });

    try {
      const order = await log.stage("lookup order", () => findOrder(orderId), {
        orderId,
      });
      if (!order) {
        log.warn("lookup", "order not found", { orderId });
        return orderNotFound(orderId);
      }

      log.info("lookup", "order found", {
        orderId: order.orderId,
        status: order.status,
        customerTier: order.customer.tier,
      });

      const issues = await log.stage(
        "check order-level policy",
        () => orderLevelIssues(order),
        { orderId: order.orderId, status: order.status },
      );
      if (issues.length) {
        log.warn("policy", "order-level blocker", {
          orderId: order.orderId,
          status: order.status,
          issues,
        });
        return {
          found: true,
          orderId: order.orderId,
          decision: "ineligible" as const,
          orderLevelIssues: issues,
          items: [],
        };
      }

      const evals = await log.stage(
        "evaluate items",
        () => evaluateItems(order, reason, condition, items),
        { orderId: order.orderId, reason, condition },
      );
      const { okCount, decision } = await log.stage(
        "summarize eligibility",
        () => {
          const eligibleCount = evals.filter((e) => e.eligible).length;
          return {
            okCount: eligibleCount,
            decision:
              eligibleCount === 0
                ? ("ineligible" as const)
                : eligibleCount === evals.length
                  ? ("eligible" as const)
                  : ("partially_eligible" as const),
          };
        },
        { orderId: order.orderId, totalItems: evals.length },
      );

      log.done("result", "eligibility decided", {
        orderId: order.orderId,
        decision,
        eligibleItems: okCount,
        totalItems: evals.length,
        blockers: evals.flatMap((e) => e.blockers.map((b) => `${e.sku}: ${b}`)),
      });

      return {
        found: true,
        orderId: order.orderId,
        decision,
        orderLevelIssues: [],
        items: evals,
        policyHighlights: refundPolicy.rules,
      };
    } catch (error) {
      log.error("execute", error, { orderId, reason, condition });
      throw error;
    }
  },
});

// ---------------------------------------------------------------- 4. Calculate Refund
export const calculateRefundTool = createTool({
  id: "calculate-refund",
  description:
    "Calculate the exact refund for eligible items: item subtotal, restocking fee, tax refund, shipping refund, total, refund method, and ETA. Flags refunds that need manual review. Does NOT change any data.",
  inputSchema: z.object({
    orderId: z.string(),
    reason: reasonSchema,
    condition: conditionSchema,
    items: itemsSchema,
  }),
  outputSchema: z.object({
    found: z.boolean(),
    message: z.string().optional(),
    orderId: z.string().optional(),
    breakdown: z.any().optional(),
    ineligibleItems: z.array(z.any()).optional(),
  }),
  requireApproval: true,
  execute: async (inputData, context) => {
    const { orderId, reason, condition, items } = inputData;
    const log = createToolLogger("calculate-refund", context);

    log.start({
      orderId,
      reason,
      condition,
      requestedItems: items?.map((i) => i.sku ?? i.name) ?? "all",
    });

    try {
      const order = await log.stage("lookup order", () => findOrder(orderId), {
        orderId,
      });
      if (!order) {
        log.warn("lookup", "order not found", { orderId });
        return orderNotFound(orderId);
      }

      const issues = await log.stage(
        "check order-level policy",
        () => orderLevelIssues(order),
        { orderId: order.orderId, status: order.status },
      );
      if (issues.length) {
        log.warn("policy", "order-level blocker", {
          orderId: order.orderId,
          status: order.status,
          issues,
        });
        return {
          found: true,
          orderId: order.orderId,
          message: issues.join(" "),
        };
      }

      const evals = await log.stage(
        "evaluate items",
        () => evaluateItems(order, reason, condition, items),
        { orderId: order.orderId, reason, condition },
      );
      const breakdown = await log.stage(
        "compute refund",
        () => computeRefund(order, evals, reason),
        { orderId: order.orderId, reason },
      );
      const ineligibleItems = await log.stage(
        "summarize ineligible items",
        () =>
          evals
            .filter((e) => !e.eligible)
            .map((e) => ({ sku: e.sku, name: e.name, blockers: e.blockers })),
        { orderId: order.orderId, itemCount: evals.length },
      );

      if (!breakdown.lines.length) {
        log.warn("result", "no eligible items", {
          orderId: order.orderId,
          ineligibleItems,
        });
        return {
          found: true,
          orderId: order.orderId,
          message: "No eligible items, so the refund is $0.00.",
          ineligibleItems,
        };
      }

      log.done("result", "refund calculated", {
        orderId: order.orderId,
        totalRefund: breakdown.totalRefund,
        currency: breakdown.currency,
        lineCount: breakdown.lines.length,
        ineligibleCount: ineligibleItems.length,
        restockingFee: breakdown.restockingFee,
        taxRefund: breakdown.taxRefund,
        shippingRefund: breakdown.shippingRefund,
        refundMethod: breakdown.refundMethod,
        requiresManualReview: breakdown.requiresManualReview,
      });

      return {
        found: true,
        orderId: order.orderId,
        breakdown,
        ineligibleItems,
      };
    } catch (error) {
      log.error("execute", error, { orderId, reason, condition });
      throw error;
    }
  },
});

// ---------------------------------------------------------------- 5. Process Return Request
export const processReturnRequestTool = createTool({
  id: "process-return-request",
  description:
    "Create the return (RMA) and issue the refund. ONLY call after the customer has confirmed the refund amount. Verifies the customer email against the order, re-validates eligibility, and either approves, rejects, or routes high-value refunds to manual review. This WRITES data.",
  inputSchema: z.object({
    orderId: z.string(),
    customerEmail: z
      .email()
      .describe("Email on the order, used to verify ownership."),
    reason: reasonSchema,
    condition: conditionSchema,
    items: itemsSchema,
    customerConfirmed: z
      .boolean()
      .describe(
        "True only if the customer explicitly confirmed the refund amount and return.",
      ),
    customerNote: z.string().optional(),
  }),
  requireApproval: true,
  outputSchema: z.object({
    success: z.boolean(),
    status: z.enum(["approved", "pending_manual_review", "rejected"]),
    message: z.string(),
    rmaNumber: z.string().optional(),
    refundAmount: z.number().optional(),
    refundMethod: z.string().optional(),
    estimatedArrival: z.string().optional(),
    returnLabelUrl: z.string().optional(),
    rejectionReasons: z.array(z.string()).optional(),
  }),
  execute: async (inputData, context) => {
    const {
      orderId,
      customerEmail,
      reason,
      condition,
      items,
      customerConfirmed,
      customerNote,
    } = inputData;
    const log = createToolLogger("process-return-request", context);

    log.start({
      orderId,
      reason,
      condition,
      requestedItems: items?.map((i) => i.sku ?? i.name) ?? "all",
      customerConfirmed,
      hasCustomerNote: Boolean(customerNote),
    });

    try {
      const order = await log.stage("lookup order", () => findOrder(orderId), {
        orderId,
      });
      if (!order) {
        log.warn("lookup", "order not found", { orderId });
        return {
          success: false,
          status: "rejected" as const,
          message: `Order "${orderId}" not found.`,
        };
      }

      const ownsOrder = await log.stage(
        "verify ownership",
        () => customerHasEmail(order.customer, customerEmail),
        { orderId: order.orderId },
      );
      if (!ownsOrder) {
        log.warn("verify", "email does not match order", {
          orderId: order.orderId,
        });
        return {
          success: false,
          status: "rejected" as const,
          message:
            "Email does not match the order. Cannot process this return.",
        };
      }
      log.info("verify", "customer verified against order", {
        orderId: order.orderId,
        customerTier: order.customer.tier,
      });

      if (!customerConfirmed) {
        log.warn("confirm", "customer has not confirmed the refund", {
          orderId: order.orderId,
        });
        return {
          success: false,
          status: "rejected" as const,
          message:
            "Customer has not confirmed. Present the refund breakdown and ask for confirmation first.",
        };
      }

      const issues = await log.stage(
        "check order-level policy",
        () => orderLevelIssues(order),
        { orderId: order.orderId, status: order.status },
      );
      if (issues.length) {
        log.warn("policy", "order-level blocker", {
          orderId: order.orderId,
          status: order.status,
          issues,
        });
        return {
          success: false,
          status: "rejected" as const,
          message: issues.join(" "),
          rejectionReasons: issues,
        };
      }

      const evals = await log.stage(
        "evaluate items",
        () => evaluateItems(order, reason, condition, items),
        { orderId: order.orderId, reason, condition },
      );
      const lines = evals.filter((e) => e.eligible);
      if (!lines.length) {
        const reasons = evals.flatMap((e) =>
          e.blockers.map((b) => `${e.name}: ${b}`),
        );
        log.warn("result", "no items eligible for refund", {
          orderId: order.orderId,
          rejectionReasons: reasons,
        });
        return {
          success: false,
          status: "rejected" as const,
          message: "No items are eligible for refund.",
          rejectionReasons: reasons,
        };
      }

      const refund = await log.stage(
        "compute refund",
        () => computeRefund(order, evals, reason),
        { orderId: order.orderId, reason },
      );
      const { rmaNumber, status } = await log.stage(
        "prepare return request",
        () => ({
          rmaNumber: `RMA-${String(1002 + returnRequests.length).padStart(4, "0")}`,
          status: refund.requiresManualReview
            ? ("pending_manual_review" as const)
            : ("approved" as const),
        }),
        {
          orderId: order.orderId,
          requiresManualReview: refund.requiresManualReview,
        },
      );

      log.info("persist", "creating return request", {
        orderId: order.orderId,
        rmaNumber,
        refundAmount: refund.totalRefund,
        status,
        itemCount: lines.length,
      });

      await log.stage(
        "persist return request",
        () => {
          returnRequests.push({
            rmaNumber,
            orderId: order.orderId,
            items: lines.map((l) => ({
              sku: l.sku,
              quantity: l.quantityEligible,
            })),
            reason,
            condition,
            refundAmount: refund.totalRefund,
            refundMethod: refund.refundMethod,
            status,
            createdAt: new Date().toISOString(),
            customerNote,
          });

          if (status === "approved") {
            for (const l of lines) {
              const it = order.items.find((i) => i.sku === l.sku)!;
              it.refundedQty += l.quantityEligible;
            }
            order.refundedAmount = round2(
              order.refundedAmount + refund.totalRefund,
            );
            order.status = order.items.every((i) => i.refundedQty >= i.quantity)
              ? "refunded"
              : "partially_refunded";
          }
        },
        { orderId: order.orderId, rmaNumber, status },
      );

      log.done("result", "return request processed", {
        orderId: order.orderId,
        rmaNumber,
        status,
        refundAmount: refund.totalRefund,
        refundMethod: refund.refundMethod,
        requiresManualReview: refund.requiresManualReview,
        orderStatus: order.status,
      });

      return {
        success: true,
        status,
        rmaNumber,
        refundAmount: refund.totalRefund,
        refundMethod: refund.refundMethod,
        estimatedArrival:
          status === "approved"
            ? refund.estimatedArrival
            : "After manual review (1-2 business days)",
        returnLabelUrl: `https://returns.example.com/label/${rmaNumber}`,
        message:
          status === "approved"
            ? `Return ${rmaNumber} approved. Refund of $${refund.totalRefund.toFixed(2)} will go to the ${refund.refundMethod.replace(/_/g, " ")}. Return shipping is paid by the ${refund.returnShippingPaidBy}.`
            : `Return ${rmaNumber} created and sent to a human reviewer because the refund ($${refund.totalRefund.toFixed(2)}) exceeds $${refundPolicy.manualReviewThreshold}.`,
      };
    } catch (error) {
      log.error("execute", error, { orderId, reason, condition });
      throw error;
    }
  },
});

export const refundTools = {
  getCustomerTool,
  getOrderDetailsTool,
  checkRefundEligibilityTool,
  calculateRefundTool,
  processReturnRequestTool,
};
