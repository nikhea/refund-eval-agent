#!/usr/bin/env python3
"""Deterministic refund eligibility + amount calculator.

Usage:
  python refund_calculator.py --input case.json [--policy policy-config.json]
  python refund_calculator.py --example          # print a sample input

Input JSON:
{
  "order": {
    "order_id": "ORD-1",
    "status": "delivered",             # processing|shipped|delivered|cancelled|partially_refunded|refunded
    "tier": "standard",                # standard|plus|vip
    "payment_method": "visa",
    "delivered_days_ago": 5,           # null if not delivered
    "shipping_paid": 0.0,
    "tax_rate": 0.08,                  # tax is charged on discounted item price
    "order_discount": 0.0,             # order-level discount, allocated pro rata by line gross
    "refunded_amount": 0.0,            # total already refunded on this order
    "total": 140.4,                    # total paid by customer
    "items": [
      {"sku": "A", "name": "Thing", "category": "electronics", "quantity": 1,
       "unit_price": 129.99, "line_discount": 0.0, "refunded_qty": 0,
       "final_sale": false, "final_sale_reason": null}
    ]
  },
  "request": {
    "reason": "changed_mind",
    "condition": "unopened",           # unopened|opened|used
    "items": [{"sku": "A", "quantity": 1}],   # optional; default = all remaining
    "risk_score": 10                   # optional 0-100
  }
}

Output: JSON with decision, per-item evaluation (blockers, notes), refund breakdown,
manual-review flags and applied rule IDs. Money uses Decimal, ROUND_HALF_UP to cents.
"""
import argparse
import json
import sys
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

CENT = Decimal("0.01")


def D(x) -> Decimal:
    return Decimal(str(x if x is not None else 0))


def money(x) -> Decimal:
    return D(x).quantize(CENT, rounding=ROUND_HALF_UP)


def load_policy(path):
    p = Path(path) if path else Path(__file__).resolve().parent.parent / "assets" / "policy-config.json"
    with open(p) as f:
        return json.load(f)


def order_gate(order):
    status = order["status"]
    msgs = {
        "cancelled": ("REDIRECT", "Order was cancelled; nothing to refund.", "R-STATE-CANCELLED"),
        "processing": ("REDIRECT", "Order not shipped; offer cancellation instead of a return.", "R-STATE-PROCESSING"),
        "shipped": ("REDIRECT", "Order in transit; returns open after delivery (offer intercept/refuse delivery).", "R-STATE-TRANSIT"),
        "refunded": ("DENY", "Order already fully refunded.", "R-STATE-REFUNDED"),
    }
    return msgs.get(status)


def evaluate_items(order, request, policy):
    reason = request["reason"]
    condition = request.get("condition", "unopened")
    fault = reason in policy["fault_reasons"]
    delivered = order.get("delivered_days_ago")
    vip_bonus = policy["vip_window_bonus_days"] if order.get("tier") == "vip" else 0

    wanted = request.get("items") or [{"sku": i["sku"]} for i in order["items"]]
    results = []
    for w in wanted:
        item = next((i for i in order["items"] if i["sku"] == w["sku"]), None)
        if item is None:
            results.append({"sku": w["sku"], "eligible": False, "quantity_eligible": 0,
                            "blockers": [f"SKU {w['sku']} not in order"], "notes": [], "rules": ["R-SKU-UNKNOWN"]})
            continue

        blockers, notes, rules = [], [], []
        cat = item["category"]
        remaining = item["quantity"] - item.get("refunded_qty", 0)
        req_qty = w.get("quantity") or remaining
        qty = max(0, min(req_qty, remaining))

        if remaining <= 0:
            blockers.append("Already fully refunded."); rules.append("R-ALREADY-REFUNDED")
        elif req_qty > remaining:
            notes.append(f"Requested {req_qty}, only {remaining} remain; capped.")
        if delivered is None:
            blockers.append("Not delivered yet."); rules.append("R-NOT-DELIVERED")

        # Category rules
        if cat in policy["never_refundable_categories"]:
            blockers.append(f"{cat} is never refundable."); rules.append("R-NEVER-REFUNDABLE")
            window = 0
        elif cat in policy["fault_only_categories"]:
            allowed = policy["fault_only_categories"][cat]
            window = policy["window_days"][cat]
            if reason not in allowed:
                blockers.append(f"{cat} refundable only for: {', '.join(allowed)}."); rules.append("R-FAULT-ONLY-CATEGORY")
        elif reason == "defective":
            window = policy["defective_window_days"]; rules.append("R-FAULT-WINDOW-DEFECT")
        elif fault:
            window = policy["fault_window_days"]; rules.append("R-FAULT-WINDOW")
        else:
            window = policy["window_days"][cat] + vip_bonus; rules.append(f"R-WINDOW-{cat.upper()}")
            if vip_bonus:
                notes.append(f"VIP window bonus +{vip_bonus} days.")

        if delivered is not None and window > 0 and delivered > window:
            blockers.append(f"Outside {window}-day window (delivered {delivered} days ago).")
            rules.append("R-OUTSIDE-WINDOW")

        if item.get("final_sale") and reason not in policy["final_sale_exception_reasons"]:
            blockers.append(f"Final sale ({item.get('final_sale_reason') or 'non-returnable'})."); rules.append("R-FINAL-SALE")

        fee_rate = Decimal("0")
        if not fault:
            if condition == "used":
                blockers.append("Used items not accepted for change-of-mind returns."); rules.append("R-CONDITION-USED")
            if cat in policy["unopened_only_categories"] and condition != "unopened":
                blockers.append(f"{cat} must be unopened."); rules.append("R-UNOPENED-ONLY")
            if condition == "opened":
                fee_rate = D(policy["restocking_fee_rate"].get(cat, 0))
                if fee_rate:
                    notes.append(f"Opened: {fee_rate * 100:.0f}% restocking fee."); rules.append("R-RESTOCK-FEE")
        else:
            rules.append("R-FAULT-NO-FEE")

        results.append({
            "sku": item["sku"], "name": item.get("name", item["sku"]), "category": cat,
            "eligible": not blockers and qty > 0, "quantity_eligible": 0 if blockers else qty,
            "window_days": window, "days_since_delivery": delivered,
            "restocking_fee_rate": float(fee_rate), "blockers": blockers, "notes": notes,
            "rules": sorted(set(rules)),
        })
    return results


def allocate_order_discount(order):
    """Return {sku: allocated order discount for the whole line}, pro rata by line gross, penny-exact."""
    gross = {i["sku"]: D(i["unit_price"]) * i["quantity"] for i in order["items"]}
    total_gross = sum(gross.values()) or Decimal("1")
    disc = D(order.get("order_discount", 0))
    alloc, running = {}, Decimal("0")
    skus = list(gross)
    for idx, sku in enumerate(skus):
        if idx == len(skus) - 1:
            alloc[sku] = money(disc - running)  # remainder to last line so sum is exact
        else:
            alloc[sku] = money(disc * gross[sku] / total_gross)
            running += alloc[sku]
    return alloc


def compute(order, evals, request, policy):
    fault = request["reason"] in policy["fault_reasons"]
    alloc = allocate_order_discount(order)
    tax_rate = D(order.get("tax_rate", 0))
    lines, items_sub, fee_total, tax_total = [], Decimal("0"), Decimal("0"), Decimal("0")

    for e in evals:
        if not e["eligible"]:
            continue
        item = next(i for i in order["items"] if i["sku"] == e["sku"])
        q = Decimal(item["quantity"])
        eq = Decimal(e["quantity_eligible"])
        gross_line = D(item["unit_price"]) * q
        net_line = gross_line - D(item.get("line_discount", 0)) - alloc[item["sku"]]
        net_unit_total = money(net_line * eq / q)  # net paid for the refunded units
        fee = money(net_unit_total * D(e["restocking_fee_rate"]))
        tax = money((net_unit_total - fee) * tax_rate)
        items_sub += net_unit_total
        fee_total += fee
        tax_total += tax
        lines.append({"sku": e["sku"], "name": e["name"], "quantity": int(eq),
                      "net_paid_for_units": float(net_unit_total), "restocking_fee": float(fee), "tax_refund": float(tax)})

    all_returned = bool(lines) and all(
        (i["quantity"] - i.get("refunded_qty", 0)) == 0
        or any(l["sku"] == i["sku"] and l["quantity"] == i["quantity"] - i.get("refunded_qty", 0) for l in lines)
        for i in order["items"]
    )
    shipping = (
        D(order.get("shipping_paid", 0))
        if fault and all_returned and D(order.get("refunded_amount", 0)) == 0 else Decimal("0")
    )
    uncapped = money(items_sub - fee_total + tax_total + shipping)
    remaining_balance = money(D(order["total"]) - D(order.get("refunded_amount", 0)))
    total = min(uncapped, remaining_balance)
    pm = order.get("payment_method", "visa")
    return {
        "currency": policy["currency"],
        "lines": lines,
        "items_subtotal_net": float(money(items_sub)),
        "restocking_fee": float(money(fee_total)),
        "tax_refund": float(money(tax_total)),
        "shipping_refund": float(shipping),
        "total_refund": float(total),
        "capped_at_remaining_balance": uncapped > remaining_balance,
        "refund_method": "store_credit" if pm == "store_credit" else "original_payment_method",
        "estimated_arrival": policy["refund_eta"].get(pm, "5-10 business days"),
        "return_shipping_paid_by": "merchant" if fault else "customer",
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", help="Path to case JSON ('-' for stdin)")
    ap.add_argument("--policy", help="Path to policy-config.json (default: bundled)")
    ap.add_argument("--example", action="store_true", help="Print example input and exit")
    a = ap.parse_args()

    if a.example:
        print(json.dumps({
            "order": {"order_id": "ORD-1004", "status": "delivered", "tier": "plus", "payment_method": "apple_pay",
                      "delivered_days_ago": 3, "shipping_paid": 0, "tax_rate": 0.08, "order_discount": 0,
                      "refunded_amount": 0, "total": 434.15,
                      "items": [{"sku": "EL-MON-27-4K", "name": '27" 4K Monitor', "category": "electronics",
                                 "quantity": 1, "unit_price": 389.0, "line_discount": 0, "refunded_qty": 0},
                                {"sku": "EL-HDMI-2M", "name": "HDMI Cable", "category": "electronics",
                                 "quantity": 1, "unit_price": 12.99, "line_discount": 0, "refunded_qty": 0}]},
            "request": {"reason": "changed_mind", "condition": "opened", "items": [{"sku": "EL-MON-27-4K", "quantity": 1}],
                        "risk_score": 10},
        }, indent=2))
        return
    if not a.input:
        ap.error("--input is required (or use --example)")

    case = json.load(sys.stdin if a.input == "-" else open(a.input))
    policy = load_policy(a.policy)
    order, request = case["order"], case["request"]

    gate = order_gate(order)
    if gate:
        outcome, msg, rule = gate
        print(json.dumps({"order_id": order["order_id"], "outcome": outcome, "message": msg,
                          "rules_applied": [rule], "items": [], "breakdown": None}, indent=2))
        return

    evals = evaluate_items(order, request, policy)
    ok = [e for e in evals if e["eligible"]]
    breakdown = compute(order, evals, request, policy) if ok else None

    review = []
    if breakdown and breakdown["total_refund"] > policy["manual_review_threshold"]:
        review.append(f"Refund exceeds auto-approve threshold ({policy['manual_review_threshold']}).")
    if request.get("risk_score", 0) >= policy["high_risk_score"]:
        review.append("High risk score.")
    elif request.get("risk_score", 0) >= policy["medium_risk_score"] and breakdown and breakdown["total_refund"] > policy["manual_review_threshold"] / 2:
        review.append("Medium risk score on a sizeable refund.")

    if not ok:
        outcome = "DENY"
    elif review:
        outcome = "ESCALATE"
    elif len(ok) == len(evals) and breakdown["restocking_fee"] == 0:
        outcome = "APPROVE_FULL"
    else:
        outcome = "APPROVE_PARTIAL"

    rules = sorted({r for e in evals for r in e["rules"]})
    print(json.dumps({
        "order_id": order["order_id"], "outcome": outcome, "manual_review_reasons": review,
        "rules_applied": rules, "items": evals, "breakdown": breakdown,
    }, indent=2))


if __name__ == "__main__":
    main()
