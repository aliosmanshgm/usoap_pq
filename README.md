# USOAP CMA - Faz 8B.2 Modüler Mimari

Bu paket, çalışan Faz 8B.1 davranışını koruyarak `app.js` içindeki ilk büyük domain ayrıştırmasını yapar. Faz 8A güvenlik/veri bütünlüğü kuralları korunmuştur.

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
        └── assignments.js
```

## Faz 8B.2'de ayrılan sorumluluklar

- `ui-shell.js`: menü, sayfa başlığı, rol/kuruluş seçicileri, modal, bölüm geçişleri
- `master-forms.js`: read-only PQ kütüphanesi ve revizyon metadata ekranları
- `programs.js`: yıllık denetim programı oluşturma, listeleme, durum ve program detayları
- `audits.js`: planlı denetim oluşturma, denetim listeleri, filtreler, statü geçişleri ve denetim detayları
- `assignments.js`: denetim dosyası, heyet atama ve hazırlık kontrolü
- `selectors.js`: program/denetim state seçicileri
- `runtime.js`: circular import oluşturmadan modüller arası sınırlı callback köprüsü

`app.js` içinde kuruluş ön cevapları, ön değerlendirme, denetim icrası, itiraz, nihai rapor, bulgu/CAP, bildirim ve kullanıcı yönetimi bu aşamada korunmuştur. Bunlar Faz 8B.3'te kademeli olarak ayrılacaktır.

## Değişmeyen dosyalar

- `PQ_JSON_Model.json`: Faz 8B.1 ile birebir aynı
- `firestore.rules`: Faz 8B.1 / Faz 8A ile birebir aynı
- `css/app.css`: Faz 8B.1 ile aynı

## GitHub Pages yükleme

ZIP içindeki klasör yapısını repository ana dizinine aynen yükleyin. Özellikle `js/modules/` klasörü korunmalıdır.

`index.html` şu dosyaları göreli yoldan çağırır; dosyaları düzleştirmeyin:

- `./css/app.css`
- `./js/app.js`
- `PQ_JSON_Model.json`

## Önerilen smoke test

1. Sayfa ve giriş ekranı açılıyor mu?
2. Demo/Test → Gerçek Giriş geçişi çalışıyor mu?
3. Form Kütüphanesi / PQ listesi açılıyor mu?
4. Yıllık Programlar ve Yeni Program ekranları çalışıyor mu?
5. Programa Denetim Ekle ve Planlı Denetimler çalışıyor mu?
6. Denetim Dosyası / Heyet ekranı açılıyor ve kayıt yapılabiliyor mu?
7. Ön Cevap, Ön Değerlendirme, Denetim Çalışması, Nihai Rapor ve CAP ekranları önceki sürümdeki gibi açılıyor mu?

## Teknik doğrulama

- Tüm `.js` dosyalarında `node --check` başarılı.
- Yeni modüller Node ESM import testinden geçti.
- Program/denetim/heyet seçici ve durum yardımcıları için temel fonksiyon testi başarılı.
- `PQ_JSON_Model.json` ve `firestore.rules` SHA-256 karşılaştırmasıyla Faz 8B.1 ile aynı doğrulanmalıdır/ doğrulanmıştır.
