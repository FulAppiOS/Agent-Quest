# 에셋 테마

<p>
  <a href="themes.md">English</a> · <strong>한국어</strong>
</p>

Agent Quest는 **테마**를 바탕으로 영웅을 그립니다. 테마는 Phaser가 어떤 PNG를
미리 로드하고 어떻게 애니메이션할지 알려 주는 매니페스트입니다. 테마는
데이터 기반이므로 새 팩으로 바꾸려면 `client/public/assets/themes/<theme-id>/`에
파일을 넣고 매니페스트를 등록하기만 하면 됩니다.

## 활성 테마

| Id | 표시 이름 | 라이선스 | 위치 | 배포 방식 |
|---|---|---|---|---|
| `tiny-swords-cc0` | Tiny Swords (CC0) | CC0 1.0 Universal (Pixel Frog) | `client/public/assets/themes/tiny-swords-cc0/` | **저장소에 번들** — 사용자가 따로 설정할 것이 없습니다. |

테마는 완전히 자체 완결적입니다. 외부 다운로드도, 설정 스크립트도 없습니다.
BootScene에 필요한 모든 것이 `tiny-swords-cc0` 하위 트리에 들어 있습니다.

### CC0 대체 규칙

CC0 팩은 Agent Quest의 5×4 영웅 격자보다 변형이 적습니다.

| 없는 것 | 대체 | 구현 위치 |
|---|---|---|
| Monk (유닛) | 같은 색상의 Warrior | `tiny-swords-cc0.ts`의 `resolveUnit(unit)` |
| Black (색상) | 같은 유닛의 Purple | `resolveColor(color)` |

둘을 합치면 `(monk, black)`은 `(warrior, purple)`로 해석됩니다.
`getHeroPreload()`는 해석된 쌍을 기준으로 중복을 제거하므로 같은 텍스처가
두 번 등록되지 않습니다.

### 프레임 레이아웃

`(color, unit)`마다 PNG 하나인 통합 시트이며, 프레임은 192px, 행 = 애니메이션,
열 = 프레임입니다.

| 유닛 | 시트 | 격자 | Idle 인덱스 | Walk 인덱스 |
|---|---|---|---|---|
| Warrior | `Warrior_{Color}.png` | 6×8 | `[0..5]` | `[6..11]` |
| Pawn    | `Pawn_{Color}.png`    | 6×6 | `[0..5]` | `[6..11]` |
| Archer  | `Archer_{Color}.png`  | 8×7 | `[0..5]` | `[8..13]` (1행 — 전용 걷기 없음, 2~6행은 사격) |

원본 파일명의 오타는 그대로 유지합니다: `Archer/Purple/Archer_Purlple.png`.

## 매니페스트 인터페이스

`client/src/game/themes/types.ts`에 정의되어 있습니다.

```ts
interface ThemeManifest {
  id: ThemeId;
  name: string;
  heroScale: number;
  getHeroPreload(): PreloadEntry[];
  getHeroConfig(color, unit): HeroSpriteConfig;
  getHeroPreview(color, unit): HeroPreview;
  terrain?: TerrainConfig;
  getBuildingImage(id: string): string;
  getBuildingScale?(id: string): number | undefined;
  getStaticAssetPreload(): StaticAssetEntry[];
  postLoadHook?(scene: Phaser.Scene): void;
}
```

## 스케일 재조정

MapConfig는 `settings.heroScale`과 NPC별 `scale`을 `heroScale: 0.5` 기준선에
맞춰 작성된 절대값으로 저장합니다. `rebaseSavedScale`은 지금은(테마가 하나뿐이라)
값을 그대로 돌려주지만, 나중에 기본 크기가 다른 테마가 들어와도 저장된 맵을
모두 마이그레이션하지 않고 그냥 동작하도록 자리를 지키고 있습니다.

## 새 테마 추가하기

1. 팩을 `client/public/assets/themes/<theme-id>/`에 넣습니다.
2. `ThemeManifest`를 내보내는 `client/src/game/themes/<theme-id>.ts`를 만듭니다.
3. `client/src/game/themes/registry.ts`(`THEMES` 맵)에 등록합니다.
   `client/src/game/themes/types.ts`와 `server/src/map/types.ts`의 `ThemeId`를
   현재의 단일 리터럴에서 유니언으로 넓힙니다
   (예: `'tiny-swords-cc0' | '<new-id>'`).
4. 런타임에 테마를 고를 수 있게 하려면 `TopBar.tsx`에 선택 UI를 연결합니다.

## CC0 — 건물과 활동 매핑

기능 건물은 `client/public/assets/themes/tiny-swords-cc0/BuildingsCustom/`에 있는
사용자 제작 커스텀 아트를 씁니다. 활동마다 전용 PNG가 하나씩 있습니다.
경로와 건물별 스케일은 `tiny-swords-cc0.ts:CC0_BUILDINGS`를 참고하세요.

| 활동       | 건물 id      | PNG                         |
|---|---|---|
| thinking   | castle       | `BuildingsCustom/Castle.png`    |
| reviewing  | watchtower   | `BuildingsCustom/Tower.png`     |
| bash       | arena        | `BuildingsCustom/Arena.png`     |
| reading    | library      | `BuildingsCustom/Library.png`   |
| editing    | forge        | `BuildingsCustom/Forge.png`     |
| idle       | tavern       | `BuildingsCustom/Tavern.png`    |
| git        | chapel       | `BuildingsCustom/Chapel.png`    |
| debugging  | alchemist    | `BuildingsCustom/Alchemist.png` |

## 2단계 미해결 과제

- **활동별 VFX**: CC0 팩에 Fire + Explosion 시트가 들어 있지만 장면에는 활동별
  VFX 훅이 없습니다.
- **UI 9-slice**: React 패널은 CSS로 그리므로 테마 적용은 별도의 외관 작업입니다.
- **Archer 걷기 사이클**: CC0 궁수에는 전용 걷기 행이 없어 idle을 재사용합니다.
- **고블린 부대**(Barrel / TNT / Torch): 현재 게임 모드에서는 쓰이지 않습니다.
