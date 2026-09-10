# #26 Campaign & Promotion Engine — Slice D Evidence

STATUS: PASS

## Checkpoint

- A: PASS.
- B: PASS and preserved.
- C: PASS and preserved.
- Partial D preserved: yes; the supplied partial work was completed in place.
- Branch: `main`.
- HEAD/origin: `c781e6532aa0f881e7c78fe3e1300a82564e5839`; divergence `0/0`.
- Working tree: intentionally contains the uncommitted Slice B, C, and D work only.

## Economic contract

- `OrderItem.unitPrice`: existing authoritative SellerOffer unit price semantics remain unchanged.
- `discountAmount`: exactly one selected line discount contribution.
- Base price: locked `SellerOffer.price * quantity`.
- Campaign and coupon: independently evaluated from the same base price.
- Final line: base line minus the one selected discount.
- Composition: explicit `NONE`, `CAMPAIGN_ONLY`, or `COUPON_ONLY`; discounts never stack.

## Campaign adoption

- Resolver: the bounded Slice C batch resolver is called once per checkout transaction.
- `effectiveAt`: one `orderEffectiveAt` is shared by campaign resolution, coupon evaluation, composition, and provenance.
- Batching: unique SellerOffer ids, maximum bounded by the existing checkout item limit.
- Call point: after persisted product/offer validation and before order economics are created.
- Row locking: SellerOffer rows are locked in stable id order before campaign and coupon calculations.

## Coupon composition

- Campaign and coupon candidates use the same authoritative base independently.
- The lower effective line amount wins; equal amounts choose campaign.
- Campaign wins create no CouponRedemption and consume no coupon usage.
- Coupon wins create one redemption through the existing atomic coupon path.
- Invalid coupon input does not suppress an otherwise valid campaign candidate.
- No double discount or hidden stacking path exists.

## Order provenance

- Nullable additive snapshots record base unit price, campaign applied/id/version/type/discount, coupon applied/snapshot/reference/discount, composition mode, selected source, effective unit price, final line amount, and pricing effective time.
- Legacy rows remain valid because all new fields are nullable.
- Customer order reads expose commercial amounts and source flags, but not campaign ids/versions, coupon snapshot ids, actors, or audit internals.

## Immutability

- Later campaign rule update, cancellation, target removal, SellerOffer price mutation, or coupon mutation does not reinterpret an existing order.
- A repeated `clientRequestId` returns the persisted order before any new resolution, redemption, or stock operation.
- Historical Payment and order totals remain tied to the stored line economics.

## Economics

- Commission uses the final composed line amount.
- Installments use base line minus the selected discount.
- Payment total equals the order total derived from final line amounts.
- Ledger/payout and refund continue to consume stored OrderItem economics.
- Stock decrement/reservation behavior is unchanged and remains atomic with checkout.

## Concurrency

- Campaign/checkout and price/checkout observe one transactionally coherent locked offer state.
- Concurrent limited coupon use permits only one successful consumption.
- Concurrent identical `clientRequestId` creates one order and one stock decrement.
- No mixed campaign/coupon time or base-price state was observed.

## Security

- Client campaign ids, campaign prices, discount selections, and provenance fields are rejected/ignored as authority.
- Price and campaign eligibility derive from persisted server state.
- Held or otherwise ineligible offers cannot pass checkout.
- Internal campaign/coupon provenance does not leak through customer order serialization.

## Schema and migration

- Migration: `20260910000200_campaign_checkout_provenance`.
- Additive only: enums, nullable columns, and a consistency check; no backfill or destructive DDL.
- Guarded TEST DB: applied and schema status verified up to date.
- Migration count: 46.
- Production DB: NOT ACCESSED. Production migration: NO.

## Tests

- Real HTTP guarded TEST DB checkout: PASS.
- Campaign types and lifecycle eligibility: PASS.
- Coupon-only, campaign-wins, coupon-wins, equal/tie, and invalid-coupon fallback: PASS.
- Multi-seller, three-line, mixed campaign/no-campaign cart: PASS.
- Quantity greater than one: PASS.
- Historical campaign, target, price, and coupon mutation: PASS.
- Same-request retry and concurrent duplicate retry: PASS.
- Coupon usage-limit concurrency: PASS.
- Stock availability and atomic decrement: PASS.
- Payment, commission, installment, payout/ledger invariants: PASS.
- Refund orchestration from stored economics: PASS.
- Slice B/C campaign regression and Slice C resolver: PASS.
- #22 finance, #23 payment, #24 installment, #25 SellerOffer price-history/publication boundaries: PASS.
- Prisma format/validate/generate: PASS.
- TypeScript `--noEmit`: PASS.
- Related ESLint: PASS.
- `git diff --check`: PASS.
- Added-file secret/private-key scan: PASS.

## Bypass audit

- Client price or campaign id cannot become authority.
- Campaign and coupon cannot stack or double-discount a line.
- Campaign/equal wins do not consume coupon redemption.
- Checkout does not mutate SellerOffer price/history or create an intervention; the historical test's explicit post-order price mutation creates exactly one expected observation.
- Price-anomaly hold remains enforced.
- Immutable snapshots preserve the selected source and final economics.
- Payment, retry, refund, and stock paths use the persisted composed result.

## Reusable core

- No BALIKGO brand branching or fishing-specific rule exists in the composition/resolution core.
- The server/API contract supports web and mobile clients without trusting client calculations.
- No license-ready blocker identified.

BLOCKERS: NONE.

NEXT ACTION: #26 Slice E — Seller Participation, Campaign Governance & Control Plane. Slice E was not started.
