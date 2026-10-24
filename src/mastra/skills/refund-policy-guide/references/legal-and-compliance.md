# Legal and Compliance Orientation

> **Not legal advice.** This file orients policy writers and agents to the rights that commonly override a merchant's refund policy. Laws change and differ by product, customer type and region. Have counsel review the public policy for every market you sell into, and re-check this file's points against current sources before relying on them.

## Contents
1. How to use this file
2. Hierarchy of rules
3. Nigeria
4. United States
5. European Union and United Kingdom
6. Other regions (orientation only)
7. Payment-network and processor rules
8. Disclosures that make a policy enforceable
9. Records, retention, privacy
10. Compliance checklist for a refund policy

---

## 1. How to use this file

- When a request touches a legal right, **do not deny**. Escalate to a human with the facts (see `escalation-and-approvals.md`) and apply `R-LAW-OVERRIDE` if the statutory remedy is clear.
- Identify the customer's jurisdiction from the delivery/billing country and the merchant's trading entity. If multiple regimes could apply, apply the more consumer-protective rule and let legal confirm.
- A policy line like "all sales final" or "no refund" does not remove statutory rights for defective, unsafe, or misdescribed goods in the regimes below.

## 2. Hierarchy of rules

1. Mandatory law (consumer protection, sale of goods, payments, privacy)
2. Payment network and processor rules
3. Platform/marketplace rules the merchant has signed up to
4. Public policy and terms of sale
5. Internal SOP and goodwill practice

If a lower level conflicts with a higher level, follow the higher level and file a defect on the lower one.

## 3. Nigeria

Key instrument: **Federal Competition and Consumer Protection Act 2018 (FCCPA)**, enforced by the **FCCPC**. The **Sale of Goods Act 1893** continues to apply as a statute of general application, with the FCCPA prevailing on conflict.

Points relevant to refunds (summarized from commentary on the Act; verify against the current text):
- **Section 122** gives a consumer the right to return goods and get a **full refund** where the goods are unsafe or defective, unfit for a purpose made known to the supplier, or do not match the sample or description given.
- **"No return, no refund" is not a valid shield** against those rights. The FCCPC has publicly said it is unlawful to enforce such a blanket policy, including in Lagos markets, and that it can mediate complaints and impose sanctions on non-compliant businesses.
- A **store-credit-only** policy that denies a cash refund for defective or unsuitable goods may be treated as unfair/undermining the Act.
- Implied conditions of **fitness for purpose and merchantable quality** under the Sale of Goods Act support refund and other remedies.
- Consumers have a right to **transparency**: terms must not hide key obligations; refund conditions should be clear before purchase.
- Services not rendered as agreed carry a refund right.

Operational guidance for Nigerian customers:
- Fault claims (defective, unfit, not as described) are refunded in money on request. Store credit or replacement is an offer, not a requirement.
- Change-of-mind returns can be limited by policy but the limits must be disclosed before sale and must not conceal fault remedies.
- Display the return/refund policy at checkout and in the order confirmation; keep a consumer-complaints channel and mention that complaints can be taken to the FCCPC.
- Price display and VAT: VAT is 7.5%; use tax-inclusive handling in `calculation-rules.md` where prices include VAT.
- Data handling: the Nigeria Data Protection Act 2023 applies to personal data used in refund processing (minimization, purpose limits, security).
- Local payment rails: refunds to cards, bank transfer or wallets take longer in practice; communicate realistic timelines (config: 7-10 business days for bank transfer).

## 4. United States

There is **no general federal right to return** goods bought in stores; merchants set return policies, subject to federal and state law.

- **Federal Trade Commission (Mail, Internet, or Telephone Order Merchandise Rule):** ship within the promised time (or 30 days if none stated); if delayed, give the customer an option to consent to the delay or cancel for a prompt refund.
- **FTC Act / state UDAP laws:** policies and refund promises must not be deceptive; "free," "money-back," and "satisfaction guaranteed" claims must be honored as stated.
- **Warranty law (Magnuson-Moss, UCC):** implied warranty of merchantability and written warranties apply; disclaimers must be conspicuous and lawful.
- **State laws:** several states require clear posting of refund policies; if not posted, customers may have a default return right for a period (for example California's posting requirement). Check each state you ship to.
- **Credit-card billing errors:** the Fair Credit Billing Act lets cardholders dispute billing errors within about **60 days** of the statement; debit/electronic transfers have similar timelines under Regulation E. Card-network chargeback windows are separate and commonly longer.
- **Auto-renewals/subscriptions:** state auto-renewal laws and consent rules require clear disclosure and easy cancellation; treat unauthorized renewals as refundable.
- **Product safety:** CPSC reporting and recall obligations override refund policy. Offer remedies without return friction for recalled items.

## 5. European Union and United Kingdom

- **14-day right of withdrawal** for distance and off-premises sales (EU Consumer Rights Directive; UK Consumer Contracts Regulations 2013). Counted from receipt of goods (or conclusion for services). No reason needed.
  - Merchant refunds within **14 days** of being informed of withdrawal; may withhold the refund until goods are received back or proof of dispatch is provided.
  - Refund includes **standard outbound delivery**; the consumer bears return costs only if told beforehand.
  - Consumer is liable for diminished value from handling beyond what is needed to inspect the goods.
  - **Exceptions** include made-to-measure/personalized goods, perishables, sealed hygiene or audio/video items once unsealed, and digital content once performance has begun with the consumer's prior express consent and acknowledgement.
- **Faulty goods:** EU legal guarantee of at least **2 years** with a presumption that defects appearing in the first year existed at delivery (member states may extend). UK Consumer Rights Act 2015: short-term right to reject within **30 days**, then repair/replace, with a longer period where the burden of proof sits with the trader (first 6 months).
- Replacements/refunds for faults cannot be limited by commercial "no refund" terms.
- Required pre-contract information: withdrawal right, how to exercise it (model withdrawal form), who pays return.
- Subscriptions and digital services have additional cancellation and information rules; follow national transpositions.

## 6. Other regions (orientation only; confirm locally)

- **Canada:** provincial consumer protection; distance-sale cooling-off in some provinces; clear disclosure of return policy.
- **Australia:** Australian Consumer Law gives remedies for **major failures** (refund or replacement at the consumer's choice) and minor failures (repair/replace); "no refunds" signs are misleading for faulty goods.
- **India:** Consumer Protection (E-Commerce) Rules 2020: marketplace/e-commerce entities must honor stated refund policies, designate a grievance officer, acknowledge complaints quickly and redress within a stated period; confirm current timelines.
- **South Africa:** Consumer Protection Act gives rights for defective goods and a cooling-off period for direct marketing/online sales.
- **UAE, Saudi Arabia, Kenya, Ghana and others:** consumer laws are evolving; require local counsel.

## 7. Payment-network and processor rules

- Refund to the **original tender** wherever possible. Refunding to a different method creates fraud and AML risk and may violate network rules.
- Credits must reference the original transaction (use the processor's refund API, not a new payout).
- Do not refund more than the captured amount; partial refunds must not exceed the remaining captured balance.
- Do not pay cash to refund a card purchase.
- Disputes/chargebacks: respond within the processor's deadline with evidence (`fraud-and-abuse.md`). Refunding a transaction already in dispute can cause double loss; coordinate.
- Refund timelines: banks typically take several business days after the merchant issues the credit; communicate "issued by us on date X, appears within Y days at the bank".
- AML/KYC: unusual patterns (refund to third-party accounts, many small refunds, round-tripping) require review by finance/compliance.
- Stored value and gift cards may be subject to e-money or unclaimed-property rules; confirm.

## 8. Disclosures that make a policy enforceable

- Visible before purchase (product page, cart, checkout) and in the order confirmation.
- Plain language, in the language of the sale.
- Each limitation (final sale, restocking fee, category exclusions) is shown **where it applies**, not only in the footer.
- Policy version and effective date.
- Customer service contact and complaint route (including a regulator mention where required).
- For digital content and services: consent and acknowledgement checkboxes where required.

## 9. Records, retention, privacy

- Keep refund decision records, evidence, and communications for the period required by tax, consumer, and payments regulations (commonly several years; confirm per jurisdiction).
- **Data minimization:** collect only what is needed for the decision (order ID, email, reason, photos of the item). Do not collect ID documents in chat; never store full card numbers (PCI scope).
- Redact sensitive details in logs and prompts; limit evidence access to those who need it.
- Respect access and deletion requests while preserving records that law requires you to keep.
- Cross-border transfers: follow the applicable data-transfer rules for evidence and chat logs.
- AI usage: disclose when a customer is interacting with an automated agent where required, offer a human route, and log automated decisions so they can be explained.

## 10. Compliance checklist for a refund policy

- [ ] Fault remedies cannot be waived by any clause.
- [ ] No blanket "no refund / no return" wording; instead list the specific exclusions.
- [ ] Store credit is optional where cash refund is a legal remedy.
- [ ] Withdrawal/cooling-off right implemented for EU/UK sales (14 days; model form; delivery cost refund).
- [ ] Defect windows at least match statutory minimums for each market.
- [ ] Refund timing stated and honored; refund to original tender.
- [ ] Complaint route and, where relevant, regulator named.
- [ ] Policy displayed pre-purchase and snapshotted per order.
- [ ] Privacy notice covers refund data; retention schedule defined.
- [ ] Counsel review date recorded; next review scheduled.
