# Context budget, skill & plugin telemetry, gerarchia subagent — Design

**Data:** 2026-10-15
**Stato:** Design approvato in sessione autonoma; implementazione nella stessa sessione (nessun push).

## Contesto

Agent Quest mostra *cosa* fa un agente (edificio = attività) ma non *quanto contesto*
sta consumando né *con quali strumenti* (skill, plugin, subagent). L'utente vuole:

1. vedere se un agente Claude Code o Codex sta usando skill e plugin, e quanto contesto
   ciascuno consuma o fa risparmiare;
2. vedere la percentuale di finestra di contesto usata dalla conversazione principale,
   per capire quando si avvicina alla saturazione (compaction);
3. distinguere a colpo d'occhio gli agenti principali dai subagent che lavorano per loro.

## Fatti verificati sui log (spike)

Analisi dei JSONL Claude in `~/.claude*/projects` e dei rollout Codex in `~/.codex/sessions` presenti sulla macchina di sviluppo (sessioni dell'autore, nessun estratto riportato qui).

### Claude Code

| Segnale | Dove | Note |
|---|---|---|
| Contesto usato | `message.usage` su ogni riga `assistant` | `used = input + cache_read + cache_creation + output`; le righe della stessa `message.id` ripetono la stessa usage (dedupe già esistente) |
| Finestra di contesto | **non** nel JSONL | `message.model` è `claude-fable-5-1` anche quando `settings.json` ha `claude-fable-5-1[1m]`; picchi osservati fino a 950k token ⇒ la finestra va **inferita** (settings + picco) |
| Compaction | `type:'system', subtype:'compact_boundary'`; `user.isCompactSummary` | mai presenti nei log analizzati (finestra 1M), ma documentati da Claude Code: si gestiscono comunque |
| Skill attiva | `attributionSkill` / `attributionPlugin` su righe `assistant` | valorizzati da Claude Code stesso, es. `superpowers:brainstorming` |
| Caricamento skill | `tool_use` `Skill {skill}` → `tool_result` "Launching skill…" → riga `user` `isMeta:true` con testo "Base directory for this skill: …" | il corpo della skill è ciò che entra nel contesto (brainstorming: 17.8k caratteri ≈ 4.5k token) |
| Plugin / MCP | nomi tool `mcp__plugin_<plugin>_<server>__<tool>` e `mcp__<server>__<tool>`; dimensione del `tool_result` | es. `mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_screenshot` |
| Subagent → parent | path `<project>/<parentId>/subagents/[workflows/wf_x/]agent-*.jsonl`; `agent-*.meta.json` con `agentType`, `description`, `toolUseId`, `spawnDepth` | le righe del figlio hanno `isSidechain:true`, `agentId`, e `sessionId` del parent |
| Risultato del subagent nel parent | sync: `tool_result` dell'`Agent` tool_use (`toolUseResult.totalTokens`, `usage`); async: riga `user` con `<task-notification>…<tool-use-id>…<result>` | il parser attuale tratta la task-notification come prompt utente (bug collaterale) |

Ordine di grandezza osservato: un subagent di revisione documentale ha raggiunto un picco di contesto
nell'ordine dei 200k token restituendo al parent circa 1k caratteri: quasi tutto quel contesto è
rimasto fuori dalla conversazione principale.

### Codex

| Segnale | Dove | Note |
|---|---|---|
| Contesto usato e finestra | `event_msg/token_count` → `info.last_token_usage` (`input_tokens`, `output_tokens`) e `info.model_context_window` (258400) | `info` può essere `null` (solo rate limit) |
| Compaction | `item_completed` con `item.type:'ContextCompaction'`; righe top-level `type:'compacted'` | |
| Skill | `CommandExecution` con comando `cat …/skills/<nome>/SKILL.md`; `aggregated_output` = corpo | elenco skill disponibile in `<skills_instructions>` |
| Plugin / MCP | `item_completed` `McpToolCall` con `server`, `tool`, `pluginId`, `readOnlyHint`, `result` | |
| Subagent → parent | `session_meta.parent_thread_id`, `source.subagent.thread_spawn`, `agent_nickname`, `agent_path`, `thread_source:'subagent'`; nel parent `SubAgentActivity {agent_thread_id}` | **Codex ha subagent** (molti rollout `thread_source:'subagent'` nei log analizzati): il CLAUDE.md va corretto |
| Modello | `turn_context.model` (es. `gpt-6-astra`) | oggi `AgentState.model` è vuoto per Codex |

**Scoperta collaterale:** dai rollout di Codex ≥ 0.160 gli eventi `user_message`,
`exec_command_end`, `patch_apply_end`, `web_search_end` **non esistono più**: tutto passa per
`item_completed` (`UserMessage`, `CommandExecution`, `FileChange`, `WebSearch`, `McpToolCall`,
`SubAgentActivity`, `ContextCompaction`, …). Il parser attuale vede solo `task_complete`, quindi gli
eroi Codex restano fermi. L'aggiornamento del parser è prerequisito di questo lavoro e va fatto
mantenendo la compatibilità con il formato legacy (fixture di test 0.122).

## Obiettivi

1. Ogni eroe mostra la propria occupazione di contesto (barra + percentuale) quando la finestra è
   nota; la conversazione principale più "calda" è visibile anche nella Top Bar.
2. Ogni eroe mostra la skill attiva; il Detail Panel elenca skill e plugin usati con il costo stimato
   in token e, per i subagent, quanto contesto è stato tenuto fuori dal parent.
3. I subagent sono riconoscibili sulla mappa, nella Party Bar e nel Detail Panel, e sono collegati
   visivamente al parent.
4. Zero regressioni: provider legacy, hook `Stop`, lifecycle e test esistenti continuano a passare.

## Fuori scope (v2)

- Stima del costo fisso dei plugin nel system prompt (schemi tool, `prompt_snapshot`).
- Risparmio esatto delle skill via inventario completo su disco (vedi "Inventario skill" sotto:
  implementato in forma minima, senza leggere i marketplace remoti).
- Risultato di ritorno dei subagent Codex (`CollabAgentToolCall`): si mostra solo il picco.
- Persistenza storica: tutto resta in memoria come oggi.

## Modello dati (shared, server e client)

```ts
export interface ContextUsage {
  used: number;            // token nel contesto dopo l'ultima risposta (prompt + output)
  peak: number;            // massimo di `used` nella sessione
  window: number | null;   // finestra del modello in token, null se ignota
  windowSource: 'reported' | 'configured' | 'inferred' | 'default';
  compactions: number;     // compaction rilevate (marker esplicito o calo > 40% da > 50k)
  lastCompactionAt?: number;
  updatedAt: number;
}

export interface SkillUsage {
  name: string;            // 'superpowers:brainstorming', 'pdf'
  plugin?: string;         // 'superpowers' (da attributionPlugin o prefisso `plugin:`)
  loads: number;           // quante volte il corpo è entrato nel contesto
  loadTokens: number;      // stima token iniettati (caratteri / 4)
  attributedMessages: number;     // righe assistant attribuite (solo Claude)
  attributedOutputTokens: number; // output token di quelle righe
  firstUsedAt: number;
  lastUsedAt: number;
}

export interface PluginUsage {
  name: string;            // 'chrome-devtools-mcp', 'unified-computer-use', server MCP
  kind: 'plugin' | 'mcp';
  calls: number;
  resultTokens: number;    // stima token dei risultati entrati nel contesto
  lastUsedAt: number;
}

// Aggiunte ad AgentState
context?: ContextUsage;
skills: SkillUsage[];
plugins: PluginUsage[];
activeSkill?: string;      // skill dell'ultima riga assistant (Claude) / ultima caricata nel turno (Codex)
parentId?: string;         // id sessione del parent per i subagent
subagentType?: string;     // 'Explore', 'general-purpose', 'audit_project_docs' (Codex agent_path)
returnedTokens?: number;   // token del risultato finale rientrati nel parent (Claude)
```

Stima token: `Math.ceil(chars / 4)`, dichiarata come stima nella UI (prefisso `~`).

### Risoluzione della finestra di contesto (Claude)

1. `AGENT_QUEST_CLAUDE_CONTEXT_WINDOW` (env) → `configured`.
2. `model` contiene `[1m]` → 1.000.000 (`configured`).
3. `<configDir>/settings.json` ha `model` che termina con `[1m]` e il cui prefisso coincide con
   il modello della sessione → 1.000.000 (`configured`).
4. Altrimenti 200.000 (`default`); se `used` supera 200.000 la finestra passa a 1.000.000
   (`inferred`) e resta tale per la sessione.

Per Codex la finestra è `reported` da `token_count`/`task_started`.

## Server

### `ParsedEvent` (nuovi campi, tutti opzionali)

```ts
kind?: 'tool' | 'task' | 'telemetry';   // telemetry: non tocca status/attività/lastEvent
attribution?: { skill?: string; plugin?: string };
skillInvocations?: string[];            // Skill tool (Claude) / lettura SKILL.md (Codex)
skillLoad?: { name?: string; path?: string; chars: number };
pluginCalls?: Array<{ name: string; kind: 'plugin' | 'mcp'; toolUseId?: string; resultChars?: number }>;
toolResults?: Array<{ toolUseId: string; chars: number }>;
contextSample?: { used?: number; window?: number };
isCompaction?: boolean;
taskNotification?: { toolUseId: string; resultChars: number };
```

### Parser Claude (`session-parser.ts`)

- Riga `assistant`: estrae `attributionSkill`/`attributionPlugin`; per ogni `tool_use` `Skill`
  aggiunge `skillInvocations`; per i nomi `mcp__…` aggiunge `pluginCalls` (funzione pura
  `parsePluginTool(name)`).
- Riga `user` con `tool_result` **senza** errori (oggi scartata): evento `telemetry` con
  `toolResults` (dimensione in caratteri per `tool_use_id`).
- Riga `user` `isMeta:true` con testo che inizia per `Base directory for this skill:` → evento
  `telemetry` con `skillLoad` (path e caratteri).
- Riga `user` con contenuto stringa `<task-notification>` → evento `telemetry` con
  `taskNotification` (non più un prompt).
- `type:'system'` `subtype:'compact_boundary'` e `user.isCompactSummary` → `isCompaction`.

### Parser Codex (`codex-parser.ts`)

- Nuovo ramo `item_completed` con mapping degli item; i rami legacy restano.
- `token_count` → `telemetry` con `contextSample` e `isCompaction` quando il contesto cala.
- `task_started.model_context_window` → `contextSample.window`.
- `turn_context.model` → `telemetry` con `model`.
- `ContextCompaction` / riga `compacted` → `isCompaction`.
- `CommandExecution` con `…/skills/<nome>/SKILL.md` → `skillInvocations` + `skillLoad`
  (`aggregated_output.length`).
- `McpToolCall` → tool call `server.tool`, attività `reading` se `readOnlyHint` altrimenti `bash`,
  `pluginCalls` con `resultChars`.
- `SubAgentActivity` (started) → attività `reviewing` (Watchtower), tool call `Agent`.

### Provider

- `SessionStartPayload` guadagna `isSubagent`, `parentId`, `subagentType`, `spawnToolUseId`.
- Claude: `resolveSubagentInfo(filePath)` (evoluzione di `resolveSubagentLabel`) restituisce anche
  `parentId` (dal path), `agentType` e `toolUseId` (da `meta.json`). Il provider legge il `model`
  configurato in `<configDir>/settings.json` per il suggerimento di finestra.
- Codex: `parseCodexSessionMeta` restituisce anche `parentThreadId`, `agentNickname`,
  `agentPath`, `threadSource`; i rollout `subagent` creano eroi con `isSubagent:true` e nome =
  nickname.

### `AgentStateManager`

- `processEvent(event, meta)` con `meta: { configDir, source, nameOverride, isSubagent, parentId,
  subagentType, spawnToolUseId }` (il vecchio ordine posizionale sparisce; test aggiornati).
- La logica di lifecycle usa `agent.isSubagent` (flag) invece del solo prefisso `agent-`, così vale
  anche per Codex.
- `addUsage` aggiorna `context` (Claude); `applyTelemetry` gestisce `contextSample`, compaction,
  `skillLoad` (coda `pendingSkillLoads` alimentata dalle invocazioni, fallback sul path),
  `toolResults` (mappa `toolUseId → plugin|Agent` per agente, limitata a 500 voci),
  `taskNotification`.
- Collegamento risultato subagent: mappa `agentResultsByToolUseId`; quando arriva il risultato nel
  parent o viene creato il figlio con `spawnToolUseId`, il figlio riceve `returnedTokens`.
- `applyTelemetry` restituisce `true` solo se qualcosa di visibile è cambiato: il server fa
  broadcast soltanto in quel caso (niente raddoppio di traffico WS per i `tool_result` ordinari).

### Attività e feed

- Le righe `Skill` del feed mostrano il nome della skill; Codex emette righe `Skill` sintetiche.
- Nuova riga `Compact` quando viene rilevata una compaction.
- `categorizeEntry`: `Skill` → nuova categoria `skills` (chip nel feed header).

### Inventario skill (forma minima)

All'avvio e ogni 10 minuti il server misura i `SKILL.md` in `<configDir>/skills/*/` e
`<configDir>/plugins/cache/*/*/*/skills/*/` (Claude) e `~/.codex/skills/*/` (Codex): numero e
token stimati. Esposto nella snapshot WS come `skillInventory: { claude?: {count, tokens},
codex?: {count, tokens} }` e usato nel Detail Panel per la frase "N skill disponibili (~X token se
fossero sempre caricate) · caricate in questa sessione: M (~Y token)".

## Client

### Mappa (Phaser)

- **Barra contesto** sotto il nome dell'eroe (36×4 px): verde < 60 %, ambra < 80 %, arancio < 90 %,
  rosso ≥ 90 % con pulsazione; etichetta `ctx 62%`. Nascosta se la finestra è ignota.
- **Buff skill** sopra il nome: `✦ brainstorming` (nome breve dopo i `:`), colore teal.
- **Subagent**: sprite a scala 0,8×, etichetta nome leggermente trasparente, tag di ruolo
  `⚔ Explore` al posto del generico `subagent` (fallback `subagent`), colore dell'etichetta uguale
  a quello del parent per far leggere la "famiglia".
- **Tether**: linea tratteggiata figlio → parent nel colore del parent, ridisegnata ogni frame in un
  unico `Graphics` della scena; solo per figli vivi con parent visibile.
- **Badge comandante** sul parent: `⚑ N` con il numero di subagent vivi.
- Toggle in Settings: "Context bars" e "Subagent links" (default on), propagati via `eventBridge`.

### Party Bar

- Albero: i subagent compaiono annidati sotto il parent (indentazione + connettore `└`, tag di
  ruolo), il parent mostra `⚑ N`. I subagent orfani (parent non in lista) restano in cima al
  livello.
- Mini barra di contesto con percentuale nella riga (modalità full) e sottile sotto l'avatar
  (modalità icons).
- Chip `✦ skill` quando `activeSkill` è presente.

### Detail Panel (Live)

- **Context**: barra, `used / window (pct)`, picco, compaction, nota sull'origine della finestra.
- **Skills & Plugins**: skill attiva; elenco skill (caricamenti, ~token); elenco plugin/MCP
  (chiamate, ~token risultati); frase sull'inventario.
- **Delegation** (parent): subagent vivi/totali, somma dei picchi di contesto dei figli, token
  rientrati, "tenuti fuori da questo contesto".
- **Parent** (subagent): link al parent, ruolo, picco, token restituiti.

### Report

`computeSessionReport(agent, children)` aggiunge contesto (picco, compaction), skill, plugin e
delegation; la UI del Report mostra i blocchi solo se ci sono dati.

### Top Bar e notifiche

- Stat `Ctx` con la percentuale dell'agente principale più carico (colore per livello); click →
  seleziona l'eroe.
- Nuova categoria di notifica `context` (toast, chime riusato `error` più tenue): scatta al
  superamento dell'85 % e si riarma sotto il 70 %. Toggle "Context nearly full" in Settings.

### Documentazione

README, CLAUDE.md (Codex ha subagent; formato `item_completed`), Tutorial in-app.

## Test

- Server: parser Claude (attribution, Skill, corpo skill, tool_result, task-notification,
  compact_boundary, `parsePluginTool`), parser Codex (`item_completed`, `token_count`, modello,
  legacy), state manager (contesto e finestra inferita, compaction, skill/plugin, linkage
  subagent e `returnedTokens`, lifecycle Codex subagent), `resolveSubagentInfo`.
- Client: `sessionReport`, helper `contextLevel`/`skillShortName`, `buildPartyTree`, `transitions`
  per la soglia di contesto.

## Revisioni post-implementazione (2026-10-15)

- **Tether rimosso**: la linea tratteggiata subagent → parent confondeva la lettura della mappa; la
  gerarchia è espressa da classe (cavaliere / pedina / arciere), colore ereditato, nome in corsivo,
  tag di ruolo, badge `⚑ N` sul parent e nidificazione nella Party Bar.
- **Classi per ruolo**: i main agent sono sempre `warrior`, i subagent `pawn`, gli agenti Workflow `archer`.
- **Stat `Ctx`** della Top Bar: menu a tendina con tutti gli agenti principali vivi.
- **Pannello globale `✦ Skills & Plugins`** ed **export Markdown/JSON** per la revisione AI esterna.
