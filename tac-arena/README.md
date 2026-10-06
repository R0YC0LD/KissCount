# 👑 Taç Arena

Clash Royale tarzı, **online oynanabilen** gerçek zamanlı bir kule savaşı oyunu (Android).
Farklı telefonlardan ve farklı internet bağlantılarından oyuncular birbirleriyle eşleşip karşılıklı oynayabilir.

![simge](icon.png)

## 📲 Kurulum

1. `TacArena.apk` dosyasını telefona indir.
2. Dosyayı aç. Android "bilinmeyen kaynaklardan yükleme" izni isterse ver.
3. "Taç Arena" uygulamasını aç.

Gereksinim: Android 7.0 ve üzeri. Online mod için internet gerekir.

## 🎮 Modlar

| Mod | Açıklama |
|---|---|
| ⚔️ **Savaş** | Çevrimiçi rastgele rakip bulur. O sırada "Savaş"a basmış başka biriyle otomatik eşleşirsin. |
| 👥 **Arkadaşla** | Biriniz **Oda Oluştur**'a basar, çıkan 4 haneli kodu diğerine söyler. Diğeri kodu yazıp **Katıl**'a basar. |
| 🤖 **Antrenman** | İnternetsiz, bota karşı. Kolay, Normal ve Zor seviyeleri var. |
| 🃏 **Destem** | 28 karttan 8'ini seçerek desteni kur. |
| 🏅 **Başarımlar** | 11 başarım: İlk Zafer, Üç Taç, Bot Avcısı, Kule Yıkıcı… |

## 🃏 Kartlar (28)

**Birlikler:** İskeletler, Goblinler, Mızraklı Goblinler, Bombacı, Şövalye, Okçular, Minyonlar, İskelet Ordusu,
Tüfekçi, Mini Robot, Valkür, Bebek Ejderha, Domuz Binici, Dev, Büyücü, Prens, Barbarlar, Balon, Golem

**Binalar:** Top, Cehennem Kulesi, Goblin Kulübesi

**Büyüler:** Şimşek, Ok Yağmuru, Ateş Topu, Dondurma, Zehir, Roket

## 📏 Kurallar

- Her prenses kulesi 1 taç, kral kulesi 3 taç değerindedir.
- Maç 3 dakika sürer. Son 60 saniyede iksir 2 kat hızlı dolar.
- Eşitlikte 1 dakika uzatma oynanır ve ilk tacı alan kazanır. Uzatmada da eşitlik bozulmazsa, en zayıf kulesi daha az canlı olan kaybeder.
- Birlikleri sadece kendi yarına koyabilirsin. Rakibin prenses kulesini yıkınca o koridorda ileri yerleştirme açılır.
- Kral kulesi, hasar alınca ya da bir prenses kulesi düşünce uyanır.

## 🛠 Teknik yapı

```
tac-arena/
├── TacArena.apk          ← derlenmiş, imzalı, yüklenebilir APK
├── www/                  ← oyunun kendisi (HTML5 + Canvas, sade JavaScript)
│   ├── js/cards.js       kart istatistikleri
│   ├── js/sim.js         oyun motoru (hareket, hedefleme, hasar, kuleler)
│   ├── js/ai.js          bot yapay zekası
│   ├── js/net.js         online eşleştirme (Supabase Realtime)
│   ├── js/session.js     bot / host / misafir oturumları ve ağ senkronizasyonu
│   ├── js/render.js      canvas çizimi ve efektler
│   ├── js/audio.js       sentezlenmiş ses efektleri
│   └── js/main.js        arayüz ve menüler
└── android/              ← WebView sarmalayıcı Android projesi
```

**Online nasıl çalışıyor?** Oyunun ayrı bir sunucusu yok. Eşleşme ve mesajlaşma için
Supabase Realtime (`eemk-web` projesi) kullanılıyor. Sadece *presence* ve *broadcast* kanalları kullanılıyor,
veritabanına hiçbir şey yazılmıyor.

1. Oyuncular bir lobi kanalına katılır. "Savaş"a basanlar birbirini görür ve davet/kabul ile eşleşir.
2. Eşleşen iki oyuncudan biri **host** olur. Host maçı kendi telefonunda simüle eder ve saniyede 10 kez durum gönderir.
3. Diğer oyuncu (**misafir**) gelen durumları akıcı göstermek için ara değerleme (interpolation) yapar. Kart oynadığında komutu host'a gönderir, host kontrol edip uygular.
4. Misafir haritayı ters görür, yani herkes kendi kulelerini altta görür.

> Not: Supabase'in ücretsiz planında aylık mesaj kotası var (bir 3 dakikalık maç yaklaşık 2-4 bin mesaj).
> Arkadaşlar arası oyun için fazlasıyla yeterli. Ayrıca ücretsiz projeler uzun süre kullanılmazsa duraklatılır.

## 🔨 Yeniden derleme

Gerekenler: JDK 17+ ve Android SDK (platform 34, build-tools 34).

```bash
cd tac-arena/android
echo "sdk.dir=/android/sdk/yolu" > local.properties
./gradlew assembleRelease
# çıktı: app/build/outputs/apk/release/app-release.apk
```

APK, `android/keystore/` içindeki anahtarla imzalanır. Aynı anahtar kullanıldığı sürece yeni sürümler
eski sürümün üzerine güncelleme olarak kurulabilir. Uygulamayı ileride herkese açık dağıtacaksan
yeni bir anahtar oluşturup gizli tut.

Tarayıcıda denemek için `www/index.html` dosyasını doğrudan açabilirsin (Chrome önerilir).
