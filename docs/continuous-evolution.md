# Continuous Evolution

BalıkGo değişiklikleri küçük, backward-compatible ve rollback edilebilir olmalıdır.

- Feature flag kararları yalnız server-side merkezi evaluator üzerinden alınır. Flag authorization, payment verification, Stock Truth, IDOR, cancellation eligibility veya finance guard yerine kullanılamaz.
- Öncelik: global kill switch → feature kill switch → explicit disable → allowlist → deterministik rollout → default. Optional feature config parse edilemezse enhancement kapanır ve core akış devam eder.
- V1 config kaynağı `BALIKGO_RELEASE_SAFETY_CONFIG` environment değeridir. Değişiklik process restart/redeploy gerektirir; runtime mutation endpoint’i yoktur. Allowlist hiçbir client DTO veya release snapshot’ına yazılmaz.
- Schema evrimi `expand → migrate → contract` sırasını izler: additive alan önce eklenir, eski reader geçerli kalır, gerekiyorsa dual-read/write ve doğrulanmış backfill yapılır, destructive removal ayrı release olur.
- Rollback önce feature kill switch/config rollback ile enhancement’ı kapatır; eski davranış korunamıyorsa code rollback uygulanır. Otomatik git rollback yoktur.
- FAST ve FULL Release Guard içindeki `RELEASE_SAFETY` gate’i config parser, safe defaults, rollout, kill-switch precedence ve forbidden critical flag kurallarını bloklayıcı olarak doğrular.
- Production değişiklikleri secret/PII loglamaz, production DB guard’larını aşmaz ve Release Guard `RELEASE_ALLOWED` olmadan hazır kabul edilmez.
