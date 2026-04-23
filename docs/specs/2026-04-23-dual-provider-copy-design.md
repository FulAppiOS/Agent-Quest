# Dual-provider copy & ergonomics — Claude Code + Codex

**Data:** 2026-04-23
**Branch:** `feat/codex-provider`
**Stato:** Design approvato, in attesa di plan + implementazione

## Contesto

La branch `feat/codex-provider` ha aggiunto supporto a Codex (OpenAI Codex CLI) accanto al supporto Claude Code esistente. Il cambio lato server è già in place: `ClaudeProvider` e `CodexProvider` girano in parallelo, i loro `configDirs` sono uniti nella snapshot WebSocket, il parser Codex è integrato.

Manca però l'adeguamento **user-facing** e **di documentazione**: copy dell'empty state, banner di primo avvio, tutorial in-app, README, CLAUDE.md, commenti interni e alcuni rename cosmetici sono ancora esclusivamente Claude-centric. L'audit iniziale ha identificato ~45 punti da aggiornare.

Questo spec descrive tutte le modifiche necessarie per un dashboard che parla correttamente di entrambi i provider.

## Obiettivi

1. L'utente che apre il dashboard capisce che supporta sia Claude Code sia Codex.
2. Chi non ha nessuno dei due installati riceve un messaggio chiaro che cita entrambi.
3. Chi ha solo uno dei due installati non vede warning allarmanti per l'altro.
4. La documentazione (README, CLAUDE.md, Tutorial) è coerente e riflette la matrice di supporto piattaforma.
5. I commenti interni nelle aree provider-agnostic non dicono più "Claude" quando in realtà coprono entrambi.
6. Rimozione di nomi identificatori Claude-specifici (file, classi CSS, localStorage key) in punti dove sono diventati fuorvianti.

## Fuori scope

- **Refresh dell'auto-discovery dopo il boot.** Entrambi i provider fanno discovery solo a `start()`; se installi l'uno o l'altro mentre il server è già attivo, serve riavviare. È un limite simmetrico, non introdotto da questa branch.
- **Hook Codex.** Codex non espone hook equivalenti a `postToolUse` di Claude Code. L'endpoint Hono resta Claude-only; va solo documentato come tale.
- **Test Windows di Codex.** Codex è attualmente testato solo su macOS; verifica Windows segue in un giro separato. Questo spec si limita a comunicare lo stato corrente.
- **Rename di `sessionRegistry` / `claudeProvider` nel server.** I commenti aggiornati bastano a chiarirne la natura Claude-only; rinominare sarebbe pura cosmesi.
- **Nuovi banner/nag quando manca un provider.** Se solo Claude o solo Codex è installato, il dashboard resta silenzioso: nessun invito a installare l'altro.

## Vocabolario fissato

| Concetto | Termine scelto |
|---|---|
| Provider Anthropic | `Claude Code` |
| Provider OpenAI | `Codex` (secco, non "Codex CLI") |
| Caveat piattaforma Codex | *"Codex: macOS tested. Windows not yet verified."* |
| Tagline complessiva | *"… for Claude Code and Codex agents."* |
| Empty state generico | *"No Claude Code or Codex installation detected"* |

Il banner e il warning centralizzato del server **non** contengono link di installazione: solo testo informativo. Il Tutorial mantiene solo il link alla documentazione di Claude Code già presente (`docs.claude.com`); per Codex non si introducono link nuovi.

## Matrice comportamentale attesa

Server (`index.ts`) aggrega:

```ts
allConfigDirs() = [
  ...claudeProvider.getConfigDirs(),
  ...codexProvider.getConfigDirs(),
]
```

Il client mostra il banner empty-state solo se `configDirs.length === 0`.

| # | Claude install | Codex install | Banner UI | Log server |
|---|---|---|---|---|
| 1 | ✓ | ✗ | No | `[ClaudeProvider] watching N dir(s)` **+** `[CodexProvider] ~/.codex not found — provider inactive` (info) |
| 2 | ✗ | ✓ | No | `[ClaudeProvider] no ~/.claude* dir — provider inactive` (info) **+** `[CodexProvider] watching ~/.codex` |
| 3 | ✓ | ✓ | No | Entrambi OK |
| 4 | ✗ | ✗ | **Sì** — titolo e testo citano entrambi | `[Server] WARNING: no Claude Code or Codex install detected. Start a session with either to see heroes here.` — un solo warning centralizzato |

**Fix principali rispetto allo stato attuale:**

- **Scenario 2 bug (oggi)**: il `FileWatcher` di Claude stampa comunque un WARNING "Install Claude Code" anche quando Codex è presente. Viene rimosso.
- **Scenario 4 (oggi)**: titolo banner *"No Claude Code installation detected"* + link install solo per Claude. Diventa provider-agnostic citando entrambi e senza link install.
- **Scenari 1/2 (oggi)**: asimmetria nei log — Claude usa WARNING, Codex usa log calmo. Viene uniformato a info-level in entrambi i provider, warning solo a livello bootstrap in Scenario 4.

## Cambiamenti per area

### A) Server log bootstrap

**File:** `server/src/watchers/file-watcher.ts`, `server/src/providers/codex-provider.ts`, `server/src/index.ts`

- `FileWatcher.start()`: rimuovere le tre righe di `console.warn` quando `claudeDirs.length === 0`. Sostituire con un singolo `console.log('[ClaudeProvider] no ~/.claude* dir — provider inactive')`.
- `CodexProvider.start()`: cambiare il `console.warn` ("not found — Codex threads won't appear") in `console.log('[CodexProvider] ~/.codex not found — provider inactive')`.
- `server/src/index.ts` dopo `await claudeProvider.start(...)` e `await codexProvider.start(...)`: aggiungere un controllo. Se `allConfigDirs().length === 0` → `console.warn('[Server] WARNING: no Claude Code or Codex install detected. Start a session with either to see heroes here.')`.
- Aggiornare il commento `server/src/index.ts:188-191` ("no Claude install" → "no agent CLI install").

### B) Banner empty-state (rename + copy)

**File rinominati:**
- `client/src/components/NoClaudeBanner.tsx` → `NoInstallBanner.tsx`
- `client/src/components/NoClaudeBanner.css` → `NoInstallBanner.css`

**Rename interni:**
- Nome componente esportato: `NoClaudeBanner` → `NoInstallBanner`
- Classi CSS: `.no-claude-banner`, `.no-claude-icon`, `.no-claude-body`, `.no-claude-title`, `.no-claude-text`, `.no-claude-link`, `.no-claude-dismiss` → `.no-install-banner`, `.no-install-icon`, ecc.
- Costante localStorage: `agent-quest:no-claude-dismissed` → `agent-quest:no-install-dismissed`

**Migrazione localStorage.** Al mount del componente, se esiste la vecchia chiave e la nuova no, copiala sulla nuova e cancella la vecchia. Una riga, nessuna regressione per chi aveva già chiuso il banner.

**Nuovo copy (zero link di installazione):**
- Titolo: *"No Claude Code or Codex installation detected"*
- Corpo: *"The server found no `~/.claude*` or `~/.codex` directory with session logs."*
- Closing: *"Start a Claude Code or Codex session to see heroes appear here."*

**JSDoc del componente** aggiornato per citare entrambi i provider e i due percorsi.

**Callsite** (`client/src/App.tsx`): aggiornare l'import e il nome del componente.

### C) Tutorial in-app

**File:** `client/src/components/Tutorial.tsx`

Riga 36 (tagline):
- *"Use the Claude Code CLI or Codex as usual — each session auto-spawns a hero on the dashboard, live."*

Righe 51-55 (intro):
- *"Agent Quest is a live dashboard that turns your Claude Code and Codex sessions into a 2D fantasy village. Every running agent becomes a hero who walks between buildings based on what it's doing."*

Righe 58-67 (compatibilità) — riscrittura completa in due frasi:
- *"Works with Claude Code in any form that writes session logs locally — the terminal CLI and the official IDE extensions (VS Code, JetBrains). Also works with Codex CLI (reads rollout logs from `~/.codex/sessions/`). It doesn't work with the Claude desktop app or claude.ai in the browser, since those don't expose local session files."*
- Link `docs.claude.com` resta. Nessun link nuovo per Codex.

Riga 85 (how to use):
- *"Heroes appear in real time as you spawn new Claude Code or Codex sessions."*

**Nuovo paragrafo breve dopo la legenda delle attività** — spiegazione del badge source:
- *"When both Claude Code and Codex have active agents, each hero shows a small `CLAUDE` or `CODEX` badge so you can tell which CLI it came from."*

Sezione "Privacy" (riga 119-123) — ultima frase:
- *"Agent Quest only reads the logs Claude Code and Codex already keep on your disk."*

Sezione "Platform" (riga 125-129) — riscritta con matrice esplicita:
- *"Claude Code: tested on macOS and Windows (via WSL2 — see README)."*
- *"Codex: macOS tested. Windows not yet verified."*
- *"Linux: should work but not routinely tested."*

### D) ActivityFeed empty state

**File:** `client/src/components/ActivityFeed.tsx:173`

- Attuale: *"Launch Claude Code in any project — it'll appear here."*
- Nuovo: *"Launch Claude Code or Codex in any project — it'll appear here."*

### E) README.md

Aggiornamenti mirati alle 8 righe identificate, nell'ordine in cui compaiono:

| Riga | Attuale | Nuovo |
|---|---|---|
| 6 | *"A fantasy village dashboard for monitoring your Claude Code agents."* | *"A fantasy village dashboard for monitoring your Claude Code and Codex agents."* |
| 20 | *"Use the Claude Code CLI as usual — …"* | *"Use Claude Code or Codex as usual — each agent session auto-spawns a hero on the dashboard, live."* |
| 22 | *"Agent Quest is a browser-based monitoring dashboard that visualizes active Claude Code agent sessions…"* | *"…that visualizes active Claude Code and Codex agent sessions…"* |
| 47 | *"Claude Code sessions happen in a terminal — useful, but not very alive. When you run several agents at once (across projects, across `~/.claude*` installations)…"* | *"Claude Code and Codex sessions happen in a terminal — useful, but not very alive. When you run several agents at once (across projects, across `~/.claude*` installations and `~/.codex`)…"* |
| 52 | *"Auto-discovery of every `~/.claude*` directory (supports multiple installations like `~/.claude-work`, `~/.claude-personale`)"* | *"Auto-discovery of every `~/.claude*` directory (supports multiple installations like `~/.claude-work`, `~/.claude-personale`) and of `~/.codex` if present"* |
| 55 | *"…(optional lower-latency path via Claude Code `postToolUse` hooks)"* | *"…(optional lower-latency path via Claude Code `postToolUse` hooks — Claude Code only; Codex doesn't expose hooks)"* |
| 61-62 | *"An active [Claude Code](…) installation (…)…"* **/** *"macOS or Linux recommended — Windows via WSL2"* | *"An active Claude Code or Codex installation (one or more `~/.claude*` directories and/or `~/.codex`). Without it the dashboard still starts, but the village stays empty and a banner tells you so."* **+** nuova matrice piattaforma (sotto) |
| 107 | *"### One-line install (macOS only)"* | *"### One-line install (macOS only)"* (invariato) — ma con nota chiarificatrice: *"(The one-line installer script is macOS-only; Agent Quest itself runs on macOS and Linux, and via WSL2 on Windows — see the manual install below.)"* |
| 148 | *"**Empty village with a "No Claude Code installation detected" banner** — … [Install Claude Code]…"* | *"**Empty village with a "No Claude Code or Codex installation detected" banner** — expected when no `~/.claude*` or `~/.codex` directory with session logs exists. Start a Claude Code or Codex session and heroes appear automatically (the banner disappears on its own)."* |

**Nuova mini-sezione Platform matrix** da inserire prima della sezione Windows/WSL2:

```
### Platform matrix

|             | macOS | Windows              | Linux            |
|-------------|-------|----------------------|------------------|
| Claude Code | ✓     | ✓ (WSL2 recommended) | ✓                |
| Codex       | ✓     | not yet verified     | not yet verified |

Claude Code is exercised on macOS and Windows. Codex has been tested on
macOS only so far — it should work on Windows/Linux the same way (the
provider watches `~/.codex/sessions/`), but we haven't confirmed it yet.
```

### F) CLAUDE.md del progetto

**File:** `CLAUDE.md` (root del repo)

Sezione "Architecture":
- Citare `ClaudeProvider` e `CodexProvider` esplicitamente.
- Data flow: aggiungere la path di Codex → `~/.codex/sessions/**/rollout-*.jsonl`.
- Nota: *"The optional Hono `postToolUse` endpoint is Claude Code only; Codex doesn't expose hooks."*
- Nota: *"`SessionRegistry` pidfile oracle is Claude Code specific. Codex liveness is inferred purely from rollout-file activity."*

Sezione "Key Type: AgentState":
- Menzionare che `configDir` può essere sia `~/.claude*` sia `~/.codex`, e che il campo `source` (`'claude' | 'codex'`) discrimina.

### G) Commenti interni provider-agnostic

| File | Riga | Commento attuale | Nuovo |
|---|---|---|---|
| `server/src/types.ts` | 54 | `// Claude config dir (e.g. ~/.claude, ~/.claude-work) — identifies which installation` | `// Config dir of the provider that produced the session (e.g. ~/.claude, ~/.claude-work, ~/.codex) — identifies which installation` |
| `server/src/types.ts` | 58 | `// --- Session metadata from ~/.claude/sessions/<pid>.json ---` | `// --- Session metadata from ~/.claude/sessions/<pid>.json (Claude Code only — Codex has no equivalent pidfile) ---` |
| `server/src/session-registry.ts` | 33 | `"Claude config dirs to watch (each scanned under \`<dir>/sessions/*.json\`)"` | `"Claude Code config dirs to watch (each scanned under \`<dir>/sessions/*.json\`). Registry is Claude-only by design — the pidfile oracle is a Claude-specific signal."` |
| `client/src/hooks/useAgentState.ts` | 15 | `"…an empty array means the server found no ~/.claude* install on disk."` | `"…an empty array means the server found neither ~/.claude* nor ~/.codex install on disk."` |
| `server/src/index.ts` | 189-191 | commento "no Claude install" | "no agent CLI install (Claude Code or Codex)" |

### H) DetailPanel configDir formatter

**File:** `client/src/components/DetailPanel.tsx:21-26`

Funzione attuale `profileLabel(configDir)`:

```ts
function profileLabel(configDir: string): string {
  if (configDir === '') return 'default';
  const base = configDir.split('/').pop() ?? configDir;
  if (base === '.claude') return 'default';
  return base.replace(/^\.claude-?/, '') || base;
}
```

**Bug attuale con Codex:** se `configDir = ~/.codex`, `base = '.codex'`. La regex `/^\.claude-?/` non matcha, quindi ritorna `base` = `'.codex'` **con il punto davanti**. Il display diventa ".codex" invece che "codex".

**Nuovo comportamento:**

```ts
function profileLabel(configDir: string): string {
  if (configDir === '') return 'default';
  const base = configDir.split('/').pop() ?? configDir;
  if (base === '.claude') return 'claude';
  if (base === '.codex') return 'codex';
  // Multi-install Claude (~/.claude-work, ~/.claude-personale)
  const stripped = base.replace(/^\.claude-?/, '');
  return stripped !== base ? stripped : base.replace(/^\./, '');
}
```

Note:
- Il risultato per `.claude` cambia da `'default'` a `'claude'` per simmetria con `'codex'`. Verificato con grep: la stringa `'default'` non è usata come sentinel altrove nel client, è solo display.
- La fallback finale `base.replace(/^\./, '')` strippa il punto iniziale per qualunque futura directory dotted (evita il bug analogo per `.codex` e simili).

### I) Design spec storico

**File:** `docs/specs/2026-04-15-agent-quest-design.md`

Non riscrittura. Appendere in fondo una breve appendice:

```markdown
---

## Appendice — 2026-04-23: supporto Codex

Lo spec originale descrive il supporto esclusivo per Claude Code.
Nella branch `feat/codex-provider` è stato aggiunto `CodexProvider`,
che affianca `ClaudeProvider` leggendo i rollout log da `~/.codex/sessions/`.

Per il dettaglio delle modifiche UX e di copy, vedi
`docs/specs/2026-04-23-dual-provider-copy-design.md`.
```

## Verifica manuale

La branch va testata in tutti e 4 gli scenari di install, in ordine:

1. **Nessun provider** — rinominare temporaneamente `~/.claude` e `~/.codex` (se esistono) in `~/.claude.bak` e `~/.codex.bak`, avviare `bun start`, aprire `http://localhost:4445`.
   - Atteso: banner *"No Claude Code or Codex installation detected"* con nuovo copy, zero link, warning singolo nel log del server.

2. **Solo Claude** — ripristinare `~/.claude`, tenere `~/.codex.bak`, riavviare.
   - Atteso: nessun banner, nessun warning. Log Claude "watching N dir(s)", log Codex info "provider inactive".

3. **Solo Codex** — rinominare di nuovo `~/.claude`, ripristinare `~/.codex`, riavviare.
   - Atteso: nessun banner, nessun warning. Log Claude info "provider inactive", log Codex "watching ~/.codex". **Regression check**: verificare che il WARNING "Install Claude Code" non appaia più.

4. **Entrambi** — ripristinare tutto, riavviare.
   - Atteso: nessun banner, entrambi i provider loggano "watching". Se si lanciano due sessioni (una Claude, una Codex), ogni eroe mostra il badge corretto.

Ogni step verifica anche: ActivityFeed empty state, Tutorial (apribile con ❓), README + CLAUDE.md letti a occhio per coerenza.

## Known limitations

- **Auto-discovery al boot.** Entrambi i provider scoprono i propri config dir solo a `start()`. Installare Claude Code o Codex mentre il server è attivo richiede riavvio. Non è una regressione di questa branch; simmetrico per entrambi i provider.
- **Codex su Windows/Linux.** Non verificato. Il provider è scritto in modo path-agnostic (`homedir()` + `join`), quindi in linea teorica dovrebbe funzionare, ma finché non c'è testing reale il README e il Tutorial lo dichiarano non verificato.
