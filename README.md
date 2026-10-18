# Board viewer

A board of live, cross-origin page previews with hover and selection outlines, a lazy layers panel and an inspector. Built for the [Figr frontend assignment](https://doc.figr.design/frontend-engineer).

```
npm start
```

That installs dependencies, then runs the mock API (`:4000`), the page server (`:4001`), the agent build in watch mode, and the app at **http://localhost:5173**. Node 18+.

Other scripts: `npm run build` (agent + typecheck + app), `npm run typecheck`.

## Layout

```
backend/                 starter backend, unchanged except one <script src="agent.js" defer> per page
  pages/agent.js         built output of frontend/src/agent (committed so the backend works on its own)
frontend/
  report.js              starter error reporter, unchanged
  src/protocol/          the host <-> page contract. The only code both sides share.
  src/agent/             runs inside every preview page
    index.ts             handshake, request dispatch, mutation batching
    identity.ts          stable element ids across re-renders
    tree.ts              lazy children, search, reveal, relative navigation
    picker.ts            the Select-mode glass: hover, press, wheel, keys
    geometry.ts          streams boxes and live props of watched elements
  src/host/              the app
    controller.ts        the single writer of app state
    state/store.ts       state shape and pure transitions
    connection/          per-preview session and RPC, handshake routing
    failures/            regions, scopes, the one place report() is called
    board/  layers/  inspector/  dev/
```

## The main calls

**1. An agent inside each page, not DOM access from outside.** The pages are on another origin, so the host cannot read their DOM. Each page gets one script that owns everything that needs the DOM: hit testing, identity, tree, geometry. The host owns everything the user sees: outlines, panels, state. The two only exchange serialisable messages.

**2. A "glass" for Select mode.** In Select mode the agent puts a transparent full-viewport element above the page, attached to `<html>` (so it is not part of the layers tree). Every pointer event lands on it, so links, buttons, focus and form submission are blocked by construction rather than by cancelling each event type. Targets come from `document.elementsFromPoint`, which also returns disabled controls, SVG children and anything else that never receives events. Because the glass would only ever scroll the document, the agent routes wheel events to the scroll container actually under the pointer, which keeps the inner orders table on page 3 scrollable in Select mode.

**3. Outlines are drawn by the host in screen space.** The board is a CSS-transformed world. Outlines sit in a separate layer outside that transform, positioned from the page-reported rects multiplied by zoom. They stay 1px and 2px, labels keep their size, and each preview gets a clip box. The agent also reports the part of each element left visible after intersecting with its clipping ancestors, so an element scrolled out of an inner scroll area loses its outline but stays selected.

**4. Geometry is sampled, not inferred.** Elements move because of page scroll, inner scroll areas, layout shifts, re-renders, fonts and resizes. Instead of chasing each cause, the agent samples the few watched elements (the hover plus the selection) once per frame while something is watched, and sends only snapshots that changed. With at most a handful of elements, this costs a few `getBoundingClientRect` calls per frame.

**5. A single writer for state.** Components and agent events call into `controller.ts`, and nothing else writes the store. Cross-frame side effects (requests, `watch` and `mode` commands) are issued there too, so one file answers "what does the host tell a page, and why".

**6. Failures are scoped, not caught ad hoc.** Every region has a `RegionScope`. Handlers, timers, message callbacks and response continuations all run through it, so an error from any of them becomes the same region failure. Render errors reach the same function through an error boundary. Disposing a scope aborts its requests and drops anything that arrives later.

## State: what lives where, who may change it

| State | Where | Written by |
| --- | --- | --- |
| Screens, viewport, mode, hover, selection, active preview | `useApp` store | `controller.ts` only |
| Per-preview session, page errors | `useApp.previews[screenId]` | controller, from connection callbacks |
| Element boxes and live props | `useApp.geometry[screenId][id]` | controller, from `geometry` events |
| Layers tree cache, expanded rows, scroll position, search | `useApp.layers[screenId]` | controller; pure helpers in `store.ts` |
| Region failures | `useFailures` | `raise()` / `clearFailure()` in `failures/regions.ts` only |
| Ports, pending requests, session ids | `PreviewConnection` (not in React) | the connection itself |
| DOM element ↔ id mapping | `Identity` inside each page | the agent |
| Dev faults, API latency | `useDevFaults` | dev menu; consumed where the fault fires |

Components read with narrow selectors and never write. The layers state is keyed by preview, which gives R4.9 (switch A → B → A restores A) for free. It is dropped only when that preview's document changes or the board reloads.

Selection is `{ screenId, ids[] }` with ids in selection order, so "most recently selected" is the last id. `selectionLost` is a separate flag. It is set only when the selection empties because its elements disappeared, and it drives "This element no longer exists".

## Host ↔ page protocol

Types are in `frontend/src/protocol/messages.ts`.

**Handshake.**
1. The agent boots and posts `figr:hello { protocol, url }` to `window.parent`.
2. The host accepts it only from the pages origin and only from a registered iframe window, matched by `event.source`.
3. The host creates a `MessageChannel` and replies `figr:connect { sessionId, mode }`, transferring one port.
4. From then on all traffic uses that port. The window message channel carries nothing else.

Why a port: it is tied to the document. When the page navigates or reloads, the old port dies with the old document and the new document has to say hello again. That makes "a different document now" an explicit event (a new session) instead of something to detect.

**Requests** (answered, timed out by the host): `children`, `reveal`, `relative`, `search`, `scrollIntoView`, `ping`.
**Commands** (fire and forget): `mode`, `watch { hover, selected }`, `release`, `debug`.
**Events** (page → host): `hover`, `press`, `key`, `zoom`, `geometry`, `mutations { lists, gone }`, `pageError`, `bye`.

`watch` is a declarative subscription. The host diffs what it wants against what it last sent and pushes it whenever hover, selection or mode change. The page streams geometry only for those ids.

**When one side is slow, gone or replaced:**

- *Slow.* Every request has a timeout: 3 s for row children, 5 s otherwise, 10 s for the post-load ping. A timeout is a failure of the region that asked.
- *Gone.* The agent sends `bye` on `pagehide`, which the host treats as "reconnecting" and gives 10 s. A message posted during unload is not reliable, though. So on every iframe `load` event the host also pings the current session. A dead port never answers, which becomes "Couldn't connect to this preview" after 10 s. A page with no agent at all (404, an external site) ends up the same way.
- *Replaced.* A new hello ends the old session. Every pending request is rejected with `Cancelled`, which is not a failure: nothing is shown or reported. If the session replaced an earlier one, the document changed, so that preview's selection, hover, geometry, layers state and row loads are dropped (R3.8).
- *Host gone.* The page has nothing to clean up. Its port is garbage.

Keyboard: in Select mode the glass takes pointer events, and `mousedown` default is prevented, but the iframe can still end up with focus. The agent forwards keys in Select mode (and blocks them from the page), so shortcuts work whichever side has focus (R3.6). In Interact mode only `V` and `I` are forwarded, and never while the user is typing in a field.

## Element identity across re-renders

`agent/identity.ts`. Ids are given out lazily, only for elements the host has seen. After each mutation batch, any id whose element is disconnected is resolved again, strongest evidence first:

1. **`data-key`**: authoritative. A unique, same-tag match is the element, and no match means it is gone. We never fall back to weaker rules for keyed elements.
2. **`id` attribute**: used only with exactly one candidate.
3. Under the recursively resolved **parent**: a unique child with an identical fingerprint (tag, attributes, text).
4. The same, with **digits ignored** in text. Re-renders mostly change counters and relative times ("18s ago"), not what an element is.
5. **In-place re-render**: same child count, and every sibling lines up exactly by fingerprint, so only this slot's content changed.

Every rule requires uniqueness. A false "gone" costs the user a click, while a selection jumping to another element is a correctness bug, so ambiguity always resolves to "gone". Page 4 (the feed rebuilds every node every 2 s and inserts above) keeps keyed items, their descendants and unkeyed items selected.

The same batch produces one `mutations { lists, gone }` message. The host never sees a child list that references an id the page has already declared dead.

## How the tree loads

- Rows load children on first expand. Each row has at most one request in flight. Collapsing does not cancel it, re-expanding does not start another, and the response *replaces* the row's child list instead of appending. So there are never duplicate or missing children.
- A parent whose children the host has loaded is "observed" by the agent. After each mutation batch the agent sends the new child list of every observed parent that changed. The host replaces the list, and expanded state survives because it is keyed by stable id.
- Selecting in a preview sends one `reveal` request that returns the child lists of every ancestor, so a selection 60 levels deep on page 5 costs one round trip. It is skipped when every ancestor is already loaded.
- The list is virtualised with fixed-height rows. When rows are inserted or removed above the viewport, the first visible row is anchored, so the rows the user is looking at do not move (R4.10). Native `overflow-anchor` is off so that it doesn't double-adjust.
- Search runs in the page over the whole DOM, including rows never loaded. Each hit carries its ancestor chain, and the panel renders that as a separate view. It never touches the expanded state, so clearing the search restores it exactly.

## Failures

`failures/regions.ts` is the only caller of `report()`.

- **Regions:** `board`, `preview` (one per screen), `layers` (one per screen), `layers-row` (per row), `details` (per element key), `inspector`.
- **Exactly once:** `raise(ref, error)` records the failure and reports it. While a region is failed, further errors in it are swallowed until Retry, so a cascade inside one region is one failure. Retry disposes the scope and mounts fresh, so a retry that fails again is a new failure.
- **Not failures:** `Cancelled` and `AbortError`, raised when a selection changes during a Details request, a session is replaced, or a newer search runs.
- **Late arrivals:** a disposed scope ignores results and errors, and an unmounted Details region aborts its fetch.
- **Same handling everywhere:** render (error boundary), click, key and message handlers (`scope.wrap`), timers (`scope.setTimeout`) and responses (`scope.settle`) all reach `raise`.
- **API validation:** `/screens` and `/elements/:key` bodies are validated. A 5xx or a malformed body is a failure, and a 404 on details is "No details for this element".

The dev menu (bottom right, dev builds only) triggers each case on demand: failing `/screens`, breaking a preview's connection, throwing in a preview message handler, making the next row load time out, throwing while rendering layers or the inspector, throwing in an inspector timer, failing the next Details request, and throwing in the next key handler. It also has an API latency control. Page errors come from page 1 ("Watch demo" in Interact mode) and page 6 (a rejected promise after 4 s).

## Ambiguities and what I decided

- **Wheel over a preview vs. panning the board.** R1.4 says the wheel over a preview scrolls that page, but on a trackpad that makes the board impossible to move with two fingers once the pointer is over a page that cannot scroll (Sign up, Landing). I kept R1.4 and added the browser's own rule for nested scroll areas: the page scrolls first, and when nothing under the pointer can scroll further in that direction, the wheel chains to the board. Each gesture is latched to whichever side it started on (250 ms), so momentum running past the end of a page does not suddenly pan the board.
- **Getting lost.** A minimap (bottom left) always frames both the previews and the current view, so it still shows where you are after panning far into empty canvas. Click or drag on it to move, and use −, +, and Fit all.

- **Page errors and `report()`.** They show as a badge (R6.3) and are reported once each with `{ region: "preview", screenId }`. They do not take the preview down and have no Retry, because nothing on our side failed.
- **Keys in Interact mode.** Escape, Enter and Tab belong to the page there (forms, focus order). Only V and I reach the host, and not while typing.
- **Clicking page background** clears the selection and makes that preview active, since it was "clicked in Select mode".
- **Shift+click removing the last element** leaves an empty selection, not "This element no longer exists". That message is only for elements that vanished.
- **Selecting while searching** selects and scrolls to the hit but does not expand the underlying tree, so that clearing the search restores the expanded state exactly (R4.11). Expansion during search would contradict that.
- **Keyboard while the layers panel is focused.** Arrows belong to the panel. Enter, Tab and V/I stay global.
- **The layers panel's own failures** (root children, reveal, search) are the `layers` region. Child loads of a single row are `layers-row`.
- **Retry on a preview** reloads the iframe. The document is new, so that preview's selection clears, as with navigation.
- **A key handler failure with no preview involved** (V or I) is a `board` failure. Keys that act on a selection fail in that selection's preview region.

## Where this breaks

- **Identity heuristics can still be fooled.** If an unkeyed element is removed and, in the same batch, a sibling appears that is identical except for digits, rule 4 treats it as the same element. If a list re-renders in place with the same shape and only the selected slot's content changes, rule 5 keeps the slot. These are the cases where the selection could "jump". Duplicate `data-key`s are treated as ambiguous, so the element is reported gone.
- **Visibility ignores occlusion and some clipping.** An element under the sticky header still gets an outline drawn over the header. `clip-path`, transforms, and fixed or sticky descendants escaping a clipping ancestor are not modelled.
- **`pointer-events: none` elements** cannot be hovered on the board, because `elementsFromPoint` skips them. They are still selectable from the layers panel.
- **The top layer** (`<dialog>` opened modally, popovers) sits above the glass, so clicks there reach the page in Select mode.
- **Shadow DOM and nested iframes** inside pages are not traversed.
- **Wheel in Select mode** is reimplemented scroll chaining: no smooth scrolling or overscroll effects, and a simple Shift-to-horizontal rule.
- **Offscreen previews.** Browsers throttle `requestAnimationFrame` in offscreen cross-origin iframes, so live values for a selected element in a preview that is scrolled off the board update less often. Scroll, resize and mutation events still push updates.
- **Search** is capped at 3,000 hits, and the result says so.
- **Performance.** All 24 iframes stay live. Unloading previews outside the viewport is the obvious next step.

## With another week

- Unload or snapshot previews outside the viewport, and keep a pool of live ones.
- Replace per-frame sampling with `ResizeObserver` + `IntersectionObserver` + scroll listeners, using rAF only as a fallback, and measure the difference.
- Model occlusion: when an outline is covered, show it dashed.
- Property-based tests for identity: generate random re-renders of a tree, then assert that a selection never resolves to a node with a different logical identity.
- Playwright tests for each R-item, plus contract tests for the protocol with a fake agent.

## Prior art

- **Chrome DevTools' element picker:** hit testing with `elementsFromPoint` over a transparent overlay, and a hover box with a name label.
- **Figma:** selection versus hover colours, labels that flip below when there's no room, and outlines that keep the same width at any zoom because they are drawn outside the zoomed content.
- **React's reconciliation:** the identity rules borrow its idea of "key first, then type and position". The difference is that a keyless position match is accepted only when it cannot be a different item.
