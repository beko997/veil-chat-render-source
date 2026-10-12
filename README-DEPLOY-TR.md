# Veil Chat — bağımsız yayınlama

Bu arşiv, Veil Chat web istemcisini ve API sunucusunu kendi PostgreSQL veritabanınla Render gibi bir platformda çalıştırmak için gereken kaynak kodu içerir.

## Render ile yayınlama

1. ZIP’i indirip bilgisayarında aç.
2. İçeriği yeni bir GitHub veya GitLab deposuna yükle. `render.yaml` dosyası deponun kökünde kalmalı.
3. Render’da **Blueprint** ile bu depoyu bağla.
4. Render PostgreSQL’de yeni bir veritabanı oluştur. Kalıcı veritabanı planı seç; geçici/deneme veritabanında gerçek konuşma verisi tutma.
5. Blueprint kurulumunda `DATABASE_URL` sorulduğunda Render veritabanının **Internal Database URL** değerini gir.
6. Blueprint iki servisi kurar: `veil-chat-api` ve `veil-chat-web`. API derlemesi veritabanı şemasını uygular; web servisi API adresini otomatik alır.
7. İki servis de hazır olduğunda web servisinin adresini aç.

`DATABASE_URL` yalnızca API servisine verilmelidir. Bu değeri kaynak koda, ZIP’e veya Git deposuna yazma. API derleme komutu şemayı eşitler; bu nedenle ilk kurulumda yeni ve yalnızca bu uygulamaya ait bir veritabanı kullan. Var olan bir veritabanını bağlamadan önce yedek alıp şema değişikliklerini ve eski açık metin kayıtlarını incele. Bu paket geçmiş verileri geriye dönük şifrelemez.

## Yerel çalıştırma

Gereksinimler: Node.js 24 ve pnpm 10.

```sh
corepack enable
pnpm install --frozen-lockfile

# Ayrı bir PostgreSQL veritabanını DATABASE_URL ortam değişkeniyle tanımla.
DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/DATABASE' pnpm --filter @workspace/db run push

# Bir terminalde API'yi başlat.
DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/DATABASE' PORT=8080 pnpm --filter @workspace/api-server run dev

# Başka bir terminalde web istemcisini başlat.
VITE_API_BASE_URL=http://localhost:8080 BASE_PATH=/ PORT=5173 pnpm --filter @workspace/veil-chat run dev
```

Web istemcisi `VITE_API_BASE_URL` verilmezse aynı alan adındaki `/api` yolunu kullanır. Render şablonu API alan adını otomatik sağlar.

## Güvenlik notu

Yeni oda bilgileri ve mesaj içerikleri tarayıcıda şifrelenir. Oda kimlikleri, bağlantı zamanı/boyutu ve IP gibi ağ üst verileri şifrelenmez. Oda anahtarları tarayıcı depolamasında tutulur; bu sürüm anonimlik, sansür aşma, ileri anahtar gizliliği veya gönderen kimliği doğrulaması sağlamaz ve bağımsız denetimden geçmemiştir. Yüksek riskli iletişim için kullanma.
