# USOAP CMA - Faz 8B.3 Modüler Mimari

Bu paket, test edilen Faz 8B.2 sürümünü temel alır. İş akışı veya veri modeli değiştirilmeden üç yoğun süreç `app.js` dışına ayrılmıştır: kuruluş ön cevabı, denetçi ön değerlendirmesi ve kriter bazlı denetim icrası. Faz 8A veri bütünlüğü/güvenlik davranışı korunmuştur.

## Klasör yapısı

```text
/
├── index.html
├── PQ_JSON_Model.json
├── firestore.rules
├── css/
│   └── app.css
└── js/
    ├── app.js
    ├── config.js
    ├── firebase-client.js
    ├── master-data.js
    ├── runtime.js
    ├── selectors.js
    ├── state.js
    ├── utils.js
    └── modules/
        ├── ui-shell.js
        ├── master-forms.js
        ├── programs.js
        ├── audits.js
        ├── assignments.js
        ├── workflow-context.js
        ├── auditee-responses.js
        ├── pre-evaluation.js
        └── audit-execution.js
```

## Faz 8B.3'te ayrılan yeni modüller

- `workflow-context.js`: denetim kapsamındaki PQ satırları, PQ anahtarı ve ön cevap/ön değerlendirme/denetim cevabı seçicileri; kuruluş görünürlüğü.
- `auditee-responses.js`: kuruluş ön cevap ekranı, PQ bazlı cevap/kanıt girişi, taslak/gönderim akışı ve kuruluş cevap durumu rozeti.
- `pre-evaluation.js`: kuruluş cevaplarının denetçi tarafından ön değerlendirilmesi, PQ bazlı odak/saha doğrulama notları ve tamamlanma akışı.
- `audit-execution.js`: kriter bazlı S/NS/NA değerlendirmesi, otomatik PQ sonucu, doğrulama, bulgu senkronizasyonu ve denetim cevaplarının tamamlanması.

Önceki Faz 8B.2 modülleri (`ui-shell`, `master-forms`, `programs`, `audits`, `assignments`) aynen korunmuştur.

## Değişmeyen veri/güvenlik dosyaları

- `PQ_JSON_Model.json`: Faz 8B.2 ile birebir aynı.
- `firestore.rules`: Faz 8B.2 ile birebir aynı.
- `css/app.css`: Faz 8B.2 ile birebir aynı.

Bu faz yalnızca kod organizasyonudur; Firestore şeması, statüler ve iş kuralları değiştirilmemiştir.

## GitHub Pages yükleme

ZIP içindeki klasör yapısını repository ana dizinine aynen yükleyin. Özellikle `js/modules/` altındaki dört yeni dosyayı da ekleyin. Eski `index.html` ve `js/app.js` dosyalarının yeni sürümleriyle değiştirildiğinden emin olun.

## Önerilen Faz 8B.3 smoke test

1. Giriş/Demo geçişi ve ana menü normal açılıyor mu?
2. Kuruluş Ön Cevapları: denetim seçimi, taslak kaydetme ve gönderme çalışıyor mu?
3. Ön Değerlendirme: denetim seçimi, genel/PQ notları, saha doğrulama kutusu, taslak/tamamlama çalışıyor mu?
4. Denetim Çalışması: PQ kartları açılıp kapanıyor mu; kriterlerde S/NS/NA ve zorunlu alan kontrolü çalışıyor mu?
5. Tamamlanan NS PQ kayıtları Bulgular ekranına aktarılıyor mu?
6. Denetim kartı ve Denetim Detayı içinde Kuruluş Cevabı / Ön Değerlendirme / Denetim Çalışması rozetleri görünüyor mu?
7. İtiraz, Nihai Rapor ve CAP ekranları en azından açılış regresyon testinden geçiyor mu?

## Teknik doğrulama

Paket oluşturulurken tüm yerel JavaScript dosyaları `node --check` ile doğrulanmalı, yerel import yolları kontrol edilmeli ve ZIP bütünlüğü test edilmelidir.
