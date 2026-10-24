# Policy Framework

How to structure a refund policy so that it is complete, enforceable, explainable, and consistent across humans and agents.

## Contents
1. Policy architecture (three layers)
2. Definitions
3. Remedy ladder
4. Windows and clocks
5. Condition standards
6. Fees and deductions
7. Shipping and return logistics
8. Final sale, personalized and restricted items
9. Order states
10. Bundles, promotions, and discounts
11. Subscriptions, services, digital goods
12. Marketplace and third-party sellers
13. Rule ID catalogue
14. Policy-writing checklist

---

## 1. Policy architecture (three layers)

| Layer | Audience | Content | Change control |
|---|---|---|---|
| **Public policy** | Customers | Plain-language rights, windows, how to start a return, what is not returnable | Legal + CX approve; versioned; dated; archived |
| **Operating policy (SOP)** | Support, agents, finance | Exact rules, tables, rule IDs, formulas, authority limits, exception paths | Policy owner approves; weekly review of exceptions |
| **Config** | Systems | Numeric parameters (`policy-config.json`): windows, fees, thresholds | Change ticket + peer review + test run of the eval suite |

Keep the three consistent. The public policy must never promise more than the SOP can deliver, and the SOP must never be stricter than the public policy (the customer relies on what was published at time of purchase).

**Version at time of purchase:** the policy in force when the order was placed governs that order. Store a `policy_version` on each order.

## 2. Definitions

Define every term the rules depend on, in the policy itself.

- **Delivery date:** carrier-confirmed delivery scan; if disputed or missing, the date the customer reports plus carrier trace. For digital goods: the date access was granted.
- **Unused:** not worn, washed, installed, activated, consumed, or altered; original packaging, tags, accessories and manuals present. Trying on or inspecting as in a store is allowed.
- **Unopened:** factory seal intact.
- **Defective:** fails to work as designed or as described within normal use; includes manufacturing defects and early failure. Excludes damage caused by misuse, accidents, unauthorized repairs, normal wear.
- **Damaged in transit:** physical damage present on arrival and not caused by the customer.
- **Wrong item:** SKU, size, colour, model or quantity differs from what was ordered.
- **Not as described:** materially differs from listing (specifications, images, claims).
- **Fault reasons:** defective, damaged in transit, wrong item, not as described, not received.
- **Change of mind:** any reason not attributable to the merchant (size/fit, taste, found cheaper, duplicate purchase).
- **Net paid:** price after line and allocated order discounts, before tax.
- **Refund:** money returned to the original tender. **Store credit:** value on account. **Exchange:** like-for-like replacement or different SKU with price difference settled.

## 3. Remedy ladder

Offer remedies in this order for fault claims, unless the customer prefers otherwise or the law gives them the choice:

1. **Replacement or repair** if the customer wants the item and it is in stock/repairable quickly.
2. **Full refund** (always available for fault within window; the customer may insist).
3. **Partial refund / price adjustment** for minor defects the customer would rather keep.

For change of mind, the ladder is: **exchange > store credit (with small bonus optional) > refund** only where the business sets it that way. Most businesses refund to original tender by default; if store credit is offered first, it must be an offer, never a condition, and never used to defeat a statutory refund right.

## 4. Windows and clocks

- Clock starts at **delivery**, not order or shipment.
- Day 0 is the delivery day; day N is N calendar days after. A claim on day N is in-window if N <= window.
- Time zone: use the customer's local time or UTC consistently; document which.
- Carrier-delayed or redelivered parcels restart the clock at actual delivery.
- Pause rules: window pauses while the merchant is awaiting a response to its own request (e.g. we asked for photos); the customer never loses days because of merchant delay.
- Holiday extension: optional seasonal policy (e.g. purchases from 1 Nov receive returns until 15 Jan). State it explicitly and snapshot it into `policy_version`.
- Return must be **initiated** within the window; the physical return can arrive later (default +14 days after label issued).
- Defect window (default 90 days) is separate from any manufacturer warranty. After the window, route to warranty (repair/replace), and still respect statutory remedies.

## 5. Condition standards

| Condition | Change-of-mind result | Fault result |
|---|---|---|
| Unopened | Eligible, no fee | Eligible |
| Opened, complete, working | Eligible; category fee may apply (electronics 15%, furniture 10%) | Eligible, no fee |
| Used / worn / installed / consumed | Not eligible (offer goodwill review if value is low and customer is in good standing) | Eligible if defect is demonstrated |
| Missing parts/accessories | Deduct documented replacement cost, or deny if material | Eligible; no deduction (merchant fault) |
| Damaged by customer | Not eligible | Not eligible (offer paid repair if available) |

Evidence standards by claim type:
- Damaged in transit: photos of item + packaging + shipping label; no return needed under a threshold (see returnless refunds).
- Defective: short description, date first noticed, optional video; troubleshooting only if it genuinely helps (do not stonewall).
- Wrong item: photo of item and packing slip/label.
Do not demand more evidence than the claim's value justifies.

**Returnless refunds:** for low-value items (default under USD 20 or where return cost exceeds item value) with a fault reason and good account standing, refund without requiring the item back. Cap per customer per 90 days (default 3) to bound abuse.

## 6. Fees and deductions

Allowed deductions on change-of-mind returns only:
- **Restocking fee** by category (config). Applies only when the item is opened and was returned in resalable condition. If it is unsellable, apply condition rules instead.
- **Missing accessory/packaging deduction** at documented replacement cost.
- **Return shipping** paid by customer (deducted from refund or paid directly).

Never charge fees on fault returns. Never stack a restocking fee and a "used" deduction on the same unit without a human decision. Fees are calculated on **net paid** (after discounts), not on list price.

## 7. Shipping and return logistics

| Item | Fault return | Change of mind |
|---|---|---|
| Original outbound shipping | Refunded if all remaining units are returned and no prior refunds | Not refunded (unless free-returns promotion or law requires) |
| Return postage | Merchant pays (prepaid label or reimbursed) | Customer pays |
| Bulky/furniture pickup | Merchant pays | Customer pays, quoted before confirmation |
| Return method | Label/QR code/drop-off with tracking | Same |
| Refund trigger | On first carrier scan for trusted customers; on receipt/inspection otherwise | On receipt and inspection |
| Inspection SLA | 2 business days after receipt | 2 business days |

Return-in-transit loss: the customer who uses the provided label is not penalized for carrier loss; the merchant files the carrier claim.

## 8. Final sale, personalized and restricted items

- **Never refundable:** gift cards, stored value, tickets for past events, services fully delivered, sealed hygiene items once opened (where law permits).
- **Final sale (clearance, flash):** refundable only for defective, damaged or wrong item. Must be labelled **before** purchase and shown on the order, otherwise it is not enforceable. Store `final_sale: true` and the reason on the line.
- **Personalized/made-to-order:** exempt from change-of-mind, but not from fault remedies.
- **Hazardous/regulated** (batteries, chemicals, medicines): follow safety/recall rules; may require disposal instead of return.
- **Perishables:** fault only, short window (default 7 days), photo evidence, no return of goods.
- **Software/digital:** refundable if defective and support cannot fix; or within a no-use window if the business offers one. Activation/usage forfeits change-of-mind rights where permitted by law (EU requires prior express consent and acknowledgement).

## 9. Order states

See the order-state gate in `SKILL.md`. Additional detail:
- **Cancellation window:** until the warehouse marks the order packed. After that, treat it as a return.
- **Partial shipments:** each shipment is its own delivery date; evaluate lines on their own dates.
- **Delivered but customer says not received:** run the carrier trace (GPS/photo proof, neighbour, safe place) and treat as a fault claim; refund or reship after trace window.
- **Refunded:** record refund ID, amount, method, date; block duplicate refunds with an idempotency key.

## 10. Bundles, promotions, and discounts

- **Bundles:** return the bundle as a unit when priced as a bundle. A single component return forfeits the bundle discount: re-price the retained items at standalone prices and refund the difference between what was paid and the re-priced retained items (see `calculation-rules.md`).
- **Buy-X-get-Y-free:** returning X without Y makes Y chargeable at its standalone price unless the free item is also returned.
- **Percent/amount discounts:** allocate pro rata across lines; refund the net paid.
- **Coupons:** the coupon is not reissued on a change-of-mind return; reissue on fault returns.
- **Loyalty points:** reverse points earned on refunded amounts; restore points redeemed if refund is to points.
- **Price drops:** price adjustment within N days (default 14) as store credit or refund of the difference, once per order; not stacked with other adjustments.

## 11. Subscriptions, services, digital goods

- **Subscriptions:** cancellation stops future charges. Refund the latest charge if the customer cancels within a short grace (default 48 hours) and has not materially used the service; pro-rata refunds for annual plans only where promised or required. Billing errors and unauthorized renewals are always refunded.
- **Services:** refund for services not rendered as agreed; partial refund for the undelivered portion; none for fully performed services except fault.
- **Free trials converting:** refund the first charge if the customer cancels promptly after conversion and reminders were not clear.
- **Digital goods:** see section 8.

## 12. Marketplace and third-party sellers

- State who owns the policy (platform or seller) per order.
- Platform guarantee: if the seller does not respond within 3 business days or refuses a valid fault claim, the platform refunds and recovers from the seller.
- Seller policies cannot be less protective than law or the platform's minimum standard.
- Keep seller-of-record, fulfillment party, and merchant of record on the order for dispute handling.

## 13. Rule ID catalogue

Use these IDs in decision records. Add new ones sparingly; never reuse an ID for a different meaning.

| ID | Meaning |
|---|---|
| R-STATE-CANCELLED / -PROCESSING / -TRANSIT / -REFUNDED | Order-state gates |
| R-WINDOW-<CATEGORY> | Change-of-mind window applied (e.g. R-WINDOW-ELECTRONICS) |
| R-FAULT-WINDOW-DEFECT | 90-day defect window |
| R-FAULT-WINDOW | 30-day damaged/wrong/not-as-described window |
| R-FAULT-NO-FEE | No fees on fault returns |
| R-OUTSIDE-WINDOW | Blocked: past window |
| R-FINAL-SALE | Blocked: final sale |
| R-NEVER-REFUNDABLE | Blocked: gift cards etc. |
| R-FAULT-ONLY-CATEGORY | Category refundable for fault only |
| R-UNOPENED-ONLY | Hygiene/beauty must be unopened |
| R-CONDITION-USED | Blocked: used, change of mind |
| R-RESTOCK-FEE | Restocking fee applied |
| R-ALREADY-REFUNDED | Unit/order already refunded |
| R-SHIP-FAULT-FULL | Shipping refunded on fault, all units |
| R-REVIEW-VALUE | Escalated: above threshold |
| R-REVIEW-RISK | Escalated: risk score |
| R-LAW-OVERRIDE | Statutory right applied over policy |
| R-GOODWILL | Discretionary exception with approver |

## 14. Policy-writing checklist

- [ ] Every window has a clock start, unit (calendar days), and category scope.
- [ ] Fault and change-of-mind are separated everywhere.
- [ ] Every fee shows the base it is computed on.
- [ ] Final-sale labelling requirement is stated.
- [ ] Refund method and timing are stated (days after approval/receipt).
- [ ] Statutory rights sentence included for each jurisdiction served.
- [ ] How to start a return, in three steps or fewer.
- [ ] Exceptions have an owner and an approval path.
- [ ] Effective date, version, and change log.
- [ ] Two reviewers can reach the same decision on 10 sample cases.
