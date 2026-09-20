# USOAP CMA - Faz 8B.4 Modülerleştirme

Bu paket Faz 8B.3 çalışan sürümünün devamıdır. İş kuralları değiştirilmeden İtiraz ve Nihai Rapor alanları `app.js` dışına alınmıştır.

## Yeni modüller

- `js/modules/objections.js`
  - İtiraz için uygun denetim seçimi
  - Kuruluşun itiraz var / yok bildirimi
  - Taslak ve gönderim işlemleri
  - İtiraz statü göstergesi
  - Süresi geçen itirazların kullanıcı onayıyla "itiraz yoktur" olarak tamamlanması

- `js/modules/final-reports.js`
  - Nihai rapor denetim seçimi
  - Nihai rapor taslağı ve önizlemesi
  - Nihai rapor gönderimi
  - Rapor statü göstergesi
  - Gönderim sonrası açık bulgular için CAP planı başlangıcı ve 45 günlük sürenin hesaplanması

## Korunan yapı

Faz 8A veri güvenliği ve Faz 8B.1-8B.3 modülleri korunmuştur. `PQ_JSON_Model.json`, `firestore.rules` ve `css/app.css` üzerinde bu fazda içerik değişikliği yapılmamıştır.

## GitHub'a yükleme

ZIP içindeki klasör yapısını aynen repository köküne yükleyin. Özellikle aşağıdaki iki yeni dosyanın bulunduğunu kontrol edin:

- `js/modules/objections.js`
- `js/modules/final-reports.js`

## Faz 8B.4 smoke test

1. Gerçek veya Demo/Test modunda uygulamanın normal açıldığını kontrol edin.
2. İtiraz Süreci ekranını açın; denetim seçimi ve süre bilgileri görünmeli.
3. Denetlenen Kuruluş rolünde test kaydı için "İtiraz yoktur" taslağı kaydedin ve mümkünse gönderin.
4. İtirazlı senaryoda açıklama boşken gönderimin engellendiğini kontrol edin.
5. Yönetici / Program Yöneticisi / Baş Denetçi rolünde İtiraz Sürecini Tamamla işlemini test edin.
6. "Süreleri Kontrol Et / Uygula" butonunun onay almadan kayıt değiştirmediğini kontrol edin.
7. Nihai Rapor ekranını açın; Yönetici Özeti, Sonuç/Takip Notu ve Dağıtım Notu alanları görünmeli.
8. Taslak rapor kaydedip sayfa yenilendiğinde verinin geri geldiğini kontrol edin.
9. Test denetiminde Nihai Raporu Gönder işlemi sonrası denetimin `CAP Bekleniyor` aşamasına geçtiğini ve açık NS bulgular için CAP planlarının oluştuğunu kontrol edin.
10. Denetim kartı / detay modalından İtiraz Süreci ve Nihai Rapor butonlarının çalıştığını kontrol edin.

Not: Gerçek veride rapor gönderimi ve CAP başlangıcı geri dönüşü zor bir iş akışı olduğundan mümkünse önce Demo/Test kaydıyla doğrulayın.
