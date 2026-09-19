# USOAP CMA - Faz 8B.1 Modüler Mimari

Bu paket, Faz 8A.1 davranışını koruyarak tek dosyalı uygulamayı modülerleştiren ilk güvenli geçiştir.

## Yapı
- `index.html`: uygulama iskeleti
- `css/app.css`: tüm stiller
- `js/config.js`: sabitler, roller, statüler, menüler ve Firebase config
- `js/state.js`: uygulama state'i
- `js/utils.js`: tarih/format/ID yardımcıları
- `js/firebase-client.js`: Firebase SDK ve istemci başlatma
- `js/master-data.js`: PQ master normalize/parsing
- `js/app.js`: mevcut domain/UI iş akışları; Faz 8B.2'de domain modüllerine ayrılacak
- `PQ_JSON_Model.json`: master veri, değiştirilmedi
- `firestore.rules`: Faz 8A güvenlik kuralları, değiştirilmedi

## GitHub Pages
Klasör yapısını bozmadan repository root'una yükleyin. `index.html`, `css/` ve `js/` yollarını göreli olarak çağırır.

## Sonraki adım
Faz 8B.2: `app.js` içindeki program, denetim, kuruluş cevabı, ön değerlendirme, denetim icrası, bulgu/itiraz/rapor, CAP, bildirim ve kullanıcı yönetimi ayrı domain modüllerine taşınacak.
