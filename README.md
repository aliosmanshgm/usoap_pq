# USOAP CMA - Faz 8B.6 Modülerleştirme

Bu paket Faz 8B.5 çalışan sürümünün devamıdır. İş kuralları korunarak kimlik doğrulama/kullanıcı yönetimi, bildirim-son tarih mantığı ve Ayarlar/Yetkiler görünümü `app.js` dışına alınmıştır.

## Yeni modüller

- `js/modules/auth-users.js`
  - Firebase Authentication giriş/çıkış
  - Demo/Test <-> Gerçek Giriş geçişi
  - Onay bekleyen kullanıcı profili
  - Rol / kuruluş profili uygulama
  - Kullanıcı profili oluşturma, güncelleme ve aktifleştirme
  - Üst çubuk Auth durumunun çizimi

- `js/modules/notifications.js`
  - Son tarih / gecikme hesapları
  - Rol ve denetim atamasına göre görünürlük
  - Denetim / itiraz / nihai rapor / CAP bildirimleri
  - Okundu / tümünü okundu / ilgili kaydı aç akışları

- `js/modules/settings.js`
  - Ayarlar / Yetkiler ekranı
  - Onay bekleyen kullanıcılar ve kullanıcı profilleri
  - Faz 8A veri bakım araçları
  - Paket içindeki Firestore Security Rules metni ve koleksiyon omurgası

## app.js

Faz 8B.5'te yaklaşık 60 KB olan `js/app.js`, Faz 8B.6'da yaklaşık 23 KB seviyesine indirilmiştir. `app.js` artık ağırlıklı olarak:

- veri erişim katmanı,
- master veri yükleme,
- merkezi `loadData()` / `renderAll()` orkestrasyonu,
- ana sayfa / kuruluş portalı / program-CAP özetleri,
- uygulama başlatma

işlevlerini taşır.

## Değişmeyen dosyalar

Aşağıdaki dosyalar Faz 8B.5 ile checksum düzeyinde aynıdır:

- `PQ_JSON_Model.json`
- `firestore.rules`
- `css/app.css`

Master PQ içeriği ve Firestore Security Rules değiştirilmemiştir.

## GitHub yükleme

ZIP içeriğini repository köküne klasör yapısını koruyarak yükleyin. Özellikle aşağıdaki yeni dosyalar bulunmalıdır:

```text
js/modules/auth-users.js
js/modules/notifications.js
js/modules/settings.js
```

`index.html` ve `js/app.js` de Faz 8B.6 sürümleriyle birlikte güncellenmelidir.

## Faz 8B.6 smoke test

1. Demo/Test modunda sayfayı açın; rol ve kuruluş seçicilerinin çalıştığını doğrulayın.
2. `Gerçek Girişe Geç` -> e-posta/şifre ile giriş -> üstte gerçek kullanıcı/rol bilgisinin geldiğini doğrulayın.
3. Admin rolünde `Ayarlar / Yetkiler` ekranını açın; onay bekleyen kullanıcılar ve kullanıcı profilleri tablosunun geldiğini kontrol edin.
4. Bir test kullanıcı profilinde rol/kuruluş değiştirip `Kaydet` veya `Aktifleştir` işlemini test edin.
5. `Bildirimler` ekranını açın; yaklaşan/geciken denetim, nihai rapor ve CAP kayıtlarının geldiğini kontrol edin.
6. Bildirimi `Okundu` yapın ve `Tümünü Okundu Yap` işlemini deneyin.
7. Bildirimde `Aç` butonunun ilgili denetim/CAP ekranına yönlendirdiğini doğrulayın.
8. Önceki modüllere kısa regresyon testi yapın: Yıllık Program, Denetim Çalışması, Nihai Rapor, CAP Girişi ve CAP İzleme ekranları açılmalıdır.

## Teknik doğrulamalar

Paket oluşturulurken:

- tüm JavaScript dosyalarında `node --check` çalıştırıldı,
- tüm yerel ES module import yolları kontrol edildi,
- modül import grafiği Firebase SDK stublarıyla Node üzerinde yüklendi,
- Auth / Settings / Notification temel smoke testleri çalıştırıldı,
- inline event handler statik taraması yapıldı,
- ZIP bütünlüğü ayrıca kontrol edildi.
