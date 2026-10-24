# Governance and Metrics

Run refunds as a managed system: measure it, audit it, and change it safely.

## Contents
1. Ownership
2. KPIs
3. Dashboards and alerts
4. Audit trail
5. QA sampling
6. Root-cause loop
7. Policy change management
8. Finance and accounting
9. Training and calibration
10. Incident response

---

## 1. Ownership

| Role | Owns |
|---|---|
| Policy owner (CX/Operations) | Public policy, SOP, exception rules, KPIs |
| Finance | Refund accounting, reconciliation, limits, chargebacks |
| Legal/Compliance | Statutory review, regulator contact, disclosures |
| Trust and Safety | Abuse rules, risk scoring, serial-returner program |
| Product/Engineering | Tools, config, agent, eval suite, logging |
| Quality/Merchandising | Defect trends, supplier recovery, safety escalations |

Run a monthly **Refund Council** (30-45 minutes): KPIs, top exceptions, appeals, fraud losses, policy defects, upcoming changes.

## 2. KPIs

**Customer**
- Time to resolution (median, p90)
- First-contact resolution rate
- Refund ETA accuracy (issued vs promised)
- CSAT after refund interactions; appeal rate; complaint-to-regulator count

**Operational**
- Auto-approve rate; escalation rate; reversal rate (human changed agent decision)
- Reopen rate; SLA breach rate
- Cost per refund case

**Financial**
- Refund rate (refunded value / revenue) and return rate (units), by category and by reason
- Refund leakage: refunds outside policy / total
- Fraud/abuse loss rate; recovered amounts
- Chargeback ratio and win rate
- Restocking fee recovery; returnless-refund spend

**Product/quality**
- Defect rate by SKU/supplier (fault returns / units sold)
- Damage-in-transit rate by carrier/warehouse
- Wrong-item rate by fulfillment node

**Fairness**
- Approval/denial rates by region, language, channel, tier (monitor gaps, investigate)

Targets are business-specific. Set baselines first, then improve one lever at a time.

## 3. Dashboards and alerts

Dashboards: daily refund value and count, by reason; escalation queue age; agent vs human outcomes; abuse signals; carrier and SKU hot spots.

Alerts (page the owner):
- Daily refund value > 2x trailing 28-day average
- A SKU's fault-return rate doubles week over week (possible batch defect or safety issue)
- Many approvals just below a threshold from one actor/customer (threshold gaming)
- Refunds to payment methods other than the original tender
- Tool error rate above baseline; processor refund failures
- Staff refunding accounts they are linked to
- Escalation SLA breach

## 4. Audit trail

For every decision store:
- Order ID, customer ID (hashed where possible), verification method/result
- Request facts (reason, condition, items), evidence references
- Rules applied, blockers, policy version, config version
- Amounts and components, currency, method, processor refund ID
- Risk score + signals
- Actor (agent/human), approver, timestamps, channel
- Prompt/model/skill versions for agent decisions
- Customer confirmation record
- Outcome of appeals

Immutability: append-only; corrections are new entries. Retention per `legal-and-compliance.md`.

## 5. QA sampling

- Sample 5% of auto-approved cases and 20% of escalations monthly; oversample high-value, High-risk and appeals.
- Reviewers score: policy correctness, calculation correctness, communication quality, evidence handling, risk handling.
- Calibrate reviewers quarterly on the same 10 cases; target agreement above 90%.
- Critical error definition: wrong money amount, refund to wrong party, data disclosure, denial of a statutory right, accusatory tone.
- Feed errors into: agent prompt/eval updates, SOP fixes, training.

## 6. Root-cause loop

For each high-volume reason code:
1. Quantify volume and cost.
2. Classify root cause: product defect, listing accuracy, sizing/fit guidance, packaging/carrier, fulfillment error, expectation gap, abuse.
3. Assign an owner and a fix (listing change, supplier claim, packaging change, carrier switch).
4. Track the effect on the return rate.

Recover costs: supplier chargebacks for defects, carrier claims for damage, internal cost allocation for fulfillment errors.

## 7. Policy change management

- **Proposal:** problem statement, data, options, customer impact, financial impact, legal review.
- **Simulation:** replay the last 90 days of refund requests against the proposed config (use the calculator/engine) and report changes in approvals and cost.
- **Approval:** policy owner + finance + legal for customer-facing changes.
- **Release:** version bump (`policy_version`), update public policy, SOP, config, skill, evals together. Announce internally with effective date; train support.
- **Grandfathering:** orders placed before the effective date keep the old policy (or the more favorable one).
- **Rollback plan:** previous config retained; feature flag for new rules.
- **Post-launch review:** two weeks and eight weeks.

Never change thresholds silently or ad hoc to fix one case.

## 8. Finance and accounting

- Refunds reverse revenue and tax in the period issued; record reason codes for analysis.
- Maintain a refund liability/reserve estimate based on return rates and open windows.
- Daily reconciliation between the order system and processor; investigate variances within 2 business days.
- Separate ledgers for goodwill and exceptions to track cost.
- Segregation of duties as in `escalation-and-approvals.md`.
- Currency: record presentment and settlement amounts; track FX gains/losses on refunds.
- Month-end: aging of pending refunds, uncleared returns, and unclaimed store credit (check local unclaimed-property rules).

## 9. Training and calibration

- New agent/staff onboarding: 2 hours on the principles + 10 cases from `edge-cases.md` with feedback.
- Quarterly refreshers on policy changes and legal updates.
- Share "great saves" and "avoidable denials" examples.
- For the AI agent: treat the eval suite as training; add every production error as a regression case.

## 10. Incident response

Examples: bulk-refund bug, agent approving out of policy, data exposure in a refund message, processor outage, coordinated abuse campaign.

1. **Contain:** pause auto-approvals or the affected tool; switch to human-only.
2. **Assess:** scope (orders, amounts, customers), time window, root cause.
3. **Remediate:** correct customers fairly (do not claw back from customers for the merchant's error unless law allows and policy states it); recover funds from abusers via proper channels.
4. **Notify:** finance, legal; customers and regulators when required (data exposure).
5. **Learn:** postmortem within 5 business days; add tests; update controls and this skill.
