# Agent Quest — Design Spec

Dashboard di monitoring per agenti Claude Code, stile villaggio fantasy World of Warcraft. Browser-based, 2D top-down, con personaggi che si muovono tra edifici in base all'attività degli agenti.

## Stack Tecnologica

| Layer | Tecnologia | Ruolo |
|---|---|---|
| Game engine | Phaser 4 "Caladan" | Villaggio 2D, tilemap, sprite animati, pathfinding |
| UI overlay | React 19 + TypeScript | Pannelli informativi sovrapposti al canvas |
| Bundler | Vite | Dev server e build |
| Server runtime | Bun | Runtime nativo TypeScript, WebSocket integrato, file watcher integrato |
| Server framework | Hono | HTTP framework leggero, TypeScript-first |
| Tilemap editor | Tiled | Creazione mappa del villaggio (export JSON) |
| Sprite creation | PixelLab (Leonardo.ai) | Generazione AI di sprite pixel-art con stile coerente |
| Sprite editing | Aseprite | Ritocco e animazione sprite |
| React-Phaser bridge | Ref-based (pattern ufficiale Phaser 4) | useRef + useEffect + EventEmitter |

## Il Villaggio

Mappa top-down pixel-art (~40x30 tiles, 32x32px per tile). Creata con Tiled, esportata in JSON per Phaser.

### Edifici

Ogni edificio rappresenta un tipo di attività dell'agente Claude Code:

| Edificio | Attività agente | Tool calls mappate | Animazione |
|---|---|---|---|
| Biblioteca | Lettura/ricerca codice | `Read`, `Grep`, `Glob` | Sfoglia libro, particelle di polvere |
| Fucina | Scrittura/editing codice | `Edit`, `Write` | Martella incudine, scintille arancioni |
| Torre del Mago | AI thinking/ragionamento | Testo lungo, `thinking` | Medita in aria, aura viola/blu |
| Arena | Esecuzione comandi/test | `Bash` | Combatte golem; test pass → golem esplode; test fail → golem colpisce eroe |
| Taverna | Idle/attesa input utente | Nessuna attività | Seduto al tavolo, beve da boccale |
| Cappella | Commit/push Git | `git commit`, `git push` | Cerimonia di luce, codice "ascende" |
| Bottega Alchimista | Debug/fix errori | Fix dopo errori | Mescola pozioni, fumo verde |
| Torre di Guardia | Code review/verifica | Agent subagent, review | Osserva con cannocchiale |

### Personaggi

- Ogni agente Claude Code = un eroe con classe fantasy unica
- Classi disponibili: Guerriero, Mago, Ranger, Paladino, Ladro, Druido, Monaco, Stregone, Bardo, Cavaliere, Sciamano, Necromante, Templare, Cacciatore, Chierico (15 classi per supportare fino a 15 agenti)
- Assegnazione ciclica per distinguerli visivamente
- Sprite 32x32 con animazioni: idle (4 frame), walk 4 direzioni (4 frame), action per edificio (4-6 frame)
- Sopra la testa: nome agente + barra progresso task
- Generati con **PixelLab** per stile coerente, ritoccati con **Aseprite**

### Movimento e Transizioni

- Cambio attività → il personaggio cammina verso il nuovo edificio (pathfinding A*)
- Se stessa attività nello stesso edificio → resta ma cambia animazione
- Nuovo agente → appare alla porta del villaggio con effetto teletrasporto
- Sessione completata → fanfara, il personaggio alza la spada al cielo

### Effetti Speciali

| Evento | Effetto |
|---|---|
| Test superato | Fuochi d'artificio sopra l'Arena |
| Errore/crash | Fulmine rosso sull'edificio, personaggio barcolla |
| Sessione completata | Fanfara, personaggio alza spada |
| Token elevati | Aura dorata crescente (più token = aura più grande) |
| Nuovo agente | Teletrasporto alla porta del villaggio |

## Pannelli UI React (Overlay)

Il canvas Phaser occupa tutto lo schermo. I pannelli React sono sovrapposti con trasparenza, stile UI da MMO.

### Layout

```
┌─────────────────────────────────────────────────────┐
│  [Party Bar - sinistra]          [Minimap - alto dx] │
│  ┌──────────────┐                ┌────────┐          │
│  │ Eroe Agent-1 │                │ mappa  │          │
│  │ ██████░░ 75% │                │ piccola│          │
│  │ Eroe Agent-2 │                └────────┘          │
│  │ ████░░░░ 50% │                                    │
│  │ Eroe Agent-3 │      [VILLAGGIO PHASER]            │
│  │ ██████████100│                                    │
│  │ ...          │                                    │
│  └──────────────┘                                    │
│                                                      │
│  ┌──────────────────────────────────────────────────┐│
│  │ [Activity Feed - basso]                          ││
│  │ 14:32:01 Agent-1 → Edit src/api.ts:42            ││
│  │ 14:32:03 Agent-2 → Bash: npm test (running...)   ││
│  └──────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

### Pannelli

| Pannello | Posizione | Contenuto |
|---|---|---|
| Party Bar | Sinistra | Lista agenti: icona classe, nome, barra HP (progresso), stato, token. Click per selezionare |
| Minimap | Alto destra | Villaggio in miniatura, puntini colorati per agente |
| Activity Feed | Basso | Log real-time di tutti gli agenti: timestamp, nome, azione, file/comando. Scrollabile, filtrabile |
| Detail Panel | Click su agente, si apre a destra | Stats complete: token in/out, costo, durata, tool calls, diff codice, errori, file toccati. Stile "character sheet" WoW |
| Top Bar | Alto centro | Costo totale, agenti attivi/idle/completati, uptime |

### Stile Visivo Pannelli

- Bordi decorativi: frame in pietra/legno (9-slice sprite)
- Font titoli: "MedievalSharp" o "Cinzel" (Google Fonts)
- Font log/codice: monospace
- Palette: oro (#C4A35A), pergamena (#F5E6C8), pietra scura (#2A2A3D), rosso sangue (#8B2500), verde smeraldo (#2E8B57)
- Icone pixel-art per ogni tipo di azione nel feed

## Server Backend

Server Bun locale su `localhost:3333`. Hono come framework HTTP.

### Fonti Dati (doppio canale)

1. **File Watcher** (`Bun.watch()`) — monitora `~/.claude/projects/` per file JSONL. Polling ogni 1-2 secondi. Cattura stato completo delle sessioni
2. **Claude Code Hooks** (opzionale) — hook `postToolUse` manda POST al server. Latenza quasi zero per real-time vero

### Data Flow

```
~/.claude/ (JSONL)  ──→  Bun.watch()   ──→  Session Parser  ──→  Agent State
Claude Code Hooks   ──→  Hono endpoint ──→  Event Processor ──→  Agent State
                                                                      │
                                                                      ▼
                                                              Bun WebSocket Server
                                                                      │
                                                                      ▼
                                                              Browser (React + Phaser)
```

### Agent State Model

```typescript
interface AgentState {
  id: string;
  name: string;
  heroClass: HeroClass;
  status: 'active' | 'idle' | 'completed' | 'error';
  currentActivity: 'reading' | 'editing' | 'thinking' | 'bash' | 'idle' | 'git' | 'debugging' | 'reviewing';
  currentFile?: string;
  currentCommand?: string;
  tokenUsage: { input: number; output: number; cacheRead: number };
  cost: number;
  sessionDuration: number;
  toolCalls: ToolCall[];
  errors: string[];
  filesModified: string[];
  lastEvent: number; // timestamp
}

type HeroClass = 'warrior' | 'mage' | 'ranger' | 'paladin' | 'rogue' | 'druid' | 'monk' | 'warlock' | 'bard' | 'knight' | 'shaman' | 'necromancer' | 'templar' | 'hunter' | 'cleric';
```

### WebSocket Events

| Evento | Payload | Descrizione |
|---|---|---|
| `agent:update` | `AgentState` | Cambio stato/attività |
| `agent:new` | `AgentState` | Nuovo agente rilevato |
| `agent:complete` | `{ id, summary }` | Sessione terminata |
| `activity:log` | `{ agentId, action, detail, timestamp }` | Nuova azione per il feed |

## Struttura Progetto

```
agent-quest/
├── client/                    # Frontend React + Phaser 4
│   ├── src/
│   │   ├── game/              # Phaser scenes, entities, config
│   │   │   ├── scenes/        # VillageScene, BootScene
│   │   │   ├── entities/      # HeroSprite, Building
│   │   │   ├── systems/       # PathfindingSystem, AnimationSystem
│   │   │   └── config.ts      # Game config, costanti
│   │   ├── components/        # React overlay panels
│   │   │   ├── PartyBar.tsx
│   │   │   ├── ActivityFeed.tsx
│   │   │   ├── DetailPanel.tsx
│   │   │   ├── Minimap.tsx
│   │   │   └── TopBar.tsx
│   │   ├── hooks/             # useWebSocket, useAgentState
│   │   ├── types/             # AgentState, GameEvent, etc.
│   │   ├── App.tsx            # Shell: Phaser canvas + React overlay
│   │   └── main.tsx
│   ├── public/
│   │   └── assets/            # Tileset, spritesheet, audio
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
├── server/                    # Backend Bun + Hono
│   ├── src/
│   │   ├── watchers/          # FileWatcher (Bun.watch)
│   │   ├── parsers/           # SessionParser (JSONL → AgentState)
│   │   ├── state/             # AgentStateManager
│   │   ├── ws/                # WebSocket server (Bun nativo)
│   │   ├── hooks/             # Hono endpoint per Claude Code hooks
│   │   └── index.ts
│   ├── tsconfig.json
│   └── package.json
├── assets-source/             # File Tiled (.tmx), sprite originali, file PixelLab
├── package.json               # Script root: bun start avvia tutto
└── README.md
```

## Comandi

```bash
cd agent-quest
bun start              # Avvia server + client (concurrently)
bun run dev:client     # Solo frontend su localhost:5174
bun run dev:server     # Solo server su localhost:3333
```

## Asset Pipeline

### Generazione Sprite con PixelLab

1. **Personaggi (15 classi)**: generare con PixelLab ogni classe fantasy in stile pixel-art 32x32 coerente. Per ogni classe servono:
   - Spritesheet idle (4 frame)
   - Spritesheet walk 4 direzioni (4 frame ciascuna = 16 frame)
   - Spritesheet action per edificio (4-6 frame)
   - Consistenza stilistica tra tutte le classi (stesso stile, palette, proporzioni)

2. **Edifici (8)**: generare ogni edificio come tile 3x3 o 4x4 (96x96 o 128x128 px). Stile coerente col villaggio.

3. **Tileset terreno**: erba, strade in pietra, acqua, ponti. 32x32 per tile.

4. **UI elements**: bordi pannelli, barre HP, icone azioni. Stile fantasy pixel-art.

### Pipeline
1. Generare base con **PixelLab** (stile coerente, prompt engineering per uniformità)
2. Ritoccare e animare in **Aseprite** (cleanup, frame animation, spritesheet export)
3. Assemblare tilemap in **Tiled** (posizionare edifici, terreno, decorazioni)
4. Esportare in JSON per Phaser 4
5. Packing spritesheet con **TexturePacker** o Aseprite export

### Asset list completa

| Asset | Tipo | Dimensione | Frame | Note |
|---|---|---|---|---|
| 15 classi eroe | Spritesheet | 32x32 | idle(4) + walk(16) + action(6) = 26 frame | Generati con PixelLab |
| 8 edifici | Tile composto | 96x96 o 128x128 | Statico + animazione ambientale (2-4 frame) | Fucina: fumo, Torre: luce pulsante |
| Tileset terreno | Tileset | 32x32 per tile | Statico | Erba, pietra, acqua, bordi |
| Decorazioni | Sprite vari | 32x32 | Statico o 2-4 frame | Alberi, fiori, fontana, insegne |
| UI borders | 9-slice | Variabile | Statico | Cornici pietra/legno per pannelli |
| Icone azioni | Sprite | 16x16 | Statico | Libro, martello, spada, pozione, ecc. |
| Effetti VFX | Spritesheet | 32x32 o 64x64 | 6-8 frame | Fuochi artificio, fulmine, teletrasporto, aura |

## Audio (opzionale)

- Musica ambient fantasy di sottofondo (loop)
- Effetti sonori: incudine (edit), page turn (read), esplosione (test fail), fanfara (completamento)
