# Prisma + Supabase bağlantısı

Bu proje Prisma 7 kullanır. Bağlantı URL'leri şemada değil, `prisma.config.ts` içinde yönetilir.

- `DATABASE_URL`: Uygulamanın çalışma zamanı bağlantısı; Supabase **Session Pooler**, port `5432`.
- `DIRECT_URL`: `prisma migrate dev`, `prisma migrate deploy` ve `prisma validate` için bağlantı; öncelikle Supabase **Direct Connection**, port `5432`.
- Supabase **Transaction Pooler** (`6543`) Prisma migration için kullanılmaz.

Yerel `.env` dosyanıza `.env.example` içindeki iki değişkeni gerçek, gizli bağlantı bilgilerinizle ekleyin. URL içindeki parola `@`, `:`, `/`, `?` veya `#` karakterleri içeriyorsa URL-encode edilmelidir.

Ardından sırayla çalıştırın:

```powershell
npx prisma validate
npx prisma generate
npx prisma migrate dev --name init
```

Üretim ortamında migration için `npx prisma migrate deploy` kullanın.
