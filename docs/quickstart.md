# Branching Bad — Quickstart

Branching Bad, Jira ve Sentry gibi servislerden aldigi tasklari yapay zeka ile cozen, onay tabanli bir kodlama ajansidir. Plan olusturur, onayinizi bekler, kodu yazar, siz review edersiniz.

---

## Baslangic

### Gereksinimleri Kur

- **Node.js** (v18+)
- **Rust** (stable toolchain)
- En az bir AI agent sisteminizde kurulu olmali: `codex`, `claude`, `gemini`, `opencode` veya `cursor`

### Uygulamayi Calistir

```bash
npm run dev
```

Tarayicida `http://localhost:5173` adresini acin. Backend otomatik olarak `http://localhost:4310` portunda baslar.

---

## 1. Repo Ekle

1. Sag ustteki **ayarlar** (disli) ikonuna tiklayin
2. **Repository** sekmesinde "Add New Repository" altinda klasor seciciden projenizin yolunu secin
3. Isterseniz bir etiket verin, "Save Repository" tiklayin
4. Ustteki "Active Repository" dropdown'undan eklediginiz repoyu secin

---

## 2. AI Agent Sec

1. Ayni ayarlar modalinda **AI Agent** sekmesine gecin
2. "Discover" butonuna tiklayin — sisteminizde kurulu AI agent'lar taranir
3. Dropdown'dan kullanmak istediginiz agent/model kombinasyonunu secin
4. "Save for Repo" tiklayin

> Her repo icin farkli bir agent secebilirsiniz.

---

## 3. Jira Bagla (Opsiyonel)

Jira'dan task cekmek istiyorsaniz:

1. Ust bardaki **uzanti** (puzzle) ikonuna tiklayin — Extensions drawer acilir
2. **Jira** kartindaki disli ikona tiklayin
3. Acilan modalda bilgilerinizi girin:
   - **Jira URL:** `https://orgadi.atlassian.net`
   - **Email:** Jira hesap e-postaniz
   - **API Token:** Atlassian'dan olusturdugunuz API token ([token olustur](https://id.atlassian.com/manage-profile/security/api-tokens))
4. "Connect" tiklayin
5. Hesabinizi secin, "Fetch Boards" ile boardlarinizi listeleyin
6. Board secip "Bind Repo to Board" tiklayin

Artik drawer'daki **Sync Tasks** butonu ile Jira'daki size atanmis tasklari kanban panoya cekebilirsiniz.

---

## 4. Sentry Bagla (Opsiyonel)

Sentry'den hata takibi yapmak istiyorsaniz:

1. Extensions drawer'da **Sentry** kartindaki disli ikona tiklayin
2. Bilgilerinizi girin:
   - **Sentry URL:** `https://sentry.io` veya `https://orgadi.sentry.io` (otomatik duzeltilir)
   - **Organization Slug:** Sentry'deki organizasyon adiniz (URL'den gorebilirsiniz)
   - **Auth Token:** Sentry ayarlarindan olusturdugunuz token ([token olustur](https://sentry.io/settings/auth-tokens/))
3. "Connect" tiklayin
4. Hesabinizi secin, "Fetch Projects" ile projelerinizi listeleyin
5. Proje secip "Bind Repo to Project" tiklayin

Baglandiktan sonra drawer'da **Sync Sentry** butonuna tiklayin. Cozulmemis hatalar kart olarak gorunur:

- **Fix** — Hatadan otomatik bir task olusturur ve plan uretimini baslatir
- **Ignore** — Hatayi listeden cikarir

---

## 5. Task Olustur ve Calis

Tasklari uc yolla olusturabilirsiniz:

- **Jira'dan:** Sync Tasks ile otomatik cekilir
- **Sentry'den:** Fix butonuyla hata task'a donusur
- **Manuel:** Kanban panodaki "To Do" sutunundaki **+** butonuna tiklayin, baslik ve aciklama girin

### Task Ayarlari

Task olustururken veya duzenlerken dort onemli secenek vardir:

| Secenek | Varsayilan | Aciklama |
|---|---|---|
| **Require Plan** | Acik | Kod yazmadan once plan olusturulur ve onayiniz beklenir |
| **Auto Approve Plan** | Kapali | Plan otomatik onaylanir, siz kontrol etmezsiniz |
| **Auto Start** | Kapali | Plan onaylandiktan sonra agent otomatik baslatilir |
| **Use Worktree** | Acik | Agent izole bir git worktree'de calisir, ana repo etkilenmez |

> Hizli calismak icin Auto Approve + Auto Start acabilirsiniz. Kontrol istiyorsaniz sadece Require Plan acik kalsin.
>
> **Worktree modu** (varsayilan) buyuk ozellikler icindir — agent ayri bir dizinde calisir, ana reponuz main branch'te kalir. Bitince "Apply to Main" ile degisiklikleri ana branch'e unstaged olarak alirsiniz.
>
> **Direct modu** (Use Worktree kapali) kucuk duzeltmeler icindir — agent direkt mevcut branch uzerinde calisir, branch acilmaz, Apply adimina gerek kalmaz.

---

## 6. Plan Olustur ve Onayla

1. Kanban'da bir task'a tiklayin — sag tarafta detay paneli acilir
2. **Plan** sekmesinde "Generate Plan" butonuna tiklayin
3. Plan uretilirken canli ciktisini terminal kutusunda izleyin
4. Plan hazir olunca markdown olarak goruntulenir
5. Uc seceneginiz var:
   - **Approve** — Plani onaylayin, agent artik calisabilir
   - **Request Revision** — Yorum yazin, plan yeniden uretilsin
   - **Reject** — Plani tamamen reddedin

> Plani onaylamadan once isterseniz metin kutusundan elle duzenleyebilirsiniz.

---

## 7. Agent'i Calistir

1. Plan onaylandiktan sonra **Run Output** sekmesine gecin
2. **Start Run** butonuna tiklayin
3. Agent sectiginiz AI araci kullanarak kodu yazar
4. Canli loglar terminal kutusunda akar
5. Bitince task otomatik olarak **In Review** durumuna gecer

> **Worktree modu:** Agent izole bir worktree dizininde calisir (ornek: `.branching-bad/worktrees/agent/claude-PROJ-42-1706123456/`). Ana reponuz main branch'te kalir — ayni anda editorde calismaya devam edebilirsiniz.
>
> **Direct modu:** Agent direkt mevcut branch uzerinde calisir. Branch acilmaz, degisiklikler aninda gorunur.

---

## 8. Review ve Geri Bildirim Dongusu

Task "In Review" olunca **Review** sekmesi otomatik acilir. Bu asama en onemli kisimdir — yapilan isi kontrol eder ve gerekirse duzeltme istersiniz.

### Degisiklikleri Inceleyin

Agent'in olusturdugu kodu kendi editorunuzde ilgili branch uzerinde inceleyebilirsiniz.

### Geri Bildirim Gonderin

1. Metin kutusuna neyin degismesi gerektigini yazin
2. **Submit Feedback** tiklayin
3. Agent yorumunuza gore kodu duzeltmeye baslar — otomatik olarak Run Output sekmesine gecerek ilerlemeyi izlersiniz
4. Bitince tekrar Review sekmesine donun

Bu donguyu istediginiz kadar tekrarlayabilirsiniz. Her geri bildirim yeni bir calisma baslatir.

### Bitirme

- **Apply to Main** (sadece Worktree modunda gorunur) — Worktree'deki degisiklikleri ana branch'inize squash merge ile unstaged olarak uygular. Merge conflict varsa uyari gosterir. Worktree otomatik temizlenir.
- **Mark as Done** — Task'i tamamlanmis olarak isaretler, Done sutununa tasir

> Direct modda "Apply to Main" butonu gorunmez cunku degisiklikler zaten ana branch'tedir.

---

## Kanban Pano

Pano dort sutundan olusur:

| Sutun | Aciklama |
|---|---|
| **To Do** | Yeni tasklar burada baslar |
| **In Progress** | Agent aktif olarak calisiyor |
| **In Review** | Agent bitti, sizin incelemenizi bekliyor |
| **Done** | Tamamlanan tasklar |

- Kartlari surukleyerek sutunlar arasi tasiyabilirsiniz
- Altta **Archive** bolumu vardir — tamamlanan tasklari arsivleyebilirsiniz
- Bir task'a tiklamak detay panelini acar

---

## Tipik Calisma Akisi

### Worktree Modu (buyuk ozellikler)

```
Task olustur (Use Worktree: acik)
  → Plan uret → Incele → Onayla
    → Agent worktree'de calisir, ana repo main'de kalir (In Progress)
      → Review et (In Review)
        → Geri bildirim gonder → Agent ayni worktree'de duzeltir → Tekrar review
        → "Apply to Main" → Degisiklikler main'e unstaged gelir → Worktree temizlenir
        → "Mark as Done"
```

### Direct Modu (hizli duzeltmeler)

```
Task olustur (Use Worktree: kapali)
  → Plan uret → Incele → Onayla
    → Agent direkt main'de calisir, branch yok (In Progress)
      → Review et (In Review)
        → Geri bildirim gonder → Agent yine main'de duzeltir → Tekrar review
        → "Mark as Done" (Apply gereksiz, degisiklikler zaten main'de)
```

---

## Sik Sorulan Sorular

**Birden fazla repo ekleyebilir miyim?**
Evet. Ayarlar modalindaki dropdown'dan aktif repoyu degistirirsiniz. Her reponun kendi board'u, baglantilari ve agent secimi vardir.

**Agent bulunamazsa ne yapmaliyim?**
AI Agent sekmesinde "Discover" tiklayin. Sisteminizde `codex`, `claude`, `gemini`, `opencode` veya `cursor`'dan en az birinin kurulu ve PATH'te erisilebilir olmasi gerekir.

**Plan olmadan direkt calistirabilir miyim?**
Evet. Task olustururken "Require Plan" secenegini kapatin. Boylece direkt "Start Run" yapabilirsiniz.

**Sentry sync calismiyorsa?**
Extensions drawer'da Sentry kartinin disli ikonundan baglanti bilgilerinizi kontrol edin. Proje bind edilmis olmali. Sync sonrasi hata mesaji gorunurse detayi orada okuyabilirsiniz.

**Merge conflict olursa?**
"Apply to Main" tikladiginizda conflict varsa, etkilenen dosyalar listelenir. Worktree'deki branch'ta conflictleri cozdukten sonra tekrar deneyin.

**Worktree ve Direct modu arasindaki fark nedir?**
Worktree modunda agent izole bir dizinde calisir, ana reponuz etkilenmez — ayni anda editorde calismaya devam edebilirsiniz. Direct modda agent direkt ana branch uzerinde calisir, degisiklikler aninda gorunur — kucuk duzeltmeler icin daha hizlidir.
