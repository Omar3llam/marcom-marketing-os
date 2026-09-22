# Phase 6: Currency Provenance Foundation

This foundation records denomination origin. It does not make existing monetary
aggregators provenance-aware. Operational Monetary Homogeneity, Planning Goal
Actuals, and frontend Slice A remain separate work, in that order.

## Persistence discovery

| Model / representation | Money and currency | Origin before this change | Consumers / migration |
| --- | --- | --- | --- |
| `MetricSnapshot` / `metric_snapshots` | `spendMinor`, `revenueMinor`, `cpaMinor`, `dailyBudgetMinor`, monetary values inside `actionMetrics`; `currency` | No persisted currency origin | Operational, canonical and daily evidence; Blended Truth, verdicts, pacing, planning and their downstream consumers. One additive column. |
| `Campaign`, `Account`, `AdSet`, `Ad`, `Creative` | No monetary values or currency column | Identity only | Normalized entity upserts. No migration. Canonical campaign *projections* obtain money from snapshots. |
| `NormalizedSnapshot` and actual descriptors | In-memory minor-unit money plus currency | Currency resolution origin lost during adapter/normalizer shaping | No independent table. Carry provenance to the snapshot sinks. |
| `Workspace` | Currency configuration, no source performance money | Onboarding/configuration; may also be updated from Meta | Configuration is not proof that a different source uses this denomination. No migration. |
| Legacy `CampaignState` | Historical schema had currency | Retired writer/reader and dropped table | Not a current ingestion boundary; see retirement migrations and migrationCompatibility baseline. |
| `AllocationPlan`, `AccountEconomics`, `Plan`, `NorthStarGoal`, `TestVariant`, outcomes/holdouts | User budgets, economics, projections, experiment or derived monetary results | Separate product contracts | Not alternate persistence for connector snapshots. Unchanged; downstream provenance handling remains follow-up work. |

The production connector registry contains Meta, Google Ads and GA4. Revenue CSV
is a separate live ingestion path into the same snapshot table. SHOPIFY is an
accepted actuals source tag but has no registered producer. TikTok, Snap and
LinkedIn likewise have no registered ingestion connector in this repository.
Provider-cost telemetry is not campaign performance ingestion.

A read-only production inventory on 2026-09-22 found 403 snapshots: 143 META
LEGACY_UNKNOWN-window rows, 259 META ROLLING_WINDOW rows and one MANUAL row. All
had EGP codes. These counts do not establish currency provenance. No production
migration or data change was performed as part of discovery.

## Persisted contract

`MetricSnapshot.currencyProvenance` is additive text with default
`LEGACY_UNKNOWN`. The default permits existing rows and older inserts to remain
valid without asserting historical truth. The migration does not update any
amount, code or measurement identity. Missing/unrecognized application tokens
are treated as unknown by the boundary helper.

| Token | Meaning | Authoritative for comparison? |
| --- | --- | --- |
| `PLATFORM_REPORTED` | Code obtained explicitly from the platform currency response | Only with a supported valid code |
| `WORKSPACE_INFERRED` | Code substituted from workspace configuration | No |
| `FALLBACK_DEFAULT` | Generic default such as USD | No |
| `LEGACY_UNKNOWN` | Historical or unproven origin, including callers omitting provenance | No |
| `USER_SUPPLIED` | Currency supplied with a manual revenue upload | No |
| `SNAPSHOT_INFERRED` | Manual revenue borrowed the code of another observation | No |

The last two tokens are necessary to describe the existing manual ingestion
path honestly. Neither is platform-reported, neither is a workspace lookup,
and neither is a generic USD fallback. A supplied currency may originate from
the UI's preselected workspace/USD value; this slice does not upgrade a user
submission into verified source evidence. A snapshot borrowed by manual upload
cannot attest the denomination of the independently uploaded revenue, even if
that snapshot's own currency was reported.

`isAuthoritativeCurrency(row)` derives trust from the code and origin together.
No persisted boolean can drift from those facts. A malformed code remains
non-authoritative even if tagged reported. Fallback insertion always records
`FALLBACK_DEFAULT`, regardless of an incoming reported tag on a missing code.
Only server-side connector resolution assigns production platform authority;
manual upload ignores any client-supplied provenance field.

## Connector and sink map

| Path | Origin handling | Classification |
| --- | --- | --- |
| Meta operational / canonical / daily | Existing `fetchAccountCurrency` result; null/error → workspace → USD, with distinct provenance | FIXED IN THIS SLICE |
| Meta account, campaign, ad-set, ad normalization | Same authentication denomination and origin carried to every row | FIXED IN THIS SLICE |
| Google operational / canonical | Current GAQL queries do not select `customer.currency_code`; workspace or USD remains tagged | INFERRED BUT NOW TAGGED |
| GA4 actuals | Existing authentication USD default is tagged; current mapper carries no currency metadata | INFERRED BUT NOW TAGGED |
| Manual revenue CSV | Submitted code / borrowed snapshot code / USD tagged separately | INFERRED BUT NOW TAGGED |
| `snapshotSink` | Preserves origin or marks missing-origin input unknown; fallback explicitly tagged | FIXED IN THIS SLICE |
| `actualsSink` | Same rule for actual descriptors | FIXED IN THIS SLICE |
| Non-daily SQL persistence | Existing dynamic defined-column upsert carries the new text field on insert and update | FIXED IN THIS SLICE via row builders |
| Daily persistence | Creation plus explicit restatement allowlist carries the new field | FIXED IN THIS SLICE |
| Seed/older writers | Database default yields unknown provenance | Explicitly uncertain |
| Unsupported connector tags | No active producer; future adapters must carry origin | FOLLOW-UP REQUIRED when implemented |

GOOGLE_AUTHORITATIVE_CURRENCY_NOT_YET_AVAILABLE: obtaining it requires a query
field or separate request not present in the existing implementation. No Google
API integration was expanded. GA4 authoritative denomination is also unresolved.

The code-only resolver's existing public shape and currency precedence remain
unchanged; a provenance-aware wrapper maps its already-known resolution source.
Valid existing monetary conversion and amount calculations are unchanged. USD
fallbacks remain for compatibility and are explicitly untrusted. No FX, data
repair or historical inference is introduced.

## Rollout and legacy policy

Deploy the additive migration before the updated ingestion processes. Existing
rows stay unknown. A fresh observation/restatement may acquire the origin of
that new observation, including downgrading a formerly reported row after a
failed lookup. This is not retrospective reconstruction. Update all ingestion
workers before enabling downstream trust: an old writer cannot supply the new
contract. Rollback can revert application code and retain the additive column;
do not rewrite history or drop metadata as a routine rollback step.

## Required downstream changes (not implemented here)

The existing `classifyCurrencyHomogeneity` still examines currency codes only.
Its future input must include `currencyProvenance` for every monetary
contributor and require `isAuthoritativeCurrency` before declaring
`HOMOGENEOUS_KNOWN`. Matching inferred or legacy codes are insufficient.
Existing campaign health/reasoning/AI consumers of the code-only helper must
also carry this origin through their evidence projections in that follow-up.

| Consumer | Current assumption | Required provenance-aware behavior |
| --- | --- | --- |
| Blended Truth + pacing + narrative | Workspace relabel, channel sums, window-only spend gate, raw-spend ranking | Preserve source origin; establish spend/revenue/reconciliation and budget-denomination compatibility before totals, shares, pacing, allocation, exhaustion or ranking. Publish explicit unavailable reasons. |
| Scenario | Channel money is additive and economics denomination applies | Require authoritative homogeneous baseline and compatible economics/change budget before projections. |
| Attribution | Channel revenue credits are additive | Gate revenue totals, shares and monetary comparisons; preserve independent conversion/path evidence. |
| Current economics / blended CAC | Sum channel spend; first currency or USD | Gate spend/CAC and compatibility with configured economics; preserve independent counts. |
| PlanService goal actuals | Snapshot spend/revenue can be summed for goals | Carry provenance into goal populations; unavailable CAC/ROAS/MER and dependent projections when comparability is unproven. |
| Frontend Slice A | Currency and null money may be defaulted | Render the backend unavailable reason without zero/USD substitution; do not locally manufacture monetary totals. |

None may use legacy rows as authoritative monetary comparison evidence. Such
rows remain usable for truthful identity, timestamps, states and independent
non-monetary measurements. The foundation alone does not close downstream
monetary safety; those implementations remain deferred by the slice boundary.
