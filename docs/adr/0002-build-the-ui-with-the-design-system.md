# 0002. Build the UI with the design system (Meridian)

Status: accepted

## Context

The design system is project 5 and was built first so the other projects can use it. Atlas AI needs forms,
dialogs, menus, alerts, badges, avatars, skeletons and toasts now, and will need a chat surface, a data table and
a command palette later.

## Decision

Atlas installs `@yashwanthvarma74/react` and `@yashwanthvarma74/tokens` from npm (0.2.0) and builds every screen
from them. The app's own CSS Modules read only the library's `--mrd-*` variables, so they define no colours,
sizes or durations of their own, and there is no custom skin: the library's graphite look is the look. Light,
dark and high contrast come from its `data-theme` tokens.

Two things follow from how the package is built:

- **Per-component imports.** Components come from `@yashwanthvarma74/react/components/<Name>`, which the package
  exports for exactly this. Importing from the package root pulls every component, and the menu library behind two
  of them, into the first load. Pulse measured the difference (279 kB against 174 kB gzipped for its home route).
  Atlas starts with the cheap import so the budget has room later.
- **Own theme provider.** The package does not export its theme module on its own, so
  `apps/web/src/lib/theme.tsx` does the same job in about 80 lines under the same storage key. It defaults to the
  system setting instead of dark.

## Known problems in the package

Reported from this project, not worked around in the library's code:

- Every form control inside a `FormField` logs React's "non-boolean attribute `invalid`" warning in development.
  `useFieldProps` in `utils/fieldContext.ts` returns an `invalid` property next to `aria-invalid`, and `Input`,
  `Select` and `Textarea` spread the whole object onto the DOM element. Dropping `invalid` from the returned object
  fixes it, since `aria-invalid` already carries the meaning. Pulse hit the same warning with `Textarea`.
- A `./theme` export would remove the copied provider above.

## Consequences

- A token or component fix reaches Atlas with a package update, and Dependabot proposes it weekly.
- The package is not marked `"use client"`, so every file that imports a component is itself a client component.
  Pages stay thin server components that render one client component.
- A component Atlas needs that the library lacks is added to the library first, then consumed.

## Alternatives

- **Tailwind or a one-off component set.** Faster to start, and it would throw away the point of project 5.
- **The package root import.** Simplest to write. Costs the first-load budget.
