# TopBar Mobile Drawer — Design Spec

**Date:** 2026-04-29
**Scope:** `client/src/components/TopBar.tsx` + `TopBar.css`
**Status:** approved

## Goal

Make the dashboard's top bar usable on narrow viewports (smartphones, narrow desktop windows) by collapsing all secondary controls into a hamburger-triggered dropdown drawer. Desktop behavior at ≥ 900px is unchanged.

## Why a drawer (option B)

Three options were considered: compact mode with shrunk inline elements (A), drawer/menu (B), two-row stack (C). The user picked B because it keeps the bar minimal at-a-glance while giving the menu enough room for full labels and bigger touch targets, with no risk of horizontal overflow.

## Breakpoint

`max-width: 900px`. Chosen because the desktop layout (logo ~80px + 5–6 stats with verbose labels + 4 effect buttons + gaps) realistically needs ~700–800px to render on one row without overlapping. 900px gives margin and also catches narrow desktop windows.

## Behavior

### Compact bar (drawer closed, < 900px)

- **Logo**: shrinks from 68px to 40px tall, `position: static` so it flows in the bar instead of overflowing above.
- **Status dot**: 8×8px circle next to the logo. Green `#2E8B57` when `connected === true`, red `#8B2500` otherwise. Replaces the verbose `Status: Online / Offline` text on mobile. `aria-label` and `title` carry the textual state.
- **Hamburger button**: 32×32px touch target on the right edge. Three CSS-drawn lines that morph into an `×` when open.
- Every other element (stats, effect buttons) is hidden from the bar itself and lives only inside the drawer.

### Drawer open (< 900px, `data-menu-open="true"`)

- Anchored to the bottom edge of the topbar (`top: 100%; left: 0; right: 0`).
- Same dark background as the bar (`rgba(26, 26, 46, 0.95)`) with a gold bottom border to match the topbar border.
- Vertical layout: stats list (one per row, label on the left, value on the right, 8px vertical padding for touch comfort) followed by a row of effect buttons.
- **Editor link is hidden on mobile** — opens a new tab to `?mode=editor`, useless on a touch device.
- Animation: `transform: translateY(-8px) → 0` + `opacity: 0 → 1`, 180ms ease-out. Disabled under `prefers-reduced-motion: reduce`.
- Tapping an effect button (night/rain/tutorial) does **not** close the drawer — the user can toggle effects in sequence without reopening.
- Tapping outside the drawer closes it.
- Pressing **ESC** closes it and returns focus to the hamburger.

### Desktop (≥ 900px)

Unchanged from current implementation. The `data-menu-open` attribute is ignored by desktop CSS rules. Status dot and hamburger are `display: none`.

## Architecture

Single `TopBar` component, single DOM tree. The same `<div class="topbar-tools">` container holds stats and effects; CSS flips it from inline-flex (desktop) to absolute-positioned dropdown (mobile).

```
<header class="topbar" data-menu-open={open}>
  <Logo />                    ← always visible
  <StatusDot />               ← mobile only (display: none ≥ 900px)
  <div class="topbar-tools">  ← inline at desktop, dropdown at mobile
    <Stats />
    <Effects />
  </div>
  <HamburgerButton />         ← mobile only (display: none ≥ 900px)
</header>
```

**No markup duplication.** Stats and effects are rendered once. The visual repositioning is entirely CSS.

### React state

Only one new piece of state: `menuOpen: boolean`. The existing `nightOn`/`rainOn` are unchanged.

The component sets `data-menu-open` on the `<header>` based on `menuOpen`. The hamburger button toggles it.

### Effects

- **ESC handler** (`useEffect`): when `menuOpen` is true, listen for `keydown` Escape; on hit, close and refocus hamburger.
- **Resize handler** (`useEffect` + `matchMedia('(min-width: 900px)')`): if the breakpoint switches from mobile to desktop while the drawer is open, force `menuOpen = false` so the desktop view doesn't carry a parasitic `data-menu-open="true"` attribute.

### Click-outside

Implemented via a transparent overlay element rendered as a sibling of the topbar header when `menuOpen` is true: `<div class="topbar-overlay" onClick={close} />`. The overlay covers the viewport area **below** the topbar (`position: fixed; top: 40px; left: 0; right: 0; bottom: 0`) at a z-index lower than the drawer but higher than the rest of the UI, so taps on the drawer still work, taps on the topbar (hamburger included) still work, and taps anywhere else close the drawer. The overlay only exists in the DOM while the drawer is open.

## CSS strategy

Single `@media (max-width: 900px)` block in `TopBar.css`. Default rules describe desktop (current behavior, mostly unchanged). The media query overrides for mobile.

Key rules (illustrative):

```css
/* defaults: status dot and hamburger hidden */
.topbar-status-dot { display: none; }
.topbar-menu-toggle { display: none; }

@media (max-width: 900px) {
  .topbar { justify-content: space-between; padding: 0 8px; }
  .topbar-logo { height: 40px; }
  .topbar-logo-button { position: static; }
  .topbar-status-dot, .topbar-menu-toggle { display: inline-flex; }

  .topbar-tools {
    position: absolute; top: 100%; left: 0; right: 0;
    flex-direction: column; gap: 0;
    padding: 12px 16px;
    background: rgba(26, 26, 46, 0.95);
    border-bottom: 1px solid rgba(196, 163, 90, 0.4);
    transform: translateY(-8px); opacity: 0; pointer-events: none;
    transition: transform 180ms ease-out, opacity 180ms ease-out;
  }
  .topbar[data-menu-open="true"] .topbar-tools {
    transform: translateY(0); opacity: 1; pointer-events: auto;
  }

  .topbar-stat { justify-content: space-between; padding: 8px 0; }
  .topbar-effects { border-left: none; padding-left: 0; margin-left: 0; }
  .topbar-effect-btn[data-mobile-hide="true"] { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .topbar-tools { transition: none; }
}
```

`pointer-events: none` on the closed drawer prevents click leakage onto hidden buttons. The editor link gets `data-mobile-hide="true"` so the CSS can hide it without coupling to hex content.

`:active` styles are added to all interactive buttons (`scale(0.96)` + warmer background) so touch users get visual feedback that `:hover` doesn't provide.

## Accessibility

- Hamburger: `aria-expanded={menuOpen}`, `aria-controls="topbar-tools"`, `aria-label` toggles between `"Open menu"` and `"Close menu"`.
- Drawer: `id="topbar-tools"`, `role="region"`, `aria-label="Topbar menu"`.
- Status dot: `role="status"`, `aria-label="Online"` / `"Offline"`.
- ESC closes drawer and returns focus to the hamburger.
- All interactive elements are keyboard-reachable (no focus traps needed for a 6-element drawer).

## Edge cases handled

- **Resize past breakpoint with drawer open** → `matchMedia` listener forces `menuOpen = false`.
- **Click on effect button inside drawer** → drawer stays open (intentional, see Behavior).
- **`overflow: hidden` on `.app-container`** → drawer extends inside the viewport (top: 40px, not above), so clipping does not occur. Verified in `client/src/App.css:5`.
- **Reduced motion** → drawer opens/closes instantly under `prefers-reduced-motion: reduce`.
- **Hover-only feedback on touch** → all buttons get `:active` styles.

## Out of scope

- Changes to other panels (PartyBar, ActivityFeed, DetailPanel, Minimap) — they will need their own mobile passes later.
- Replacing the editor link with a mobile-friendly alternative — for now it's just hidden under 900px.
- Restyling stats with icons — kept textual labels for clarity inside the drawer.

## Files touched

- `client/src/components/TopBar.tsx` — markup + state additions
- `client/src/components/TopBar.css` — media query, status dot, hamburger, drawer styles, `:active` states

No other files require changes. `App.css` was reviewed and confirmed compatible.
