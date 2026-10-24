# Calculation Rules

Exact money math for refunds. Prefer `scripts/refund_calculator.py`; this file explains the rules it implements and the cases it does not cover.

## Contents
1. Principles
2. Core formula
3. Discount allocation
4. Tax
5. Restocking fees and deductions
6. Shipping
7. Caps and prior refunds
8. Bundles and promotions
9. Currency and FX
10. Rounding
11. Worked examples
12. Reconciliation and idempotency

---

## 1. Principles

- Use decimal arithmetic (`Decimal`, integer minor units). Never binary floats for money.
- Refund **what the customer actually paid**, per line, never list price.
- Compute at the **line level**, round half-up to the currency's minor unit (2 decimals for USD/NGN/EUR, 0 for JPY), then sum. Do not round the total once.
- A refund can never exceed `order.total - already_refunded`.
- The refund goes back to the original tender, in the original currency.

## 2. Core formula

For each eligible line with `n` units refunded out of `Q` ordered:

```
gross_line      = unit_price * Q
net_line        = gross_line - line_discount - allocated_order_discount
net_refund_base = round(net_line * n / Q)
fee             = round(net_refund_base * restocking_rate)        # change-of-mind, opened only
tax_refund      = round((net_refund_base - fee) * tax_rate)
line_refund     = net_refund_base - fee + tax_refund
```

Order level:

```
shipping_refund = outbound_shipping_paid   if fault AND all remaining units returned AND no prior refund
                  else 0
total           = min( sum(line_refund) + shipping_refund , order.total - already_refunded )
```

## 3. Discount allocation

Order-level discounts (coupon code, "10% off everything") are allocated across lines **pro rata by line gross** so each line carries its fair share. Give the rounding remainder to the last line so allocated discounts sum exactly to the discount.

Line-level discounts (sale price markdown, item coupon) stay on their own line.

If the allocation was already stored on the order lines at purchase time, use the stored values and do not recompute.

## 4. Tax

- Refund tax on the **net refunded amount** (after discounts and fees), at the rate charged on that line.
- Use the tax actually collected per line when stored (multi-rate carts, exemptions, VAT/GST/VAT-inclusive pricing).
- **Tax-inclusive pricing (VAT, e.g. Nigeria 7.5%, EU, UK):** prices already contain tax. Refund the full inclusive net amount; derive tax portion for reporting as `net * rate / (1 + rate)`.
- Shipping tax: if shipping was taxed, refund the tax with the shipping.
- Restocking fees: some jurisdictions treat the fee as a reduction of the sale (tax refunded on the net) and others as separate revenue (tax not refunded on the fee). Default here is the former. Confirm with finance.
- Tax-exempt customers: refund zero tax.

## 5. Restocking fees and deductions

- Rate by category from config; apply to **net refund base** of the unit(s) returned, not to list price.
- Only for change-of-mind returns of opened items in resalable condition.
- Never on fault returns, exchanges to same SKU, or items the merchant mis-shipped.
- Missing-accessory deduction: documented replacement cost, itemized, capped at the line's net refund base. Show it as a separate line to the customer.
- Return shipping paid by customer: if deducted, itemize and cap at the actual label cost.
- Total deductions on a single unit are capped at 50% of its net refund base without human approval (protects against stacking).

## 6. Shipping

| Scenario | Refund shipping? |
|---|---|
| Fault, all remaining units returned, first refund on the order | Yes, full outbound shipping paid |
| Fault, partial return | No, unless the shipping was caused by the fault (e.g. wrong item reshipment is free to customer) |
| Change of mind | No, unless a free-returns promotion or law applies |
| Order cancelled before shipment | Yes, full |
| Late delivery beyond promised date by more than the configured days | Refund the shipping fee as goodwill/guarantee if the merchant promised delivery dates |
| Expedited shipping not delivered on time | Refund the expedite premium |

## 7. Caps and prior refunds

- `remaining_balance = order.total - already_refunded`. Clamp the refund to this value and flag `capped_at_remaining_balance`.
- Track `refunded_qty` per line; a unit refunded once cannot be refunded again.
- If a prior refund was a **price adjustment** (money back without return), do not refund the full line again; refund only the remainder of the net paid.
- Chargebacks: if the customer already won a chargeback for a line, mark it `refunded` with source `chargeback` and block further refunds.

## 8. Bundles and promotions

**Bundle returned partially.** Re-price retained items at standalone prices.
```
paid_for_bundle           = 150.00   (items A=100 list, B=80 list; bundle discount 30)
customer keeps A, returns B
retained_at_standalone    = 100.00
refund                    = paid_for_bundle - retained_at_standalone = 50.00 (before tax rules)
```
If the standalone-reprice leads to a negative refund, refund 0 and explain.

**Buy X get Y free.** Return X only: Y becomes chargeable at standalone price; refund = X net paid - Y standalone price (min 0). Return both: refund X net paid.

**Free-shipping threshold.** If a partial return drops the order below the threshold, the merchant may re-charge shipping on change-of-mind returns only if the policy stated so before purchase. Default: do not re-charge.

**Gift with purchase.** The gift is returned with the qualifying item; otherwise deduct its documented value.

## 9. Currency and FX

- Refund in the original charge currency and amount basis. Never refund more or less of the *customer's currency* because the exchange rate moved.
- If the merchant settled in another currency, the merchant absorbs FX movement on refunds. Record the settlement-currency amount for finance.
- Display amounts in the customer's currency with the correct symbol and decimals.

## 10. Rounding

- ROUND_HALF_UP at the currency minor unit, per line, per component (net base, fee, tax).
- Remainder rule: when refunding **all remaining units** of a line, set the line refund to `net_paid_remaining` (what is left after prior partial refunds), not `n * rounded_unit`, so the line reconciles to zero.
- The calculator does proportional rounding; if you need the remainder rule exactly, pass a single request that returns all remaining units.

## 11. Worked examples

**A. Simple change of mind, unopened.** Earbuds 129.99, tax 8%.
net = 129.99; fee = 0; tax = 10.40 (10.3992); refund = 140.39.

**B. Opened electronics, restocking fee.** Monitor 389.00, 15% fee, tax 8%.
fee = 58.35; base after fee = 330.65; tax = 26.45; refund = 357.10 (matches calculator).

**C. Discounted order, one unit of two.** Lines: A 2 x 50 = 100; B 1 x 100 = 100; order discount 20 allocated 10/10.
Return one A: net_line(A) = 100 - 10 = 90; per unit 45.00; tax 3.60; refund 48.60.

**D. Fault, full return with shipping.** Desk 449.00, shipping 49.00, tax 8% = 35.92.
Refund = 449.00 + 35.92 + 49.00 = 533.92. Return postage paid by merchant.

**E. Prior partial refund and cap.** Order total 150.00, previously refunded 120.00. New eligible computes to 60.00. Cap: remaining 30.00. Refund 30.00, flag capped, review the earlier refund for consistency.

**F. Bundle partial.** See section 8; refund = 50.00 pre-tax, tax at the rate on the refunded net.

**G. Restocking on discounted line.** Laptop 1,000.00 list, line discount 100, fee 15%.
net = 900; fee = 135; base = 765; tax(8%) = 61.20; refund = 826.20. Above a USD 1,000 threshold? No: auto-approved.

## 12. Reconciliation and idempotency

- Every refund carries an **idempotency key** (`order_id + request_id + line set`). Reprocessing the same key returns the original result, never a second refund.
- Persist: components (net, fee, tax, shipping), method, processor refund ID, timestamps, actor.
- Daily reconciliation: sum of refunds in the order system equals refunds in the payment processor, per currency. Differences go to finance review.
- Track refunds against revenue recognition: refunds reverse revenue and tax in the period of the refund, with reason codes feeding return-rate and defect-rate reporting.
