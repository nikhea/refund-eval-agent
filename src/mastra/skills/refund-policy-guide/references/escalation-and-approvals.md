# Escalation and Approvals

Who may approve what, when to escalate, and what a human reviewer needs to decide quickly.

## Contents
1. Principles
2. Authority matrix
3. Escalation triggers
4. Review packet template
5. SLAs
6. Exceptions and goodwill
7. Four-eyes and segregation of duties
8. Appeals
9. Handoff etiquette

---

## 1. Principles

- **Escalate with context, not questions.** A reviewer should be able to approve or deny from the packet alone.
- **Authority follows value and risk,** not seniority theatre. Low-value, low-risk cases never wait for a human.
- **The agent never grants exceptions to policy.** It can only apply policy or escalate. Exceptions are a human right with a named approver.
- **Customers are told what is happening:** "A specialist will review this within X hours; you do not need to resend anything."

## 2. Authority matrix (defaults, tune in config)

| Actor | Max refund per case (USD) | Exceptions | Goodwill per case |
|---|---|---|---|
| AI refund agent | 1,000 | None (policy only) | 0 |
| Tier 1 support | 500 | Window +7 days, fee waiver on first-time request | 25 |
| Tier 2 support | 2,500 | Window +30 days, final-sale fault review, returnless up to 100 | 100 |
| Team lead | 10,000 | Policy deviations with documented reason; bulk refunds | 300 |
| Finance manager | 50,000 | Large/bulk, chargeback settlements, legal-driven refunds | n/a |
| Legal/compliance | Any | Statutory-right cases, regulator complaints | n/a |

Cumulative limits: apply the limit to the **sum of refunds on the order and to the customer in the last 30 days**, so splitting a large refund into pieces does not bypass control.

## 3. Escalation triggers

Escalate (do not decide) when any of the following is true:

**Value**
- Refund above the actor's limit.
- Order total above the threshold with a fault claim.

**Risk**
- Risk score in the High band, or Medium band with a sizeable refund.
- Evidence tampering suspected, identity not verifiable, refund to a different tender requested.

**Ambiguity**
- Policy does not clearly cover the case, or two rules conflict.
- Customer disputes the delivery date or condition and evidence is inconclusive.
- Multiple orders/accounts involved in one claim.

**Legal and safety**
- Statutory right possibly applies and the policy would deny.
- Product safety issue (injury, fire, allergic reaction, child safety): escalate immediately to safety/quality, stop selling the SKU pending review.
- Regulator, lawyer, media, or social-media escalation threat.
- Vulnerable customer (bereavement, financial hardship disclosed, accessibility needs): follow the vulnerable-customer protocol, which usually means more flexibility and a human contact.

**Customer request**
- Customer explicitly asks for a human after a denial, or disputes the decision twice.
- Repeated contact on the same issue across channels.

## 4. Review packet template

```
CASE: <case id>   ORDER: <order id>   CUSTOMER: <id, tier, tenure, order count>
REQUEST: <reason, condition, items, desired outcome>   OPENED: <timestamp via channel>
VERIFICATION: <method, result>
POLICY CHECK: <rules applied, blockers, in-window yes/no, days since delivery>
CALCULATION: items <x> fee <x> tax <x> shipping <x> TOTAL <x> <currency> -> <method>
RISK: score <n> (band) signals: <list>   PRIOR REFUNDS 12m: <count, amount>   RETURN RATE: <pct>
EVIDENCE: <photos/videos/serials/tracking links>
CUSTOMER SENTIMENT/NOTES: <short factual summary, no speculation>
AGENT RECOMMENDATION: <approve/deny/partial + one-line reason>
WHAT I TOLD THE CUSTOMER: <commitments and timeline>
DECISION NEEDED BY: <timestamp per SLA>
```

Rules for packets: facts over opinions, quote evidence, never include sensitive data not needed for the decision, never paste full card numbers or ID documents.

## 5. SLAs

| Case type | First response | Decision | Refund issued |
|---|---|---|---|
| Standard refund within limit | Instant (agent) | Instant | Per method ETA (see config) |
| Escalated: value/risk | 1 business hour acknowledgment | 1 business day | Within 2 business days of approval |
| Fault claim with evidence needed | 1 business hour | 1 business day after evidence | Same |
| Statutory/regulator-related | 4 business hours | 2 business days (legal review) | Within 2 business days of approval |
| Product safety | Immediate | Same day | Immediate, no return needed |
| Appeals | 1 business day | 3 business days | Same |

Define SLA clocks as pausing only while awaiting the customer. Monitor breaches daily.

## 6. Exceptions and goodwill

An **exception** is a deviation from policy rules (window extension, fee waiver, accepting a used item). A **goodwill gesture** is value beyond what is owed (credit, discount, expedited shipping).

Approve exceptions only when:
- The customer is in good standing (risk Low, no unresolved abuse flags), and
- The cost is within the approver's limit, and
- The reason is documented using a code (`R-GOODWILL` + sub-code: `late-delivery`, `service-failure`, `loyalty`, `vulnerable-customer`, `merchant-error`), and
- It does not create a precedent the business cannot repeat for similar customers. If it would, change the policy instead.

Merchant-caused failures (late delivery, wrong packaging, support mistakes) justify more generous remedies than customer-preference requests. Do not trade away safety or legal compliance for goodwill.

Record the cost of exceptions monthly and review the top reasons; repeated exceptions signal a policy gap.

## 7. Four-eyes and segregation of duties

- The person who requests a refund cannot be the only approver above a threshold (default above Tier 2 limit: second approval).
- Staff may not refund their own orders, family, or accounts they have a relationship with; the system should block this.
- Refund to a payment method different from the original tender requires finance approval.
- Admin changes to policy config require peer review plus eval-suite pass.
- Monthly sampling of refunds by an independent reviewer (see `governance-and-metrics.md`).

## 8. Appeals

- Every denial states how to appeal (reply, link, or contact) and who reviews it.
- Appeals are reviewed by a person who did not make the original decision.
- The reviewer sees the full packet and any new evidence; outcomes: uphold, overturn, partial; reasons recorded.
- If an appeal reveals a policy gap or agent error, create a policy/prompt fix ticket.
- Preserve statutory complaint routes in the denial message where they exist (e.g. consumer protection authority).

## 9. Handoff etiquette

- Tell the customer exactly what happens next, who owns it, and when they will hear back.
- Never make the customer repeat information already captured.
- Do not promise the outcome of a review. Promise the timeline and the next communication.
- When a human decides, notify the customer proactively. Do not wait for them to chase.
