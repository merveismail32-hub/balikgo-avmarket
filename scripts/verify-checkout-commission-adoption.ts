import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { CheckoutCommissionAuthorityError, commissionForCheckoutLine } from "../app/lib/checkout-commission-policy";
import { CommissionPolicyResolutionError, CommissionPolicySelectionError } from "../app/lib/commission-policy";

type Agreement = { id: string; version: number; sellerId: string; categoryId: string; commissionRate: Prisma.Decimal; effectiveFrom: Date; effectiveUntil: Date | null };
const at = new Date("2026-06-01T12:00:00.000Z");
const agreement = (id: string, sellerId: string, categoryId: string, rate: string): Agreement => ({ id, version: 3, sellerId, categoryId, commissionRate: new Prisma.Decimal(rate), effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveUntil: null });
const clientFor = (agreements: Agreement[]) => ({ sellerCategoryCommissionAgreement: { findMany: async ({ where }: { where: { sellerId: string; categoryId: string } }) => agreements.filter((item) => item.sellerId === where.sellerId && item.categoryId === where.categoryId).slice(0, 2) } });

async function main() {
  const root = resolve(import.meta.dirname, "..");
  const checkout = readFileSync(resolve(root, "app/api/orders/route.ts"), "utf8");
  const helper = readFileSync(resolve(root, "app/lib/checkout-commission-policy.ts"), "utf8");
  assert.match(checkout, /sellerId:\s*offer\.sellerId[\s\S]*categoryId:\s*offer\.catalogProduct\.categoryId[\s\S]*effectiveAt:\s*orderEffectiveAt/);
  assert.match(checkout, /createdAt:\s*orderEffectiveAt/);
  assert.doesNotMatch(checkout, /commissionRateForSeller/);
  assert.doesNotMatch(checkout, /commissionRate:\s*z\.|commissionAmount:\s*z\.|sellerNet(?:Amount)?:\s*z\./);
  assert.match(helper, /commissionFor\(input\.grossAmount, 1, policy\.rate\)/);

  const previousConfig = process.env.MARKETPLACE_COMMISSION_RATE;
  try {
    process.env.MARKETPLACE_COMMISSION_RATE = "0.12";
    const scoped = clientFor([agreement("agreement-a", "seller-a", "category-x", "0.075")]);
    const selected = await commissionForCheckoutLine({ sellerId: "seller-a", categoryId: "category-x", effectiveAt: at, grossAmount: new Prisma.Decimal("100.00") }, scoped as never);
    assert.equal(selected.policy.source, "SELLER_CATEGORY_AGREEMENT"); assert.equal(selected.money.rate.toString(), "0.075"); assert.equal(selected.money.commission.toString(), "7.5"); assert.equal(selected.money.net.toString(), "92.5");
    assert.deepEqual(selected.provenance, { commissionPolicySource: "SELLER_CATEGORY_AGREEMENT", commissionPolicyReference: null, commissionAgreementId: "agreement-a", commissionAgreementVersion: 3 });

    const wrongSeller = await commissionForCheckoutLine({ sellerId: "seller-b", categoryId: "category-x", effectiveAt: at, grossAmount: new Prisma.Decimal("100.00") }, scoped as never);
    const wrongCategory = await commissionForCheckoutLine({ sellerId: "seller-a", categoryId: "category-y", effectiveAt: at, grossAmount: new Prisma.Decimal("100.00") }, scoped as never);
    assert.equal(wrongSeller.policy.source, "GLOBAL_CONFIG"); assert.equal(wrongSeller.money.rate.toString(), "0.12");
    assert.equal(wrongCategory.policy.source, "GLOBAL_CONFIG"); assert.equal(wrongCategory.money.rate.toString(), "0.12");
    assert.deepEqual(wrongSeller.provenance, { commissionPolicySource: "GLOBAL_CONFIG", commissionPolicyReference: "MARKETPLACE_COMMISSION_RATE", commissionAgreementId: null, commissionAgreementVersion: null });

    const multi = await Promise.all([
      commissionForCheckoutLine({ sellerId: "seller-a", categoryId: "category-x", effectiveAt: at, grossAmount: new Prisma.Decimal("80") }, scoped as never),
      commissionForCheckoutLine({ sellerId: "seller-b", categoryId: "category-x", effectiveAt: at, grossAmount: new Prisma.Decimal("80") }, scoped as never),
    ]);
    assert.deepEqual(multi.map((item) => item.money.rate.toString()), ["0.075", "0.12"]);
    assert.deepEqual(multi.map((item) => item.provenance.commissionPolicySource), ["SELLER_CATEGORY_AGREEMENT", "GLOBAL_CONFIG"]);

    delete process.env.MARKETPLACE_COMMISSION_RATE;
    const fallback = await commissionForCheckoutLine({ sellerId: "seller-b", categoryId: "category-x", effectiveAt: at, grossAmount: new Prisma.Decimal("100") }, scoped as never);
    assert.equal(fallback.policy.source, "DEFAULT_FALLBACK"); assert.equal(fallback.money.commission.toString(), "10");
    assert.deepEqual(fallback.provenance, { commissionPolicySource: "DEFAULT_FALLBACK", commissionPolicyReference: "BUILT_IN_DEFAULT_0_10", commissionAgreementId: null, commissionAgreementVersion: null });
    process.env.MARKETPLACE_COMMISSION_RATE = "bad";
    await assert.rejects(() => commissionForCheckoutLine({ sellerId: "seller-b", categoryId: "category-x", effectiveAt: at, grossAmount: new Prisma.Decimal("100") }, scoped as never), CommissionPolicySelectionError);
    await assert.rejects(() => commissionForCheckoutLine({ sellerId: "seller-a", categoryId: null, effectiveAt: at, grossAmount: new Prisma.Decimal("100") }, scoped as never), CheckoutCommissionAuthorityError);

    const ambiguous = clientFor([agreement("one", "seller-a", "category-x", "0.07"), agreement("two", "seller-a", "category-x", "0.08")]);
    await assert.rejects(() => commissionForCheckoutLine({ sellerId: "seller-a", categoryId: "category-x", effectiveAt: at, grossAmount: new Prisma.Decimal("100") }, ambiguous as never), CommissionPolicyResolutionError);

    assert.equal(selected.money.rate.toString(), "0.075"); assert.equal(selected.money.commission.toString(), "7.5"); assert.equal(selected.money.net.toString(), "92.5", "later policy changes must not mutate an existing monetary snapshot");
    assert.equal(wrongSeller.money.rate.toString(), "0.12"); assert.equal(wrongSeller.provenance.commissionPolicySource, "GLOBAL_CONFIG", "later config changes must not mutate a global snapshot");
    assert.equal(fallback.money.rate.toString(), "0.1"); assert.equal(fallback.provenance.commissionPolicySource, "DEFAULT_FALLBACK", "later config changes must not mutate a fallback snapshot");
  } finally {
    if (previousConfig === undefined) delete process.env.MARKETPLACE_COMMISSION_RATE;
    else process.env.MARKETPLACE_COMMISSION_RATE = previousConfig;
  }
  console.log("PASS: #22 Slice D authoritative checkout policy adoption, per-line isolation, fail-closed behavior and immutable monetary snapshots");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
