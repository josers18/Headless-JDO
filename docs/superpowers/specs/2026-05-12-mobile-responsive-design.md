# Mobile Responsive — Design Spec

**Date:** 2026-05-12
**Owner:** Jose
**Status:** Draft (pending live demo approval)
**PR scope:** layout + chrome only — no agent / MCP / prompt changes

---

## 1. Problem

Horizon was built desktop-first for the DAX contest demo. Mobile mostly works
visually but has two structural blockers and a tail of small chrome bugs:

1. **`/analyze` and `/ask` are dead-end pages on mobile.** Their workspace
   shells (`AnalyzeWorkspace.tsx:16`, `AskWorkspace.tsx:25`) hide the model
   list / thread list sidebars below `lg` (1024 px), and the empty-state copy
   on `/analyze` literally instructs the user to *"select a model from the
   sidebar"* that isn't in the DOM.
2. **The desktop `LeftRail` reserves 64 px of horizontal space at every
   viewport.** `app/(banker)/layout.tsx:25` hardcodes `pl-16`, so a 375 px
   iPhone loses 17 % of viewport width before content starts.
3. **Tail of small chrome bugs** in headers / drawers / overlays that need
   triage at real device widths.

## 2. Goals

- Banker on a 375 px iPhone can pick a semantic data model on `/analyze`.
- Banker on the same device can switch threads on `/ask`.
- Full viewport width is used for content on phones (no 64 px desktop-rail
  gutter).
- Section navigation (`Today` ↔ `Ask` ↔ `Analyze`) is reachable by tap on
  mobile, replacing the keyboard-shortcut-only `LeftRail`.
- **Zero visual diff at ≥ `lg` (1024 px).** Desktop demo, the contest-submitted
  surface, must look identical.

## 3. Non-Goals

- No new agent loops, prompts, or MCP tool changes.
- No new dependencies (no `framer-motion`, no `radix` drawer — CSS transitions
  + the existing `cn` utility are enough).
- No refactor of working desktop layouts (`PortfolioPulse`, `PulseStrip`,
  `ClientDetailSheet`, `TodaysArc` are already mobile-friendly and out of
  scope).
- `AskWorkspace`'s right `ContextRail` stays `xl:block` — it's a desktop
  power-user surface and not mobile-essential.

## 4. Approved Decisions

| Question                              | Decision                                                |
| ------------------------------------- | ------------------------------------------------------- |
| Mobile model picker pattern           | Slide-in drawer from the left                           |
| Desktop `LeftRail` fate on mobile     | Hide `<lg`; reuse the existing `MobileNav` floating pill |
| Mobile breakpoint                     | `<lg` (1024 px) — phones + iPad portrait                |
| Sweep depth                           | Targeted sweep — fix high-confidence issues, log the tail |
| Target devices                        | iPhone Pro (390/393), iPhone SE / Android (375/360), iPad portrait (768/820) |
| `ContextRail` mobile fate             | Stays hidden below `xl` (no second drawer)              |
| Scroll-to buttons in `MobileNav`      | Removed — section nav (Today/Ask/Analyze) replaces them |

## 5. Architecture

One reusable primitive, three thin integration points, one chrome change.

```
app/(banker)/layout.tsx
  ├── LeftRail (desktop: hidden lg:flex)
  ├── MobileNav (mobile: lg:hidden)  ◄── now globally mounted
  └── <children>
        ├── /                          (home — already mobile-friendly)
        ├── /ask                       AskWorkspace + MobileDrawer<ThreadList />
        └── /analyze                   AnalyzeWorkspace + MobileDrawer<ModelList />

components/horizon/mobile/
  ├── MobileNav.tsx                   (extended)
  └── MobileDrawer.tsx                (NEW)
```

### 5.1 `<MobileDrawer>` primitive

New file `components/horizon/mobile/MobileDrawer.tsx`. Single shared component;
both `/analyze` and `/ask` mount it with their existing list components as
children — no duplication of focus-trap / esc / scroll-lock logic.

Responsibilities:

- Render nothing at `>= lg`. Above the breakpoint the consuming workspace
  renders its desktop `<aside>` directly; the drawer is purely a mobile concern.
- Slide in from the left, ~ 320–360 px wide on phones, full-height.
- Backdrop: `fixed inset-0 bg-black/60 backdrop-blur-[4px]`, matching
  `ClientDetailSheet`'s visual language.
- Close on: backdrop tap, `Esc` key, programmatic `onClose`.
- `body` scroll-lock while open. Inert / `aria-hidden` on background DOM.
- Focus trap: focus the drawer panel on open; on close, return focus to the
  trigger button.
- Animation: matches `animate-fade-rise` / `animate-fade-in` patterns already
  in `globals.css`. No new keyframes.
- Safe-area aware: respects `env(safe-area-inset-left)` so the drawer sits
  flush on notched devices.

API:

```tsx
<MobileDrawer
  open={open}
  onClose={() => setOpen(false)}
  ariaLabel="Browse semantic models"
>
  <ModelList onSelect={() => setOpen(false)} />
</MobileDrawer>
```

`onSelect` is the optional close-after-pick hook the existing list components
need. `ModelList` and `ThreadList` get a thin pass-through prop added — both
already navigate via `<a href>`, so we wrap or fire `onSelect` on click before
navigation.

### 5.2 `MobileNav` extension

`components/horizon/mobile/MobileNav.tsx` becomes a section-aware nav pill.

- Three buttons: `Today` (`Home`), `Ask My Data` (`MessageSquare`), `Analyze`
  (`BarChart3`) — same icons / labels as `LeftRail` for visual continuity.
- Active state read from `usePathname` exactly like `LeftRail`.
- Disabled state for Ask / Analyze when signed-out, mirroring `LeftRail`.
- Keyboard shortcuts (`⌘1` / `⌘2` / `⌘3`) **stay on `LeftRail`** — they're
  desktop-only by design (no software keyboard). No change needed.
- Existing `bottom: calc(5.75rem + env(safe-area-inset-bottom, 0px))` — keeps
  it sitting above the AskBar.
- Drop the two scroll-to-section buttons (`LayoutGrid`, `Radio`). Section nav
  is more valuable on mobile and 5 icons in one pill cramps at 360 px.

### 5.3 `(banker)` layout chrome swap

`app/(banker)/layout.tsx`:

- `LeftRail` wrapped to render only at `lg+`. The rail is `position: fixed`,
  so a wrapper `div className="hidden lg:contents"` keeps the rail's own
  positioning intact while gating render.
- `pl-16` becomes `lg:pl-16`.
- Mount `<MobileNav signedIn={signedIn} />` here (was previously inside
  `HorizonSignedIn`, only on `/`). This lets `/ask` and `/analyze` get section
  nav too.
- Remove `<MobileNav />` from `HorizonSignedIn.tsx` to avoid double-mount.
  Hide-when-signed-out behavior moves into `MobileNav` itself by accepting a
  `signedIn` prop and rendering disabled buttons (matches `LeftRail`).

### 5.4 Workspace integrations

**`AnalyzeWorkspace.tsx`:**

- Existing desktop `<aside>` (`hidden lg:block`) — unchanged.
- Add a `<lg`-only client component `AnalyzeMobileSidebar` that renders:
  - A "Browse models" trigger button at the top of the main column.
  - A `<MobileDrawer>` hosting `<ModelList onSelect={close} />`.
- Boundary: workspace stays a server component; the trigger + drawer are a
  small client component sibling at the top of the main column.

**`AskWorkspace.tsx`:**

- Same pattern. Trigger label "Threads". Drawer hosts `<ThreadList onSelect={close} />`.
- Right rail (`<ContextRail />`) stays `xl:block` — out of scope.

**`AnalyzeEntry.tsx`:**

- Replace the dead-end "Pick a model to explore … select a semantic data
  model from the sidebar" copy. New copy on mobile: "Pick a model to explore"
  with a primary "Browse models" call-to-action that opens the drawer (the
  trigger is rendered by `AnalyzeMobileSidebar` so the entry copy itself just
  needs to stop referring to a non-existent sidebar).

### 5.5 Targeted sweep — known issues

Confirmed during exploration; fix in this PR:

| # | File / surface                              | Issue                                                                             | Fix                                                                       |
| - | ------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1 | `app/(banker)/layout.tsx:25`                | `pl-16` always-on eats 17 % of phone viewport                                     | `lg:pl-16` (5.3)                                                          |
| 2 | `AnalyzeWorkspace.tsx:16`                   | `ModelList` hidden below `lg` with no alternative                                 | Mobile drawer (5.4)                                                       |
| 3 | `AskWorkspace.tsx:25`                       | `ThreadList` hidden below `lg` with no alternative                                | Mobile drawer (5.4)                                                       |
| 4 | `AnalyzeEntry.tsx`                          | Empty-state copy points to non-existent sidebar                                   | Reword + trigger (5.4)                                                    |
| 5 | `MobileNav.tsx`                             | 2 scroll-only buttons; no section nav on mobile                                   | Section icons (5.2)                                                       |
| 6 | `HorizonSignedIn.tsx`                       | `MobileNav` only mounts on `/`                                                    | Move mount to `(banker)/layout.tsx` (5.3)                                 |

Sweep methodology — find the rest:

1. `npm run dev` + sign in.
2. Open Chrome DevTools MCP, walk these viewports: 360 × 800, 375 × 667,
   390 × 844, 393 × 852, 768 × 1024, 820 × 1180.
3. For each, walk: `/`, `/ask`, `/ask/[threadId]`, `/analyze`,
   `/analyze/[modelId]`, ClientDetailSheet (open from PriorityQueue), AskBar
   focus + response panel, voice mic, all four PullToRefresh-eligible
   sections.
4. Log each issue with viewport + screenshot. Fix high-confidence
   layout/chrome bugs. Park anything ambiguous in a triage list at the end of
   the PR description.

### 5.6 Architectural invariants (kept)

- All three CLAUDE.md anti-patterns hold: no new framework, no inline MCP
  logic, no spinners-vs-streaming regression.
- Streaming-first endpoints — none touched.
- The reasoning trail / `tool_use` SSE event payloads — none touched.
- Tailwind-only styling, no styled-components / CSS modules.
- `noUncheckedIndexedAccess` strict — preserved.

## 6. Components & Data Flow

```
┌──────────────────────────── viewport ─────────────────────────────┐
│                                                                   │
│  ┌─────┐                                                          │
│  │  ✕  │  backdrop ────────────────────── open: setOpen(false) ──►│
│  ├─────┴─────────────┐                                            │
│  │ Drawer (≤ lg)     │                                            │
│  │                   │                                            │
│  │ <ModelList />     │                                            │
│  │  ↳ onSelect() ────┼──► <a href="/analyze/[id]"> click          │
│  │                   │     ↳ MobileDrawer.close()                 │
│  │                   │     ↳ Next.js navigation                   │
│  └───────────────────┘                                            │
│                                                                   │
│  ┌─ MobileNav (≤ lg) ──────────────┐                              │
│  │  Today  Ask  Analyze            │                              │
│  └─────────────────────────────────┘                              │
└───────────────────────────────────────────────────────────────────┘
```

No new data flow — drawer state is local React state in the small client
component that mounts each drawer (`AnalyzeMobileSidebar`,
`AskMobileSidebar`). The lists themselves remain pure.

## 7. Error Handling

The drawer is pure UI — there are no new error paths. Existing error states
(`ModelList` `unauth` / `error` / `empty` branches; `ThreadList` equivalents)
render inside the drawer unchanged.

If the drawer is open and the network 401s on `/api/analyze-models`, the
existing "Sign in to see available semantic models" message renders inside the
drawer. The user can dismiss the drawer via Esc, backdrop, or the close
button.

## 8. Testing

- **Manual at all six target viewports** per §5.5 sweep methodology.
- `npm run verify:mcp` and `npm run smoke:api` must stay green — none of the
  changed code touches the agent loop, but these gate any layout regression
  that breaks SSE.
- `next build` + `eslint .` clean.
- Spot-check at `lg` (1024 px) and `xl` (1280 px) that desktop layout is
  unchanged. The drawer should not render at all.

## 9. Success Criteria

1. ✅ On `/analyze` at 375 × 667 (signed in): a "Browse models" button is
   visible; tapping it opens a left-anchored drawer; the drawer contains a
   searchable model list; tapping a model navigates to `/analyze/[modelId]`
   and the drawer closes.
2. ✅ On `/ask` at 375 × 667 (signed in): same pattern with threads.
3. ✅ On `/` at 375 × 667: the home page uses the full viewport width (no
   64 px LeftRail gutter); `MobileNav` shows three section icons.
4. ✅ On `/` at 1280 × 800: zero visual diff vs. `main`.
5. ✅ Keyboard shortcuts ⌘1 / ⌘2 / ⌘3 still work on desktop.
6. ✅ No regression on `verify:mcp` or `smoke:api`.
7. ✅ Drawer is dismissable by: backdrop tap, Esc key, close button.
8. ✅ Tail issues from §5.5 sweep are either fixed in this PR or documented
   in the PR description for future triage.

## 10. Open Questions / Risks

- **`SectionRail` positioning** (the dotted progress rail at `left-20` in
  `components/horizon/SectionRail.tsx:126`) is `xl:block` — only renders at
  ≥ 1280 px, where the LeftRail is back. No conflict with the rail-hide
  change. Confirm during sweep.
- **`MobileNav` z-index vs. AskBar response panel** — `MobileNav` is `z-30`,
  AskBar response panel is `z-40`. When the AskBar panel is open, MobileNav
  should sit *under* it, which is what we want. Confirm during sweep.
- **iPad portrait UX** — at 768 px the same drawer pattern applies; verify the
  drawer width feels right (probably bump from ~320 to ~360 on `md`).

---

*Spec stops here. Implementation plan to follow once approved.*
