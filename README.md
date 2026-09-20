# USOAP CMA - Faz 8B.7 Veri Erişim Katmanı

Bu paket Faz 8B.6 çalışan sürümünün devamıdır. İş kuralları değiştirilmeden Firestore/localStorage veri erişimi `app.js` dışına alınarak merkezi `js/repository.js` katmanında toplanmıştır.

## Yeni modül

- `js/repository.js`
  - Demo/Test ve gerçek Firebase veri modunun ayrımı
  - `localStorage` anahtar/okuma/yazma işlemleri
  - Firestore tekil doküman okuma
  - Koleksiyon okuma
  - Kayıt oluşturma/güncelleme
  - Firebase istemcisinin başlatılması
  - Auditee için kuruluş bazlı sorgu kapsamı
  - Gerçek veri modunda Firebase hatasında localStorage'a sessiz geri dönüşün engellenmesi

## app.js

Faz 8B.6'da yaklaşık 23 KB olan `js/app.js`, Faz 8B.7'de yaklaşık 17 KB seviyesine indirilmiştir. `app.js` artık ağırlıklı olarak:

- master PQ modelini yükleme,
- kullanıcı profilinin ilk yükleme orkestrasyonu,
- state koleksiyonlarını merkezi `loadData()` ile doldurma,
- `renderAll()` ve ana ekran/portal/rapor orkestrasyonu,
- runtime callback kayıtları,
- uygulama başlatma

işlevlerini taşır.

## Veri modu davranışı

Davranış değiştirilmemiştir:

- Demo/Test modu -> yalnızca `localStorage`
- Gerçek Firebase oturumu -> yalnızca Firestore
- Gerçek modda Firestore hatası -> işlem hata verir; localStorage'a geri dönülmez
- Auditee -> kendi `organizationId` kapsamındaki izin verilen koleksiyonları sorgular
- Admin -> `users` koleksiyonunun tamamını okuyabilir
- Diğer kullanıcılar -> kendi kullanıcı profilini okur

İlk kullanıcı profili akışı da korunmuştur: profil yoksa güvenli `viewer / inactive / pending` profili oluşturulur; istemci tarafında otomatik Admin atanmaz.

## Değişmeyen dosyalar

Aşağıdaki dosyalar Faz 8B.6 ile checksum düzeyinde aynıdır:

- `PQ_JSON_Model.json`
- `firestore.rules`
- `css/app.css`

Master PQ içeriği ve Firestore Security Rules değiştirilmemiştir.

## GitHub yükleme

ZIP içeriğini repository köküne klasör yapısını koruyarak yükleyin. Bu fazda özellikle yeni dosyanın bulunduğunu kontrol edin:

```text
js/repository.js
```

Bununla birlikte `index.html`, `js/app.js`, `js/modules/ui-shell.js` ve `js/modules/settings.js` Faz 8B.7 sürümleriyle güncellenmelidir. En güvenlisi ZIP içeriğinin tamamını mevcut repository üzerine yüklemektir.

## Faz 8B.7 smoke test

1. Demo/Test modunda açın ve mevcut demo kayıtlarının geldiğini doğrulayın.
2. Demo modunda test programı veya kayıt üzerinde bir değişiklik yapın; sayfayı yenileyince kaydın korunmasını kontrol edin.
3. `Gerçek Girişe Geç` ile Firebase hesabına giriş yapın; üstte veri modunun `Firebase / Gerçek Veri` olduğunu doğrulayın.
4. Admin rolünde Yıllık Program, Denetim Dosyası ve Ayarlar/Yetkiler ekranlarının Firestore verileriyle açıldığını kontrol edin.
5. Gerçek modda bir test kaydını güncelleyin; sayfa yenilendiğinde Firestore'dan geri geldiğini doğrulayın.
6. Mümkünse Auditee test kullanıcısıyla giriş yapın; yalnızca kendi kuruluşuna ait denetim/CAP kayıtlarının göründüğünü doğrulayın.
7. Kısa regresyon: Denetim Çalışması -> Nihai Rapor -> CAP Girişi -> CAP İzleme ekranlarının açıldığını kontrol edin.
8. Tarayıcı konsolunda `Failed to load module`, `is not defined`, `permission-denied` veya 404 hatası olmadığını kontrol edin.

## Teknik doğrulamalar

Paket oluşturulurken:

- tüm JavaScript dosyalarında `node --check` çalıştırılır,
- tüm yerel ES module import yolları kontrol edilir,
- `repository.js` Demo/Test ve Firestore stub senaryolarıyla test edilir,
- inline event handler statik taraması yapılır,
- `PQ_JSON_Model.json`, `firestore.rules` ve `css/app.css` checksum karşılaştırması yapılır,
- ZIP bütünlüğü kontrol edilir.
