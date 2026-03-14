# Task Defaults & UX Improvements

**Date:** 2026-03-14
**Status:** Draft

## Problem

1. Her task oluşturmada aynı checkbox'ları tekrar seçmek gerekiyor — repo/provider bazlı default yok
2. Apply-to-main sonrası UI güncellenmiyor (stale state)
3. Apply-to-main worktree+branch'i siliyor — followup çalışma yapılamıyor
4. Branch'te commit yok — task değişiklik geçmişi takip edilemiyor
5. Apply-to-main sadece unstaged — committed seçeneği yok

## Design

### 1. Repo + Provider Bazlı Task Default'ları

#### DB: `task_defaults` tablosu

```sql
CREATE TABLE task_defaults (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  provider_name TEXT,  -- NULL = repo default, 'jira'/'sentry'/... = provider override
  require_plan INTEGER NOT NULL DEFAULT 1,
  auto_start INTEGER NOT NULL DEFAULT 0,
  auto_approve_plan INTEGER NOT NULL DEFAULT 0,
  use_worktree INTEGER NOT NULL DEFAULT 1,
  carry_dirty_state INTEGER NOT NULL DEFAULT 0,
  priority TEXT,
  UNIQUE(repo_id, provider_name)
);
```

- `provider_name = NULL` → repo-level default
- `provider_name = 'jira'` → Jira'dan gelen task'lar için override

#### Çözümleme sırası (3-tier)

```
provider override → repo default → hardcoded default
```

#### Backend

- `db/taskDefaults.ts`: CRUD methods (`getTaskDefaults`, `upsertTaskDefaults`)
- `routes/taskDefaults.ts`: `GET/PUT /api/repos/:repoId/task-defaults?provider=`
- `db/tasks.ts` → `createManualTask()`: default'ları `task_defaults` tablosundan çek

#### Frontend — Settings Modal

Settings'te mevcut "Repository" tab'ına yeni section:

```
── Task Defaults ──────────────────────────────
☑ Use Worktree  ☑ Require Plan  ☐ Auto Start  ☐ Auto Approve  ☐ Carry Dirty
Priority: [Medium ▾]

── Jira Override ──────────────────────────────
☑ Use Worktree  ☑ Require Plan  ☑ Auto Start  ☑ Auto Approve  ☐ Carry Dirty
Priority: [High ▾]

── Sentry Override ────────────────────────────
(not configured — uses repo defaults)
[+ Add Override]
```

Sadece bağlı provider'lar override olarak gösterilir.

#### Frontend — CreateTaskModal

Checkbox'lar görünür kalır (B seçeneği). Açılışta:
1. Provider'dan gelen task → provider override default'ları yükle
2. Manuel task → repo default'ları yükle
3. Kullanıcı isterse override edebilir

### 2. Task State: ARCHIVED Aşaması

#### State Machine Değişikliği

```
Mevcut:  TODO → ... → IN_REVIEW → DONE
Yeni:    TODO → ... → IN_REVIEW → DONE → ARCHIVED
```

- **DONE**: İş bitti. Worktree yaşıyor. Followup chat yapılabilir, yeni run başlatılabilir.
- **ARCHIVED**: Kullanıcı manuel olarak arşive atar. Worktree + branch silinir.

#### DB Değişikliği

`tasks.status` alanına `ARCHIVED` değeri eklenir. Mevcut enum string-based olduğu için migration gereksiz — sadece kod tarafında kabul edilmesi yeterli.

#### UI Değişikliği

- DONE lane'inde her task'ta "Archive" butonu
- ARCHIVED task'lar ayrı bir collapsed section'da (veya filtreli)
- Worktree silme sadece `ARCHIVED`'a geçişte tetiklenir

### 3. Branch'te Commit'li Değişiklik Takibi

#### Agent Run Sonrası Auto-Commit

`services/runAgent.ts`'te run tamamlandığında:

```typescript
// Run başarıyla bittiyse ve worktree'de değişiklik varsa
if (exitCode === 0 && hasChanges(worktreeDir)) {
  git('-C', worktreeDir, 'add', '-A');
  git('-C', worktreeDir, 'commit', '-m', `run #${runId}: ${taskTitle}`);
}
```

Bu sayede her run'ın değişiklikleri ayrı commit'te tutulur.

#### Kümülatif Diff Görüntüleme

Task detayında "Changes" tab'ı → branch'teki tüm commit'lerin kümülatif diff'i:

```
git diff main...task-branch
```

Bu, worktree silinene kadar (ARCHIVED) mevcut kalır.

### 4. Apply-to-Main Seçenekleri

#### Mevcut Davranış

Sadece: squash merge + unstaged (commit yok)

#### Yeni Davranış

Apply-to-main butonuna dropdown/seçenek eklenir:

| Seçenek | Davranış |
|---------|----------|
| **Unstaged** (mevcut) | Squash merge, commit yok, değişiklikler working tree'de |
| **Committed** | Squash merge + auto commit: `feat: [Task #id] title` |

#### Apply Sonrası Branch Reset

Her iki seçenekte de apply sonrası:

```typescript
// Branch'i main HEAD'e reset et — followup için temiz başlangıç
git('-C', worktreeDir, 'reset', '--hard', 'main');
```

- Unstaged seçildiyse ve `carry_dirty_state` aktifse, main'deki dirty changes sonraki followup'ta branch'e taşınır (mevcut mekanizma).
- Branch'teki eski commit'ler kaybolur ama main'de squash commit olarak var (kabul edildi).

### 5. Apply-to-Main Sonrası UI State Güncellemesi

#### Sorun

Apply-to-main tamamlandığında frontend hala eski state'i gösteriyor. Sayfa yenilemesi gerekiyor.

#### Çözüm

`mergeService.ts`'te apply işlemi tamamlandığında WebSocket event yayınla:

```typescript
globalBroadcast({
  type: 'task_applied',
  taskId,
  mergeType: 'committed' | 'unstaged',
});
```

Frontend'de `useTaskState` bu event'i dinleyip:
- Task state'ini yeniler (`fetchTask`)
- DiffViewer'ı temizler veya yeni diff'i yükler
- Başarı toast'ı gösterir

## Dosya Değişiklikleri

### Yeni Dosyalar
| Dosya | Sorumluluk |
|-------|-----------|
| `server-ts/src/db/taskDefaults.ts` | Task defaults CRUD |
| `server-ts/src/routes/taskDefaults.ts` | REST endpoints |
| `server-ts/migrations/V18__task_defaults.sql` | task_defaults tablosu |

### Değişecek Dosyalar
| Dosya | Değişiklik |
|-------|-----------|
| `server-ts/src/models/task.ts` | `ARCHIVED` status, `TaskDefaults` type |
| `server-ts/src/db/tasks.ts` | Default'ları task_defaults'tan çek |
| `server-ts/src/services/runAgent.ts` | Run sonrası auto-commit |
| `server-ts/src/services/mergeService.ts` | Committed seçeneği, branch reset, WS event |
| `server-ts/src/app.ts` | taskDefaults route mount |
| `web/src/components/CreateTaskModal.tsx` | Default'lardan pre-fill |
| `web/src/components/SettingsModal.tsx` | Task Defaults section |
| `web/src/components/MergeOptionsBar.tsx` | Committed/Unstaged seçeneği |
| `web/src/hooks/useTaskState.ts` | `task_applied` WS event dinle, ARCHIVED state |
| `web/src/types.ts` | TaskDefaults type, ARCHIVED status |

## Kapsam Dışı

- UI genel basitleştirme (ayrı bir tasarım konusu)
- Git diff görüntüleme iyileştirmeleri (DiffViewer refactor)
- Template/preset sistemi
