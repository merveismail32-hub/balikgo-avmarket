# #26 Campaign & Promotion Engine — Slice E Evidence

STATUS: PASS

## Checkpoint

- Slice A, B, C, and D: PASS and preserved.
- Partial Slice E was preserved and completed in place.
- Branch: `main`.
- HEAD/origin: `c781e6532aa0f881e7c78fe3e1300a82564e5839`; divergence `0/0`.
- Working tree intentionally contains uncommitted Slice B–E work only.

## Participation

- `CampaignParticipation` uses `REQUESTED`, `APPROVED`, `REJECTED`, `CANCELLED`, and `REVOKED`, with positive CAS versioning.
- Nullable unique `activeKey` permits one active `(campaignId, sellerOfferId)` participation. REQUESTED and APPROVED retain the key; terminal inactive states release it.
- A seller submits only a persisted offer owned through authenticated User → SellerProfile → SellerOffer. Client seller/actor identity is not accepted.
- Identical active submission returns the existing row without version or audit spam.
- Sellers may cancel only their own REQUESTED participation. They cannot cancel APPROVED participation or silently remove its target.
- ADMIN may approve/reject; rejection requires a bounded reason. ADMIN may revoke APPROVED participation with a bounded reason.

## Target authority and atomicity

- `CampaignSellerOfferTarget` remains the only resolver/economic membership authority.
- Approval atomically performs request CAS, Campaign CAS/version increment, target creation, Campaign typed target audit, participation transition, and participation typed audit in one SERIALIZABLE transaction.
- Revoke performs the symmetric target removal and both audits in one transaction.
- Existing targets block seller participation submission, and the target unique constraint prevents duplicate economic authority.
- Injected participation-audit failures during approval and revoke rolled back the participation, target, Campaign version, and Campaign audit changes.

## Audit

- `CampaignParticipationAudit` has typed REQUESTED/CANCELLED/APPROVED/REJECTED/REVOKED actions.
- Evidence records actor user/role, campaign, seller, offer, prior/new status, expected/prior/new version, optional/required reason as appropriate, and timestamp.
- Campaign target changes continue to use the existing typed Campaign audit/version chain.

## CAS and concurrency evidence

- DB isolation: SERIALIZABLE, row locks, conditional participation updates, and existing Campaign conditional version updates.
- Same expected participation version: first decision wins; subsequent decision/replay is terminal/stale and cannot overwrite it.
- Cancel followed by approval with the old request version fails closed.
- Campaign rule update followed by approval with the old Campaign version fails stale; no target or partial approval is created.
- Approval followed by stale revoke/replay fails safely.
- Real parallel transactions were not claimed as PASS. The Windows pg adapter serializes/conflicts when simultaneous transactions are issued in this test process, including with two client wrappers. This is a TEST INFRA limitation. Guarded TEST DB stale-writer CAS, transactional rollback, and uniqueness evidence passed.

## Security and privacy

- Foreign offer submit and foreign participation cancel are blocked.
- Seller self-approve/self-reject, customer decisions, seller revoke, and non-admin reads are blocked.
- Strict DTOs reject client `sellerId`, `actorUserId`, economic fields, and other unknown authority fields.
- Seller reads are bounded to 100 own rows and expose offer/product identity, status, version, and campaign dates. They omit other sellers, admin actor ids, audits, internal campaign names, and private competitor data.
- Admin list is bounded to 100 and supports a typed status filter.
- Existing admin-only Campaign rule and target services remain unchanged.

## Checkout, #25, #27, and history

- Approval affects current/future resolution through the existing resolver; revoke removes future eligibility.
- A held offer with approved participation and a real target still resolves to no campaign, preserving #25 publication safety.
- Participation code does not read or mutate Coupon/CouponRedemption; before/after counts remained identical.
- Participation mutations did not create or update Order rows. Slice D immutable OrderItem provenance, retry behavior, Payment, commission, installment, refund, ledger, and payout economics remain unchanged.

## Schema and migration

- Migration: `20260910000300_campaign_participation_governance`.
- Additive enums, two tables, bounded fields, positive-version checks, active-key lifecycle check, unique/index coverage, and restrictive foreign keys; no backfill or destructive DDL.
- Guarded TEST DB: 47 migrations, schema up to date.
- Production DB: NOT ACCESSED. Production migration: NO.

## Test evidence

- Guarded TEST DB matrix: PASS — own/foreign submit, strict spoof rejection, duplicate idempotency, own/foreign cancel, approve/reject/revoke RBAC, required reason, request/Campaign CAS, double-decision and cancel/approve stale-writer proofs, target/version effects, audit evidence and rollback, held-offer exclusion, order/coupon boundaries, cleanup.
- Slice B, C, D pure regressions: PASS.
- #25 price-anomaly publication safety: PASS.
- Refund and finance invariants: PASS.
- Slice D real HTTP checkout evidence remains PASS; Slice E changes no checkout file.
- Legacy `test:checkout-api` requires a separately running local server and returned `fetch failed`; this was an unavailable test harness, not an application assertion failure.
- Prisma format/validate/generate, TypeScript, related ESLint: PASS.
- `git diff --check` and added-file secret scan: PASS.
- FULL: NOT RUN. Commit/push: NO.

## Adversarial review

- A seller cannot place another seller's offer into a campaign or approve/reject itself.
- Duplicate submission returns the existing active row and writes no new audit/version.
- Approval creates exactly one existing target authority and cannot bypass Campaign version.
- Cancel/approve and rule-update/approval stale writers cannot leave a half-applied state.
- Revoke cannot rewrite historical orders; held offers remain excluded from checkout eligibility.
- No coupon/code/redemption/attribution authority was added or leaked.
- Concurrency evidence is DB CAS/rollback/constraint evidence; real parallel execution remains limited by the Windows pg test adapter.
- The service is generic marketplace, server/API based, web/mobile shareable, and contains no BALIKGO or fishing-specific rule.

BLOCKERS: NONE.

NEXT ACTION: #26 Slice F — Refund, Commission, Payout, Ledger & Payment Economic Regression. Slice F was not started.
