# #26 Campaign & Promotion Engine — Slice C Evidence

STATUS: PASS

## Checkpoint

- Slice A: PASS.
- Slice B: PASS and preserved.
- Partial Slice C work was preserved and completed in place.
- Branch: `main`; HEAD/origin: `c781e6532aa0f881e7c78fe3e1300a82564e5839`; divergence: `0/0`.
- Working tree intentionally contains Slice B and Slice C only.

## Target

- `CampaignSellerOfferTarget` persists Campaign-to-SellerOffer membership.
- Database uniqueness: `(campaignId, sellerOfferId)`; reverse lookup index: `(sellerOfferId, campaignId)`.
- ADMIN-only POST/DELETE service and route boundary. Seller and customer are denied in the route and service/DB role boundary.
- Client supplies only `sellerOfferId`, `expectedVersion`, and reason; seller/catalog/product identity is resolved from the persisted offer.
- Add/remove use Campaign expectedVersion CAS and SERIALIZABLE transaction.
- Duplicate add with current version is idempotent and produces no version or audit spam. Missing remove is explicit `TARGET_NOT_FOUND`.
- Successful add/remove increments Campaign version and appends typed `CAMPAIGN_TARGET_ADDED` / `CAMPAIGN_TARGET_REMOVED` audit with direct `sellerOfferId`, actor, reason, previous/new version, and bounded state evidence.
- Target, version, and audit are atomic; injected audit failure rolled back target and version.

## Eligibility and calculation

- Requires PUBLISHED and ACTIVE at `[effectiveFrom,effectiveUntil)`.
- Reuses marketplace offer eligibility: active, stock > 0, approved seller, active/approved catalog product, positive authoritative price, and no price-anomaly hold.
- Calculation uses current `SellerOffer.price`, Prisma Decimal, two decimals, and `ROUND_HALF_UP`.
- Percentage, fixed amount, and fixed promotional price are supported.
- Zero/negative/equal/higher effective results are excluded fail-closed. A campaign cannot increase customer price.
- Campaign candidates never stack. The lowest effective amount wins; equal amounts use stable `campaignId ASC`, independent of input/database ordering.
- Result contains campaign id/version/type, sellerOfferId, base/discount/effective amounts, effectiveAt, `SELLER_OFFER` scope, and status; actor/audit data is absent.

## Resolver

- Server-only single and batch resolver; maximum 50 unique SellerOffer inputs.
- One bounded SellerOffer query with targeted PUBLISHED/active Campaign relation; no full Campaign scan and no per-line query.
- Query indexes cover target reverse lookup and Campaign status/effective window.
- Client campaign choice and client campaign price are not inputs.

## Concurrency and boundaries

- Two admins with the same version: exactly one economic target mutation succeeds; the other receives stale-version failure.
- Rule update versus target mutation on the same version: exactly one succeeds; no lost or half-old/half-new update.
- Held, inactive, out-of-stock, unapproved-seller, and inactive-catalog offers resolve to no campaign.
- Draft, upcoming, exact-until, expired, and cancelled campaigns are ineligible; exact start and inside window are eligible.
- Resolution and target mutation do not change SellerOffer price/priceVersion/hold, create price observations or admin interventions, or mutate Coupon/CouponRedemption.
- Existing checkout files are unchanged and do not import the resolver. Campaign discount has no production checkout effect in Slice C.

## Schema and migration

- `20260909000200_campaign_offer_targeting`: target table, typed actions, uniqueness, and query indexes.
- `20260910000100_campaign_target_audit_offer`: direct target identity on typed audit.
- Both are additive; no backfill, destructive DDL, or SellerOffer/Coupon/Order rewrite.
- Guarded TEST DB: 45 migrations; schema up to date.
- Windows schema-engine issue used the already-proven WSL path with the canonical guarded runner and verified TLS.
- Production DB: NOT ACCESSED. Production migration: NO.

## Test evidence

- Slice C pure: PASS — all three rule types, HALF_UP rounding, invalid/equal/higher results, lifecycle/time boundaries, lowest winner, stable tie, input-order independence.
- Slice C guarded TEST DB: PASS — target auth/integrity/idempotency/stale/remove/version/audit/rollback, admin race, rule-target race, all eligibility branches, calculations, overlap/tie, boundaries, cleanup.
- Slice B pure and guarded TEST DB regression: PASS.
- #25 and #27 boundary snapshots: PASS. Checkout characterization: PASS.
- Prisma format/validate/generate: PASS. TypeScript `--noEmit`: PASS. Related ESLint: PASS.
- `git diff --check`: PASS. Added-file secret/private-key scan: PASS.
- FULL release guard: NOT RUN. Commit/push: NO.

## Adversarial review

- Duplicate add version spam: no.
- Admin lost update or rule/target partial state: no; shared Campaign CAS serializes them.
- Held/expired campaign eligibility: no result.
- Price increase, stacking, or nondeterministic tie: prevented by pure candidate/winner rules.
- Base price/history, coupon authority, or checkout adoption: unchanged.
- Core is generic commerce, server/API-headless, and free of brand or fishing-specific branching.

BLOCKERS: NONE.

NEXT ACTION: #26 Slice D — Checkout Effective-Price Adoption, Explicit Coupon Composition & Immutable Order Provenance. Slice D was not started.
