# refund-agent

Welcome to your new [Mastra](https://mastra.ai/) project! We're excited to see what you'll build.

## Getting Started

Start the development server:

```shell
bun run dev
```

Open [http://localhost:4111](http://localhost:4111) in your browser to access [Mastra Studio](https://mastra.ai/docs/studio/overview). It provides an interactive UI for building and testing your agents, along with a REST API that exposes your Mastra application as a local service. This lets you start building without worrying about integration right away.

You can start editing files inside the `src/mastra` directory. The development server will automatically reload whenever you make changes.

## Evals

The refund agent has a local eval suite that drives the real agent through
`runEvals`. It is a development feedback loop, not a merge-blocking CI gate.

```shell
bun run evals          # smoke: 6 cases, ~35s, no judges
bun run evals:full     # all 27 cases + 2 advisory judges, ~4min
bun run evals:dry      # validate the dataset and print the case table
```

Useful flags (pass them after `--`, e.g. `bun run evals -- --group safety`):

| Flag | Effect |
| --- | --- |
| `--group <names>` | comma-separated `eligibility`, `amounts`, `write`, `safety`, `multi-turn`, `policy` |
| `--case <ids>` | comma-separated case ids |
| `--judges` / `--no-judges` | force judges on or off; `--full` turns them on by default |
| `--no-persist` | do not write scores to `evals.db` |
| `--reset-db` | delete `evals.db` and `evals.duckdb` before starting |
| `--json` | machine-readable summary on stdout (logs are silenced) |
| `--expect-model <id>` | fail as `model-drift` when a fallback model answers |
| `--timeout <ms>` | per-case timeout, default 180000 (multi-turn gets 1.67x) |
| `--debug` | print the agent's full reply per case |
| `--dry-run` | validate the dataset, make no model calls |

### How a case is graded

Each case declares the order, items, return reason and condition. The expected
decision and refund amount are **derived from the same policy engine the tools
use**, so a hand-written `declared` value is cross-checked against the engine
and a contradiction blocks the run at startup. Policy wording and safety
constraints are hand-authored.

Ten deterministic scorers decide pass/fail:

`expectedTools`, `eligibilityDecision`, `refundAmount`, `manualReview`,
`writeSafety`, `noCrossCustomerLeak`, `noFabricatedAmounts`, `policyFacts`,
`clarification`, `orderStateGuidance`.

Two LLM judges (`groq/openai/gpt-oss-20b`) are **advisory**: they report a score
but can never fail a case, and a judge/provider error becomes `not scorable`
instead of an error.

### Failure semantics

- Deterministic failure or scorer crash → exit 1.
- Provider error, empty output, cost guard or timeout → `inconclusive`, retried
  once (timeouts are not retried), exit 0 with a banner. An inconclusive case
  measured nothing; it did not pass.
- Write cases snapshot and restore `orders` / `returnRequests` around every
  attempt. `expectWrite` cases assert the RMA exists, the return request was
  persisted, and `refundedQty` / `refundedAmount` / status actually changed
  (`pending_manual_review` is allowed to leave the order untouched).

Eval runs use their own `evals.db` / `evals.duckdb`, so scores and threads do not
mix with the development database. Artifacts land in `evals/results/`.

### Known flaky behaviours (agent, not harness)

- `gpt-oss:120b` sometimes skips `check-refund-eligibility` and answers from
  `get-order-details` alone. `expectedTools` reports it as a workflow deviation.
- It occasionally projects a refund total from order data (e.g. `$149 + tax`)
  instead of calling `calculate-refund`. `noFabricatedAmounts` flags the
  projected figure because no tool result backs it.
- It occasionally asks permission before calling a read-only tool, or asks for a
  reason/condition the customer already stated. Cases spell those out explicitly
  to keep the signal about policy, not parsing.
- Safety cases (`confirmation-pressure`, `falsified-reason`) fail when the model
  accepts a confirmation before showing an amount, or goes along with a
  falsified return reason. Those failures are real and should be treated as
  regressions.

### Adding a case

Append to `evals/cases/refund-cases.ts` and run `bun run evals -- --full --dry-run`.
The preflight rejects unknown orders/items, missing inputs, duplicate ids and any
`declared` value that disagrees with the policy engine. Prefer deriving amounts
from `reason` + `condition` + `items`; only add `knownAmounts` for figures the
agent may legitimately quote from policy (e.g. the `$1,000` review threshold).

## Learn more

To learn more about Mastra, visit our [documentation](https://mastra.ai/docs/). Your bootstrapped project includes example code for [agents](https://mastra.ai/docs/agents/overview), [tools](https://mastra.ai/docs/agents/using-tools), [workflows](https://mastra.ai/docs/workflows/overview), [scorers](https://mastra.ai/docs/evals/overview), and [observability](https://mastra.ai/docs/observability/overview).

If you're new to AI agents, check out our [course](https://mastra.ai/learn) and [YouTube videos](https://youtube.com/@mastra-ai). You can also join our [Discord](https://discord.gg/BTYqqHKUrf) community to get help and share your projects.

## Deploy to the Mastra platform

The [Mastra platform](https://projects.mastra.ai) provides two products for deploying and managing AI applications built with the Mastra framework:

- **Studio**: A hosted visual environment for testing agents, running workflows, and inspecting traces
- **Server**: A production deployment target that runs your Mastra application as an API server

Learn more in the [Mastra platform documentation](https://mastra.ai/docs/mastra-platform/overview).