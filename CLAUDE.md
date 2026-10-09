# Pinball Dreams

Physics pinball for the PickBits arcade. Live at **https://pinballdreams.pickbits.ai**.

## Build & run

There is **no build system** — no `package.json`, no bundler, no dev server, no ES modules. It is a static site of plain `<script>` tags and globals.

- Run it: open `index.html`, or `python -m http.server 8777` and hit `http://localhost:8777/index.html`.
- Matter.js 0.19 comes from cdnjs; Three.js is vendored in `assets/vendor/three/`.
- Boundary/layout regression tests: `node scripts/check-board-boundaries.mjs` and
  `node scripts/check-climb-autoplay.mjs`.

## Layout

| Path | What |
|---|---|
| `index.html` | **The whole game.** CSS, DOM, and a single inline `<script>` holding every system. |
| `src/pinball-templates.js` | **Every table's layout, as editable data.** One entry per table on a 400×700 grid. Hand-edit it and reload — this is where board changes go. |
| `editor.html` | Standalone visual editor for those templates. Drag parts, save a localStorage preview, or download a replacement `pinball-templates.js`. |
| `src/pinball-progress.js` | `PinballCareer` (lifetime stats) + `PinballAchievements` (catalog, unlock seam, toast). Local-first. |
| `src/pickbits.js` | `PickBitsClient` — the PickBits SSO bridge (auth, leaderboard, cloud saves). |
| `src/neon-pinball-3d.js` | Optional Three.js renderer layered over the Canvas2D playfield. Purely visual, holds no game state. |
| `src/pinball-board-reference.js` | The 24-table research library and five procedural layout profiles used to add lanes, ramps, guides, spinners, and resetting banks. |
| `src/pinball-layout.js` | Shared mirrored flipper geometry, Climb floor-boundary resolution, and launch scaling. Also loaded by the boundary regression test. |
| `scripts/check-board-boundaries.mjs` | Deterministic geometry and high-velocity Climb boundary sweep. |
| `scripts/check-climb-autoplay.mjs` | Simulates all 20 Climb floors, including sealed overshoots and two-sided rail guards. |
| `assets/3d/` | `neon-pinball-kit.glb` is the only file loaded at runtime. The `.blend`, per-part `.glb`s, `roblox/*.fbx` and preview are build inputs — see `manifest.json` and `scripts/blender/`. |

**Load order matters.** Both `src/` modules are script-tagged immediately *before* the inline game script and expose globals it calls into. Adding a module means inserting it in that same block, not in `<head>`.

## Editing a table

Board layout is **data, not code**. To move a bumper, a wall or a target, edit
`src/pinball-templates.js` and reload — there is no build step.

- Coordinates are a **400×700 grid**; sizes (`r`, `w`, `h`, `thickness`) are real
  pixels. The rails sit at `x=20` and `x=350`, and the playfield centre — what
  the flipper end mirrors about — is **`x=185`, not 200**, because the shooter
  lane eats the right edge of the canvas.
- `buildTemplate()` in `index.html` is the **only** place a part becomes a body.
  Adding a part type is one `case` there plus one line in the template.
- `lower` (the flipper end: return guide, slingshot, flipper pivot, outlane width)
  is authored **left-side only** and mirrored by `PinballLayout.lowerAssembly()`, so
  the two sides can't drift apart. The outlane's outer wall is *derived* from
  `returnGuide`, so moving the guide keeps the outlane the right width.
- The **flipper blade is not template data.** `lower.flipperPivot` places the
  pivot; `PinballLayout.flipperGeometry()` sizes the blade off the board width and
  grows it inboard from there. Leaving the blade at a fixed pixel size while the
  scaled pivots moved apart is what opened the centre drain to five ball widths
  and sent almost every ball down the middle — `check-board-boundaries.mjs` now
  fails if that gap leaves the 2–3.2 ball range.
- `editor.html` edits the same data visually. **Save preview** writes
  `pinballDreamsTemplateOverrides` in localStorage, which `resolveTemplate()`
  layers over the file — so a saved edit silently wins over your source changes
  until you hit **Revert table** / **Clear all saved**. **Download .js** emits a
  drop-in replacement for `src/pinball-templates.js`.
- `node scripts/check-board-boundaries.mjs` validates every template: unknown
  part types, missing keys, parts dragged off the grid, a closed outlane, a
  guide tip that lets the inlane feed fall past the flipper, and broken mirroring.

## Key systems (all in `index.html`)

- `gameState` — score, balls, flags. `CONFIG` — dimensions, ball/flipper physics.
- `LEVELS` — 7 tables, each with `theme`, `zone` (`fire`/`ice`/`rock`) and a `mission` (`{action, goal, reward, instruction}`).
- `climbMode` — the 20-floor ascent. Floors spawn lazily via `spawnClimbBoard(floor)`, rotating `CLIMB_BOARDS`. Breaking a `floor-panel` ceiling tile spawns the next floor; breaking floor 20's ceiling completes the run.
- **Elemental seals** (`climbFloorGate`) — every climb floor's ceiling is locked to its board's `zone` element. Work that floor's task (a halved version of the board's mission) to break the seal, which also *hands you* that element; the ceiling then only shatters while that power is live (`canBreachFloor`). If it lapses first, `respawnSealCapsule()` drops a guaranteed re-arm so the task never has to be redone. Gates advance from inside `advanceMission()` — one seam, so mission and seal actions can't drift apart.
- **Board mastery** is a PickBits perk: anonymous runs re-earn every seal, signed-in players start mastered boards pre-unsealed (`climbBoardMastered`). Mastery is still *recorded* while anonymous, so signing in later pays it out retroactively.
- `powerSystem` — timed `fire`/`ice`/`rock` ball powers from `rollPowerCapsule()` → `activatePower()`. `powerScoreMultiplier(action)` maps each power to the actions it boosts.
- `missionSystem` — light 3 lanes → shoot the ramp → complete the board's mission.
- **Plunger menu** — the title screen is a zoomed playfield section: each option is a staggered falling-card target and the ball stays parked above the pulled-back spring. Keyboard, mouse and touch all funnel through `launchMenu()`, and `menuActions` is the single map of what each option does. Completion is owned by `setTimeout`, not `requestAnimationFrame`, so a backgrounded tab can't strand the menu mid-launch.
- **Browser automation** — `?automation=climb` runs the real gate, breach, spawn, boundary, and completion seams for all 20 floors and writes a PASS/FAIL report to `#automation-report`.
- `loseBall()` — **the single drain seam.** All three drain paths (sensor, out-of-bounds, fallback) funnel through it. Put per-ball logic here, not in the collision handler.
- Screens are DOM overlays toggled by `display`. Any new overlay must be added to the hide-lists in `showTitleScreen()`, `showLevelSelect()`, `startGame()` **and** `endGame()`, or it bleeds across screens.

## PickBits SSO — the 3-place contract

Game slug is **`pinball`**. Wiring only works when three places agree, and two of them are outside this repo:

1. **Here** — `src/pickbits.js` emits `submitScore` / `saveProgress` / `unlockAchievement`.
2. **Supabase** (`vbfwzpztnvfktydozgir`, `achievements` table) — rows must be **pre-seeded** with `game_slug='pinball'`. **`unlockAchievement` silently no-ops for slugs that don't exist there.** The `ACHIEVEMENTS` array in `src/pinball-progress.js` is a 1:1 contract with those rows: local id `foo` → slug `pinball-foo`. Adding one here without seeding it does nothing for signed-in players.
3. **pickbits.ai** — `arcade.html` (`connected:true`) and `dashboard-redesign.js` (`saveDetail()` branch for `pinball`, which reads whatever you nest under `save_data.summary`).

Playbook: `C:\new\pickbits.ai\.claude\skills\arcade-sso-wiring.skill\SKILL.md`. Vanilla-JS reference: `C:\new\pickbits-games\games\steel-phoenix\js\pickbits.js`.

### Testing sign-in
Auth activates **only** on a `*.pickbits.ai` origin — the edge functions enforce that CORS allowlist. Append **`?pb=1`** to force-activate locally; the SDK loads and the anonymous UI works, but the token exchange still needs the real origin. Everything must degrade silently: guard every call with `typeof PickBitsClient !== 'undefined'`, `.catch(() => {})` every promise, and always write to localStorage first so the game is whole signed-out.

## Persistence

`pinballDreamsCareer_v1`, `pinballDreamsAchievements_v1`, `pinballDreamsCustomLevel`, `pinballDreamsSettings_v1` — all four are mirrored to PickBits cloud saves by a debounced `localStorage.setItem` intercept in `src/pickbits.js`. `pinballDreamsHighScore` is the legacy key, kept in sync by `PinballCareer.save()` because the HUD still reads it.

On login the bridge **merges** cloud into local (max of bests, union of sets, earliest achievement timestamps) — never clobbers — then fires `pickbits:cloud_hydrated` so the game re-reads.

## Gotchas

- `endGame()` clears `climbMode.active` — read the climb floor *before* that line.
- A hidden browser tab freezes CSS transitions at `currentTime: 0` and stops `requestAnimationFrame`, so the achievement toast looks stuck and rAF-driven animation never advances under headless/automated checks. Not a bug; call `el.getAnimations().forEach(a => a.finish())` to step past a transition. **Never make state changes depend on a rAF callback firing** — drive visuals with rAF, but own completion with timers.
- PostHog is configured `person_profiles: 'identified_only'`; `src/pickbits.js` supplies the `identify()` on sign-in.
