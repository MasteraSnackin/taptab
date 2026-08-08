# TapTab Design Lead Review

> **Historical checkpoint:** this report records the 6 August visual pass. See
> [docs/MARKDOWN_TASK_COMPLETION.md](docs/MARKDOWN_TASK_COMPLETION.md) for the
> later task-first live layout, host checklist and five-profile browser gate.

**Status:** Complete — visual-only refactor
**Reviewed:** 6 August 2026
**Scope:** Main dashboard, responsive states and stage mode

## Outcome

TapTab now has a clearer product hierarchy, more legible working surfaces and a
more deliberate presentation mode while retaining its existing cream, violet,
mint and receipt-led identity. The change is restricted to presentation:
contract behaviour, application state, wallet flows, APIs and infrastructure
were not changed.

The dashboard keeps its modular bento composition, but the controls now read as
one system rather than a collection of equally prominent panels. Glass effects
are limited to navigation and control surfaces; receipt and data content remain
on solid paper-like cards. This follows Apple's current guidance to use glass as
a distinct functional layer rather than throughout the content layer:
[Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines)
and [Materials](https://developer.apple.com/design/human-interface-guidelines/materials).

## Baseline findings

The visual audit covered the sample bill, the unconfigured Testnet state and
stage mode at 320×568, 375×812, 812×900 and 1280×720.

The principal issues were:

- Most dashboard copy was 11px or smaller, including meaningful labels,
  transaction status and form help.
- The active workspace, guided-demo control and current payment action competed
  for primary emphasis.
- White text on the violet rate card and low-opacity text in stage mode did not
  provide dependable contrast.
- Tablet controls remained 34–42px high because the 44px touch treatment began
  only below 680px.
- The bill heading and actions cramped into one row at tablet widths.
- Stage mode changed to a tall single-column layout too early and became
  unnecessarily scroll-heavy at 812px.
- Disabled claim chips faded participant ownership information as well as the
  unavailable action.
- Two rendered recovery/action containers had no matching layout styles, and a
  create-bill selector referred to a class that does not exist.
- The dense grid texture, tight hero tracking and numerous competing shadows
  added visual noise.

## Refactor delivered

### Visual system

- Consolidated the muted colour into the primary token set.
- Added semantic panel, radius, elevation, danger and motion tokens.
- Standardised the main card family on calmer radii and a shared soft shadow.
- Applied restrained translucent surfaces and backdrop blur to the feature rail,
  workspace switcher, command bar and disclosure controls.
- Reduced the workspace grid opacity so it supports rather than competes with
  the bill.
- Preserved solid content cards, visible borders and the existing receipt edge.

### Hierarchy and composition

- Relaxed the hero's extreme tracking and line height without losing its
  editorial character.
- Reduced hero and feature-rail spacing so the product is reached sooner.
- Made the selected workspace a violet-tinted state instead of another black
  primary action.
- Demoted Guided Demo to a light outlined control, leaving the current bill
  action as the strongest call to action.
- Kept the existing bento layout and receipt/control relationship intact.

### Legibility and contrast

- Raised core desktop controls, form fields, supporting copy and status text.
- Made tablet and mobile explanatory notices 12px with a 1.45 line height.
- Increased initials and ownership labels without enlarging their surrounding
  chips excessively.
- Replaced low-contrast sample participant colours with darker coral and amber
  values that support white initials.
- Replaced the receipt-row danger foreground with a darker semantic danger
  colour.
- Raised meaningful dark-surface text opacity and made the violet rate-card copy
  use the pale-violet foreground.
- Preserved strong visible focus indicators and the existing reduced-motion
  behaviour.

### Responsive interaction

- Moved the stacked bill heading and full-width action treatment to the 880px
  breakpoint.
- Extended 44px controls and 16px form inputs through tablet widths.
- Added 44px hit areas to the brand and footer links at compact widths.
- Removed the mobile action dock's unintended in-flow gap while retaining safe
  bottom clearance.
- Preserved zero document-level horizontal overflow at every checked width.

The 44px compact target deliberately exceeds WCAG 2.2's 24px AA minimum and
matches its enhanced target-size criterion for frequently used controls:
[W3C target size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced).

### Stage mode

- Widened the desktop join panel from a 270px minimum to 320px.
- Retained a two-column tablet layout, with the activity feed spanning both
  columns, down to 721px.
- Restored a single-column narrow layout below 721px.
- Increased status, activity and secondary labels to presentation-legible sizes.
- Reduced the narrow header to 65px, fixed the brand mark at 34px, retained a
  44px Exit control and removed the redundant preview pill below 430px.

### Missing visual hooks corrected

- Corrected the host-chain selector to target `.create-bill-card`.
- Added layout and control styling for `.live-transaction-actions`.
- Added wrapping recovery actions for uncertain bill-creation transactions.
- Defined the previously missing `--ink-soft` token.

## Motion decision

Framer Motion was not added. The interface did not need a new animation runtime
to solve the identified problems, and adding one solely for visual decoration
would expand the dependency and testing surface. Existing native transitions use
the shared timing tokens and remain covered by the global
`prefers-reduced-motion` rule. This keeps the design brief's prohibition on
functional and infrastructure changes intact.

## Files changed

- `app/globals.css` — tokens, hierarchy, legibility, contrast, responsive and
  stage-mode presentation.
- `app/TapTabApp.tsx` — two sample participant colours only; no component logic
  or behaviour changed.
- `PLAN.md` — records completion of the responsive design-lead pass.

## Verification

| Check | Result |
| --- | --- |
| Production Vinext build | Passed |
| ESLint | Passed |
| TypeScript `--noEmit` | Passed |
| Web and server tests | 185 passed |
| Playwright browser tests | 24 passed across desktop, tablet and mobile |
| Contract tests | 61 passed |
| Desktop browser, 1280×720 | No horizontal overflow; three-column stage fits without internal scrolling |
| Tablet browser, 812×900 | 44px wallet, workspace, claim and stage controls; two-column stage fits without internal scrolling |
| Mobile browser, 375×812 | No horizontal overflow; 16px fields; 44px controls; narrow stage content remains in bounds |
| Browser console and page diagnostics | No errors, warnings, page errors or failed requests |
| `git diff --check` | Passed |

## Remaining design work

- The stylesheet still contains legacy repeated selectors and fragmented
  breakpoints. A full consolidation was deliberately deferred because it would
  make this visual-only task much broader and risk regressions.
- This is not a completed WCAG audit. Keyboard, screen-reader, 200% zoom and
  physical-device testing remain release gates in `PLAN.md`.
- Responsive screenshots were inspected during the task but are not checked into
  the repository as a visual-regression suite.
- The unconfigured Testnet panel still exposes technical environment names. A
  friendlier empty state would require component-content changes and belongs in
  the Builder task, not this design-only lane.
