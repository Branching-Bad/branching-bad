# Feature Requests

Mevcut durumu, referans projeyi (vibe-kanban) ve yazılım geliştirici ihtiyaçlarını analiz ederek hazırlanmış özellik önerileri.

---

## 1. Git Diff Viewer + Satır Bazlı Review

**Ne:** Run tamamlandığında değişiklikleri satır satır gösteren bir diff viewer. Geliştirici herhangi bir satıra tıklayıp review yorumu bırakabilir.

**Nasıl çalışmalı:**
- `IN_REVIEW` durumuna geçen task için diff otomatik gösterilir
- Her dosya için unified/split view seçeneği
- Satıra tıkla → yorum yaz (inline WYSIWYG editor)
- **"Yorumları Bekle" modu:** Tüm yorumlar bırakılana kadar bekler, sonra "Review Gönder" butonu ile toplu gönderim
- **"Hemen İşle" modu:** Her yorum anında agent'a gönderilir
- Birden fazla satıra yorum bırakma desteği
- GitHub PR yorumlarını da overlay olarak gösterme

**Referans projede var:** `PierreDiffCard.tsx` + `ReviewProvider.tsx` + `CommentWidgetLine.tsx` ile tam implementasyon. `@pierre/diffs` kütüphanesi kullanılıyor.

**Öncelik: Yüksek** — Şu an review yorumu sadece tek bir text box'tan yazılıyor, satır bazlı feedback agent'ın doğru yeri düzeltmesi için kritik.

---

## 2. Task'a Model/Agent Seçimi

**Ne:** Her task kartına hangi agent (claude, codex, gemini) ve hangi model (opus, sonnet, haiku) ile çalıştırılacağını atama.

**Nasıl çalışmalı:**
- Task oluşturma/düzenleme formuna agent + model dropdown'u
- Kanban kartında küçük bir model badge'i (ör. "Claude Opus", "Codex")
- Repo default'u + task-level override hiyerarşisi
- Tasklist JSON'daki `suggested_subagent` alanıyla entegrasyon — plan aşamasında agent önerisi, kullanıcı onayı

**Şu an:** Agent seçimi repo düzeyinde yapılıyor (`repo_agent_preferences`), task bazında override yok.

**Öncelik: Yüksek** — Basit task'lar için haiku/sonnet, karmaşık task'lar için opus kullanmak maliyet ve hız açısından büyük fark yaratır.

---

## 3. Context7 / Online Araştırma Entegrasyonu

**Ne:** Task'a "Araştır" butonu ekleyerek, agent çalışmaya başlamadan önce Context7 üzerinden güncel dokümantasyon ve best practice araştırması yapılması.

**Nasıl çalışmalı:**
- Task detayında "Context7 ile Araştır" butonu
- Araştırma sonucu task description'a ek bağlam olarak eklenir
- Agent prompt'una bu bağlam da dahil edilir
- Opsiyonel: Agent çalışırken de Context7'ye erişebilsin (MCP server olarak)
- Kütüphane versiyon tespiti: `package.json`, `Cargo.toml` vs. parse edip doğru versiyon dökümanlarını çek

**Öncelik: Orta-Yüksek** — Özellikle yeni kütüphaneler veya breaking change'ler içeren task'larda agent'ın güncel bilgiyle çalışması kaliteyi ciddi artırır.

---

## 4. Canlı Chat / Agent ile Etkileşim

**Ne:** Agent çalışırken tek yönlü log izlemek yerine, agent'a mesaj gönderebilme, soru sorabilme, yön değiştirebilme.

**Nasıl çalışmalı:**
- Run output panelinin altına chat input box'ı
- Agent'ın `session_id`'si ile devam eden session'a mesaj gönderme (Claude Code bunu destekliyor)
- Agent soru sorduğunda (tool approval, clarification) kullanıcı yanıt verebilsin
- Önceki mesajı düzenleyip o noktadan retry yapabilme

**Referans projede var:** `ConversationList`, `SessionChatBox`, `RetryEditorInline` ile tam implementasyon.

**Öncelik: Yüksek** — Şu an agent bir kez başladığında müdahale edilemiyor. Yanlış yöne giderse tek seçenek durdurup yeniden başlatmak.

---

## 5. Gömülü Terminal (xterm.js)

**Ne:** Uygulama içinde bir terminal penceresi. Agent'ın çalıştığı branch/worktree içinde doğrudan komut çalıştırabilme.

**Nasıl çalışmalı:**
- Alt panelde açılır/kapanır terminal
- Otomatik olarak aktif task'ın branch/worktree dizinine cd
- Agent çıktısıyla yan yana veya tab olarak
- Birden fazla terminal sekmesi

**Referans projede var:** `XTermInstance` + WebSocket PTY bağlantısı.

**Öncelik: Orta** — Şu an geliştirici apply-to-main sonrası IDE'ye geçiş yapmak zorunda. Terminal bu geçişi azaltır.

---

## 6. Gömülü Preview Browser

**Ne:** Frontend task'larında agent'ın yaptığı değişikliklerin anlık preview'ı. `localhost:3000` gibi dev server'ları iframe içinde gösterme.

**Nasıl çalışmalı:**
- Agent loglarından dev server URL'sini otomatik algıla
- iframe ile gömülü browser
- Responsive boyut simülasyonu (mobile, tablet, desktop)
- "Inspect mode": Bir elemente tıkla → React component bilgisi chat'e eklensin → agent tam olarak neyi değiştireceğini bilsin

**Referans projede var:** `PreviewBrowserContainer` + proxy + inspect mode.

**Öncelik: Orta** — Frontend ağırlıklı projeler için çok değerli.

---

## 7. PR Oluşturma ve Git İşlemleri

**Ne:** `apply-to-main` sonrası doğrudan uygulama içinden PR oluşturma, push yapma.

**Nasıl çalışmalı:**
- "Create PR" butonu: başlık (task title'dan), body (plan summary'den), base branch, draft PR toggle
- GitHub CLI (`gh`) entegrasyonu
- Push durumu göstergesi (ahead/behind commits)
- Branch yönetimi: rebase, merge, target branch değiştirme

**Referans projede var:** `CreatePRDialog` + git işlemleri command bar.

**Öncelik: Orta-Yüksek** — Pipeline'ın son adımını tamamlar. Şu an geliştirici PR için terminal'e geçmek zorunda.

---

## 8. Task Filtreleme, Arama ve Etiketleme

**Ne:** Kanban board'da task'ları filtrele, ara, etiketle.

**Nasıl çalışmalı:**
- Üst barda arama kutusu (title, description, key)
- Filtreler: kaynak (jira/sentry/manual), öncelik, atanan kişi, etiket
- Özel etiket/tag sistemi (ör. "frontend", "bugfix", "refactor", "urgent")
- Toplu işlem: birden fazla task seç → toplu etiketle, toplu autostart aç/kapa

**Öncelik: Orta** — Task sayısı arttıkça zorunlu hale gelir.

---

## 9. Run Kuyruğu ve Paralel Çalıştırma

**Ne:** Aynı repo için birden fazla run'ı kuyruğa alma, worktree ile paralel çalıştırma.

**Nasıl çalışmalı:**
- `use_worktree=true` olan task'lar paralel çalışabilir (farklı worktree'lerde)
- Kuyruk sistemi: max paralel run sayısı ayarlanabilir
- Kuyruk durumu göstergesi (sırada 3 task var gibi)
- Öncelik bazlı sıralama

**Şu an:** `has_running_run_for_repo` kontrolü tüm run'ları blokluyor, kuyruk yok.

**Öncelik: Orta-Yüksek** — Birden fazla task'ı pipeline'a atıp bırakabilmek ciddi verimlilik artışı sağlar.

---

## 10. Metrikler ve Analitik Dashboard

**Ne:** Agent performansı, run başarı oranları, ortalama süreler, maliyet tahmini.

**Nasıl çalışmalı:**
- Run süresi, başarı/başarısızlık oranı, agent bazında karşılaştırma
- Token kullanım takibi (Claude stream-json'dan parse edilebilir)
- Haftalık/aylık trend grafikleri
- "Bu agent bu tür task'larda daha başarılı" önerileri
- Context window kullanım göstergesi

**Referans projede var:** `ContextUsageGauge` token kullanımı göstergesi.

**Öncelik: Düşük-Orta** — Uzun vadede agent seçimi ve maliyet optimizasyonu için değerli.

---

## 11. Task Bağımlılıkları (Dependency Graph)

**Ne:** Task'lar arası bağımlılık tanımlama. "Bu task şu task bitmeden başlayamaz."

**Nasıl çalışmalı:**
- Task oluştururken/düzenlerken "blocks" / "blocked by" ilişkisi
- Kanban board'da blocked task'lar kilitli görünsün
- Otomatik sıralama: bağımlılık çözülünce sıradaki task'ı pipeline'a al
- Plan'daki `blocked_by`/`blocks` alanlarıyla entegrasyon

**Şu an:** Tasklist JSON'da dependency graph var ama sadece agent'a context olarak veriliyor, enforce edilmiyor.

**Öncelik: Orta** — Büyük feature'ları alt task'lara bölerken önemli.

---

## 12. Bildirim Sistemi

**Ne:** Plan onay bekliyor, run tamamlandı, run başarısız oldu gibi olaylar için bildirim.

**Nasıl çalışmalı:**
- Desktop notification (Notification API)
- Ses bildirimi (opsiyonel)
- Webhook desteği (Slack, Discord, custom URL)
- Uygulama içi bildirim merkezi

**Öncelik: Orta** — Agent arka planda çalışırken başka işlerle uğraşan geliştirici için kritik.

---

## 13. Template Sistemi

**Ne:** Sık tekrarlanan task tipleri için şablonlar.

**Nasıl çalışmalı:**
- "Bug Fix Template", "New API Endpoint", "React Component" gibi hazır şablonlar
- Şablon: önceden tanımlı description, plan yapısı, agent tercihi, flag'ler
- Kullanıcı kendi şablonlarını oluşturabilsin
- Provider'dan gelen issue tipine göre otomatik şablon eşleme

**Öncelik: Düşük-Orta** — Tekrarlayan iş akışlarını hızlandırır.

---

## 14. Jira'ya Geri Yazma (Bidirectional Sync)

**Ne:** Uygulamadaki durum değişikliklerini Jira'ya geri yansıtma.

**Nasıl çalışmalı:**
- Task durumu değişince Jira issue transition'ı tetikle
- PR link'ini Jira issue'ya ekle
- Plan/review yorumlarını Jira comment olarak ekle
- Çift yönlü sync conflict resolution

**Şu an:** Sync tek yönlü (Jira → uygulama).

**Öncelik: Orta** — Takım çalışmasında Jira'yı güncel tutmak önemli.

---

## 15. MCP Server (Model Context Protocol)

**Ne:** Uygulamanın kendisini bir MCP server olarak expose etmesi, böylece agent'ın uygulama verilerine (task'lar, plan'lar, review'lar) erişebilmesi.

**Referans projede var:** `crates/mcp/src/` — workspace, issue, repo bilgilerine agent erişebiliyor.

**Öncelik: Düşük** — İleri seviye ama agent'ın "hangi task'lar beni bekliyor?" sorusunu cevaplamasını sağlar.

---

## Öncelik Özeti

| Öncelik | Özellik |
|---------|---------|
| **Yüksek** | Diff Viewer + Satır Review, Task Model Seçimi, Canlı Chat |
| **Orta-Yüksek** | Context7 Entegrasyonu, PR Oluşturma, Run Kuyruğu |
| **Orta** | Terminal, Preview Browser, Filtreleme/Etiketleme, Task Bağımlılıkları, Bildirimler, Jira Geri Yazma |
| **Düşük-Orta** | Metrikler, Template Sistemi, MCP Server |

---

## References

- **[vibe-kanban](https://github.com/example/vibe-kanban)** — Component pattern inspiration (diff viewer, chat, terminal, PR dialog)
- **[OpenWork](https://github.com/different-ai/openwork)** — Open-source desktop app for running AI agents, skills, and MCP workflows locally. Tauri + TypeScript + Rust. Local-first, session management with live SSE streaming, skills manager, permission system, template saving.
