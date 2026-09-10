# #26 Campaign & Promotion Engine / Kampanya ve Promosyon Motoru

Slice B — Campaign Domain, Versioning, Lifecycle & Typed Audit

STATUS: PASS

## CHECKPOINT
- Slice A: PASS; araştırma tekrarlanmadı.
- Branch: main.
- Starting HEAD / origin/main: c781e6532aa0f881e7c78fe3e1300a82564e5839.
- Starting divergence: 0/0; starting working tree: clean.
- Final working tree: Slice B değişiklikleri uncommitted.
- Önceki FULL 44/44 RELEASE_ALLOWED kanıtı kullanıcı checkpoint'inden korundu; yeniden çalıştırılmadı.

## CAMPAIGN DOMAIN
- Campaign bağımsız aggregate; CampaignStatus: DRAFT / PUBLISHED / CANCELLED.
- Temporal helper: DRAFT / UPCOMING / ACTIVE / ENDED / CANCELLED; DB yazmaz.
- V1 types: PERCENTAGE_DISCOUNT, FIXED_AMOUNT_DISCOUNT, FIXED_PROMOTIONAL_PRICE.
- Explicit nullable percentage / fixedAmount / fixedPrice; yalnız tipe ait alan dolu.
- Version 1 ile başlar; başarılı değişiklikte +1.
- Decimal(5,2) percentage; Decimal(12,2) money. String decimal input, en fazla iki ondalık; JS float, exponent, NaN, Infinity, fazla scale ve sıfır/negatif değer reddedilir.
- Percentage aralığı (0,100). Money üst sınırı 9999999999.99.
- V1 mevcut tek para birimi varsayımı korunur; ayrı currency motoru/alanı yok. Scope/resolver eklenmeden hiçbir parasal kural uygulanmaz.
- publicTitle yok: bu slice internal yönetim aggregate'ı; müşteri sunumu kapsam dışı.
- Scope placeholder yok: Slice C targeting readiness bu slice yayınından ekonomik yetki çıkaramaz.

## LIFECYCLE
- Create: ADMIN, DRAFT, version=1, zorunlu 3–500 karakter reason.
- Update: DRAFT/PUBLISHED için tam configuration replacement; expectedVersion zorunlu. PATCH endpoint'i kısmi merge yapmaz.
- Published config değişiklikleri sürümlenir ve önceki config audit'te korunur. Gelecek Order snapshot adoption ayrı slice sorumluluğudur.
- Publish: yalnız DRAFT -> PUBLISHED; rule/window yeniden doğrulanır.
- Cancel: DRAFT/PUBLISHED -> CANCELLED; CANCELLED terminal ve immutable.
- No-op: canonical aynı configuration version/audit üretmez; stale kontrolünden sonra değerlendirilir.
- Tekrarlı publish/cancel invalid transition; audit/version üretmez.
- UTC instant, [from,until); from < until. Create/update/publish için until > server now.
- Geçmiş başlangıç, gelecek bitiş kabul edilir: immediate ACTIVE. Cancel geçmiş bitişte de kullanılabilir.

## CAS / CONCURRENCY
- Update/publish/cancel: positive bounded integer expectedVersion; ADMIN bypass yok.
- Serializable transaction ve id/version/status conditional updateMany.
- Stale veya Prisma P2034 -> STALE_VERSION; HTTP 409.
- Real TEST DB iki ADMIN aynı version ile yarış: tam bir başarı, bir STALE_VERSION; lost update yok.

## AUDIT
- CampaignAudit; typed enum actions: CAMPAIGN_CREATED / UPDATED / PUBLISHED / CANCELLED.
- Server session actor identity + transaction içinde DB ADMIN role doğrulaması.
- Whitelisted previous/new evidence: id/name/status/type/decimal strings/window/version; raw object dump yok.
- previousVersion/newVersion ve unique(campaignId,newVersion); creation version=1.
- Audit aynı transaction; gerçek DB audit-write fault injection UPDATE'i rollback etti.
- Başarısız/no-op işlemlerde success audit yok.
- Uygulama append-only: audit update/delete route veya production writer yok. DBA seviyesinde trigger ile silme engeli bu contract'ın parçası değildir; izole QA cleanup test kayıtlarını silebilir.

## AUTHORITY / BOUNDARIES
- ADMIN only; SELLER/CUSTOMER create/update/publish/cancel reddedildi.
- Strict DTO unknown alanları reddeder: actor/version/createdAt/audit/temporal state client authority değil.
- actorUserId body'den değil session'dan servise taşınır; servis DB role'u tekrar kontrol eder.
- #25: SellerOffer.price, priceVersion, price observation, anomaly/hold değiştirilmedi.
- #27: Coupon ve CouponRedemption değiştirilmedi; coupon primitive reuse yok.
- Existing app production dosyalarının HEAD ile normalize edilmiş içerik karşılaştırması PASS; checkout, Order, Payment, finance, refund, pricing davranışında değişiklik yok.
- Gerçek DB before/after offer price/version/hold ve coupon/redemption snapshot eşitliği; observation count eşitliği PASS.

## SCHEMA / MIGRATION
- prisma/migrations/20260909000100_campaign_foundation/migration.sql.
- Tek additive migration; yalnız yeni enum/table/index/FK/check.
- Constraints: positive version; valid window; exactly matching positive rule; percentage <100; ADMIN audit/reason; audit version continuity.
- Indexes: campaignId/newVersion unique, campaignId/createdAt audit history.
- Backfill, existing order rewrite, coupon migration, destructive DDL yok.
- TEST DB: canonical guarded runner; 43 migration, yeni migration başarıyla uygulandı.
- Windows schema-engine hatası sonrası mevcut WSL Node v24.19.0 ve Linux Prisma engine ile aynı scripts/run-prisma-migrate.ts test kullanıldı. TLS kapatılmadı.
- Production DB: NOT ACCESSED.

## TEST EVIDENCE
- npm run test:campaign: PASS (rules, strict DTO, Decimal normalization, temporal exact start/until, invalid window, past end, immediate active, existing production file characterization).
- npm run test:campaign-db: PASS (create, ADMIN auth, SELLER/CUSTOMER denial, update, no-op, stale update/publish, publish, published edit, cancel, draft cancel, terminal, concurrency, previous/new audit/version/reason, audit-failure rollback, failed mutation no audit, DB constraints, #25/coupon separation).
- Cleanup: PASS; test campaigns/audits/users removed; counts checked.
- Prisma format / validate / generate: PASS.
- TypeScript --noEmit: PASS.
- Related ESLint: PASS.
- git diff --check: PASS.
- Added-file secret/private-key scan: PASS.
- FULL release guard: NOT RUN.

## BYPASS AUDIT
- Production Campaign create/update writes yalnız app/lib/campaign.ts içinde.
- Lifecycle/CAS/audit bypass: bulunmadı.
- Audit update/delete production path: yok.
- Seller mutation, raw price mutation, priceVersion write, observation create, coupon mutation, checkout adoption: yok.
- Routes thin; shared server service web/mobile/headless boundary.

## REUSABLE CORE / SCOPE
- Brand/vertical branching yok; generic campaign terms.
- API/headless: evet; web/mobile aynı authority.
- License-ready blocker: Slice B içinde yok; multi-tenant/legal/funding engine uygulanmadı.
- Slice C, targeting/resolver/winner, checkout, seller participation, coupon composition, customer UI, performance, refund provenance: NOT IMPLEMENTED.
- Production DB / FULL / commit / push: NO.

## BLOCKERS
NONE.

## NEXT ACTION
#26 Slice C — Offer Scope, Eligibility, Temporal Resolution & Deterministic Overlap / Teklif Kapsamı, Uygunluk, Zamansal Çözümleme ve Deterministik Çakışma.
Slice C başlatılmadı.
