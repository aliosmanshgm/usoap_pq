# USOAP CMA - Faz 8B.5 Modülerleştirme

Bu paket Faz 8B.4 çalışan sürümünün devamıdır. İş kuralları değiştirilmeden Bulgular ve CAP yaşam döngüsü `app.js` dışına alınmıştır.

## Yeni modüller

- `js/modules/findings.js`
  - Açık/kapatılmış bulgu listeleri
  - Bulgu tablo gösterimi
- `js/modules/cap.js`
  - Kuruluş CAP girişi ve çoklu CAP adımları
  - Taslak / toplu sunum
  - CAP değerlendirme
  - CAP izleme, ilerleme ve tamamlandı bildirimi
  - Adım doğrulama ve bulgu kapatma
  - Denetim üst CAP statüsünün türetilmesi
  - Eski CAP kayıtları için bakım/onarma araçları
  - CAP durum raporu / Kanban

## Korunan davranışlar

- Nihai rapor gönderiminden sonra açık bulgular için CAP planı oluşturma davranışı `final-reports.js` içinde aynen korunur.
- CAP son tarihi varsayılan olarak nihai rapor gönderim tarihinden itibaren 45 gündür.
- Silinmiş CAP adımları ilerleme ve kapanış hesabına dahil edilmez.
- Bir denetimin CAP üst statüsü tek bir CAP planından değil, denetimdeki tüm CAP planlarından türetilir.
- Demo/localStorage ile gerçek Firebase modu ayrımı korunur.
- `PQ_JSON_Model.json`, `firestore.rules` ve `css/app.css` bu fazda değiştirilmemiştir.

## GitHub'a yükleme

ZIP içeriğini klasör yapısını koruyarak repository köküne yükleyin. Özellikle şu yeni dosyaların bulunduğunu kontrol edin:

```text
js/modules/findings.js
js/modules/cap.js
```

`index.html` ve `js/app.js` de Faz 8B.5 sürümleriyle birlikte güncellenmelidir.

## Faz 8B.5 smoke test

1. Uygulama açılışı ve konsolda module/404 hatası olmaması.
2. Açık Bulgular ve Kapatılan Bulgular ekranlarının açılması.
3. Demo kuruluş rolünde `Kuruluş Portalı -> CAP Girişi` ekranının açılması.
4. Bir CAP planında kök neden, genel eylem özeti ve koordinatör alanlarının Taslak Kaydet ile korunması.
5. CAP adımı ekleme; sorumlu birim, uygulama tarihi, ilerleme ve kanıt alanlarının kaydı.
6. Birden fazla açık CAP varsa planlar arasında geçiş yapıldığında verilerin birbirine karışmaması.
7. `Tüm CAP Planlarını Onaya Sun` akışı.
8. Baş Denetçi/Yönetici rolünde CAP kabul, kısmen kabul/revizyon ve iade kararları.
9. Kabul edilmiş CAP'te ilerleme -> tamamlandı bildirimi -> doğrulama -> bulgu kapatma.
10. Raporlar -> CAP Durum Raporu ekranının açılması ve Kanban/sayaçların görünmesi.
11. Ayarlar -> Faz 8A Veri Bakım Araçları butonlarının hâlâ çalışması.
12. Bildirim Merkezi'nde CAP planı ve CAP adımı süre uyarılarının görünmesi.

Gerçek kayıt üzerinde kapanış testi yapmadan önce Demo/Test modu kullanılması önerilir.
