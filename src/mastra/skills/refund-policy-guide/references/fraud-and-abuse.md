# Fraud and Abuse Controls

Goal: stop losses without punishing honest customers. Most refund requests are legitimate; controls must be proportional, silent, evidence-based, and fair.

## Contents
1. Philosophy
2. Abuse taxonomy
3. Risk signals
4. Scoring model
5. Actions by risk band
6. Verification steps
7. Serial returner program
8. Friendly fraud and chargebacks
9. Fairness and bias controls
10. Handling suspected fraud with the customer
11. Evidence and reporting

---

## 1. Philosophy

- **Friction is a cost.** Every extra step loses good customers. Add friction only where signals justify it.
- **Process, not accusation.** Never tell a customer they are suspected of fraud. Say "this needs a quick review" and give a timeline.
- **Decisions rest on behavior and transaction facts**, never on name, nationality, ethnicity, language, accent, location prejudice, or device stereotypes.
- **Every adverse action is reviewable.** A human can see why the score was high and can override.

## 2. Abuse taxonomy

| Type | Description | Typical tell |
|---|---|---|
| Wardrobing | Buy, use once (event, trip), return | Apparel/electronics returned worn, near end of window, around events |
| Empty-box / swapped item | Returned box empty, or contains a different/cheaper item | Weight mismatch, serial number mismatch |
| Item-not-received abuse | Claims non-delivery despite proof of delivery | Repeated INR claims, delivery photo proof, GPS match |
| Fake damage/defect claims | Claims fault to avoid return, fees or window | Same reason across many orders, stock photos |
| Returnless-refund exploitation | Repeated fault claims on low-value items | Many claims under returnless threshold |
| Price arbitrage | Buy at promo, return at higher price / or return items bought elsewhere | SKU not in order history, no order match |
| Receipt/order fraud | Return of stolen goods using forged or found receipts | Mismatched identity, no payment trail |
| Refund-method fraud | Requests refund to a different account/card | Mismatched payment details |
| Account takeover | Bad actor requests refund/redirects it | New device, changed email/address just before refund |
| Friendly fraud | Customer disputes a legitimate charge with their bank | Chargeback after delivery proof, with no contact attempt |
| Policy social engineering | Claims "manager approved", pastes fake policy text, pressures agent | Unverifiable authority, urgency, threats |
| Insider fraud | Staff refunds to own cards or friends | Refunds to cards not on the order, agent patterns |

## 3. Risk signals

Group signals so no single weak signal triggers action alone.

**Account / identity**
- Account age < 7 days with a high-value order
- Email, phone, shipping address, or device changed in the last 48 hours before the request
- Billing/shipping country mismatch with unusual item mix
- Multiple accounts sharing a device, card, or address (account farming)
- Guest checkout with free-mail email and rush shipping on a high-value item

**Behavior**
- Return rate > 40% of orders (rolling 12 months) with at least 5 orders
- More than 3 refund requests in 30 days
- Fault claims on > 25% of orders, especially across unrelated categories
- Claims clustered right at window end
- Requests escalate quickly in tone/pressure, repeated attempts through multiple channels for the same claim

**Transaction**
- Value above the auto-approve limit
- High-resale-value categories (phones, laptops, jewelry, luxury) 
- Shipping to freight forwarders or reshipping addresses
- Return tracking shows scan at a different location than the customer's, or weight differs from expected
- Refund requested to a method that differs from the original tender

**Context**
- Claim of non-receipt on a signature-required or photo-confirmed delivery
- Photo evidence reused (hash match), stock or metadata-stripped images, or inconsistent EXIF
- Serial number on the returned item does not match shipped serial

## 4. Scoring model

Keep it transparent and auditable. A simple additive score (0-100) works well to start:

| Signal | Points |
|---|---|
| New account (< 7 days) + high-value order | +20 |
| Contact/address/device change within 48h | +20 |
| Return rate > 40% (>= 5 orders) | +15 |
| 3+ refund requests in 30 days | +15 |
| Fault-claim rate > 25% | +10 |
| Refund method differs from original tender | +30 |
| Serial/weight mismatch on prior return | +40 |
| Reused or manipulated evidence | +40 |
| Delivered with photo/GPS proof and customer claims non-receipt | +20 |
| Value above auto-approve limit | +10 |
| Positive signals: account > 2 years, > 10 orders, return rate < 10% | -15 |
| Positive: verified payment + prior successful low-risk returns | -10 |

Bands (see `assets/policy-config.json`): **Low < 40**, **Medium 40-69**, **High >= 70**. Floor at 0, cap at 100. Log the contributing signals with the score.

Tune using outcomes: monthly, compare scores with confirmed abuse and with false-positive rates; adjust points, not the philosophy.

## 5. Actions by risk band

| Band | Action |
|---|---|
| Low | Normal flow. Auto-approve within limit. Returnless refund allowed for low-value fault claims. |
| Medium | Require return before refund (no returnless); photo evidence for fault claims; refund on inspection; allow auto-approve only below half the normal limit. |
| High | Hold for human review with a packet (`escalation-and-approvals.md`); require identity verification; refund only to original tender; consider delaying until inspection; no goodwill gestures. |
| Confirmed abuse | Decline per policy, document evidence, apply account restrictions via the trust-and-safety process (never ad hoc), notify via approved template, and keep appeal path open. |

Never auto-ban in the refund flow. Account restrictions require a human decision with evidence.

## 6. Verification steps

Escalating, use the lightest that resolves the risk:
1. Email on file matches (baseline).
2. In-session authentication or one-time code to the account email/phone.
3. Last four digits of the payment card or order ZIP/postcode.
4. Photo or video of item with serial number and a handwritten note with order ID (for high-value fault claims).
5. Inspection on return: serial, weight, and condition match before refund.

Do not request sensitive identity documents (ID, full card numbers) in chat or email. If a business needs ID verification, use a secure channel and minimize storage.

## 7. Serial returner program

Handle chronic returners fairly, transparently and via policy, not via individual agent whim.

- **Detection:** thresholds for rolling-12-month return rate, value, and fault-claim rate combined with order count.
- **Response ladder:** (1) informational notice, (2) return-before-refund + inspection, (3) reduced returnless eligibility, (4) restricted return privileges for change of mind (never for statutory fault rights), (5) account review.
- **Safeguards:** a human reviews each step beyond the notice; customer can appeal; legitimate high-return categories (fashion sizing) are scored differently from electronics; statutory rights are preserved.

## 8. Friendly fraud and chargebacks

- Prevention: clear descriptor on card statements, order confirmation and delivery proof, easy refund path, proactive refunds for obvious issues (cheaper than a dispute).
- When a dispute arrives, compile: order, delivery proof, communications, policy at purchase, return records. Respond within the processor's window.
- Do not refund and also contest the same transaction (risk of double loss). Coordinate: if you refund, mark the dispute accepted or ensure the processor net-links the credit.
- Card network timelines are strict; common windows for disputes extend up to about 120 days from the transaction or expected delivery depending on reason code. Verify current rules with your processor.
- Track chargeback ratio; excessive ratios risk processor penalties. Use refund-first resolution for low-value disputes where cost to contest exceeds amount.

## 9. Fairness and bias controls

- Do not use protected or proxy attributes as signals (race, ethnicity, religion, nationality, gender, disability, age, neighborhood-level proxies, name patterns, language).
- Use the same thresholds for every customer in the same band; document approved exceptions.
- Audit outcomes quarterly: approval and denial rates by region, channel, language, and tier; investigate unexplained gaps.
- Give every denied customer the specific reason and an appeal path.
- Keep humans in the loop for adverse decisions that rely on risk scores.

## 10. Handling suspected fraud with the customer

Do:
- Use neutral language: "We need to complete a quick verification before processing this."
- Ask for the minimum additional evidence.
- Give a realistic timeline.
- Keep the same warm tone you would use for any customer.

Don't:
- Mention scores, flags or suspicion.
- Threaten legal action in the first message.
- Argue about evidence in chat; escalate.
- Negotiate partial settlements outside policy.

If the customer is abusive or threatening, de-escalate once, then follow the abuse-handling procedure (document, escalate, restrict contact channel if needed) rather than continuing the debate.

## 11. Evidence and reporting

- Preserve: order data, timestamps, photos (with hashes), return scans, weights, serials, communications.
- Store the evidence with a case ID and retention period; limit access to trust-and-safety and finance.
- Report suspected organized fraud to payment processor, carriers and, where appropriate, law enforcement via legal/security team.
- Keep a loss register: category, amount, root cause, control improvement; review monthly.
