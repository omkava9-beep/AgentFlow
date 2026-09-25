# AgentFlow UI kit

The design system every page builds on. Import from `components/ui` (the
barrel, `ui/index.js`); older pages still import `Button`/`Card`/`TextField`/…
from `components/ui.jsx`, which is a thin facade over this kit.

## Rules

1. **Semantic token classes only.** Never raw hex, and never `slate-*`/`indigo-*`
   /`brand-*` in pages. Use `bg-bg`, `bg-bg-subtle`, `bg-surface`,
   `bg-surface-raised`, `bg-surface-sunken`, `text-fg`, `text-muted`,
   `text-subtle`, `border-default` (or plain `border`), `border-strong`,
   `bg-accent`/`text-accent`/`bg-accent-subtle`/`text-accent-subtle-fg`, and the
   status families `success | warning | danger | info` (`-subtle`, `-subtle-fg`).
   Dark mode is automatic: the tokens flip under `.dark`. Opacity modifiers work
   (`bg-accent/10`).
2. **Icons are lucide** (`lucide-react`). No emoji in UI chrome. Size 16px
   (`h-4 w-4`) in buttons and rows, 14px (`h-3.5 w-3.5`) in dense controls.
   Integrations use `<IntegrationLogo id=…>`; node types use `<NodeTypeIcon type=…>`.
3. **Statuses go through `<StatusBadge status=…>`** (or `<StatusIcon>` in dense
   rows). One mapping (`statusMeta.js`) covers pending, queued, running, waiting,
   success, failed, cancelled, skipped, handled, interrupted.
4. **Every page starts with `<PageHeader>`**: title, optional description, icon,
   breadcrumbs, meta badges, actions, and a tabs slot.
5. **Lists are `<DataTable>`**, not hand-rolled `<table>`s or stacks of cards,
   unless the content is genuinely visual (template gallery, integration grid).
6. **Empty and loading states**: `<EmptyState icon={LucideIcon} …>` and the
   `Skeleton*` components — never bare "Loading…" text.
7. **Modals are `<Dialog>`**, side panels `<Drawer>`, confirmations `confirm()`.
8. Numbers use `tabular-nums`; ids, code and JSON use `font-mono`.

## Tokens (src/index.css)

| Token | Use |
|---|---|
| `--bg` / `--bg-subtle` | App background / hovered rows, sunken strips, sidebar |
| `--surface` / `-raised` / `-sunken` | Cards & panels / popovers & dialogs / inputs & code |
| `--border` / `--border-strong` | Hairlines / hover and emphasis |
| `--text` / `--text-muted` / `--text-subtle` | Primary / secondary / tertiary text |
| `--accent` (+ `-hover`, `-fg`, `-subtle`, `-subtle-fg`) | Indigo; primary actions, selection, links |
| `--success` `--warning` `--danger` `--info` (+ `-subtle`, `-subtle-fg`) | Status |
| `--ring` | Focus ring (`:focus-visible` everywhere) |
| `--topbar-h` (48px), `--sidebar-w` (240px) | Shell metrics |

Radius: `rounded-control` 6px (buttons, inputs), `rounded-card` 10px (cards,
panels, menus), `rounded-dialog` 12px. Shadows: flat cards have none (1px
border); `shadow-sm` for raised controls; `shadow-popover` for menus, popovers,
dialogs. Type: Inter Variable at a 14px root; JetBrains Mono for code.
Motion: `animate-fade-in`, `animate-pop-in`, `animate-slide-in-right`.

## Components

| Component | API |
|---|---|
| `Button` | `variant: primary \| secondary \| ghost \| danger \| danger-ghost \| link`, `size: xs \| sm \| md \| lg`, `icon`, `iconRight`, `loading` |
| `IconButton` | `icon`, `label` (required: tooltip + aria-label), `variant`, `size`, `active` |
| `Field` | `label`, `help`, `error`, `required`, `htmlFor`, `trailing` — wraps a control |
| `Input` / `Textarea` / `Select` | Styled controls; `size="sm"`; `invalid` |
| `Checkbox` / `Switch` | `label`, `description`; `Switch` is controlled (`checked`, `onChange(bool)`) |
| `Badge` | `tone: neutral \| accent \| success \| warning \| danger \| info`, `dot`, `icon`, `size: xs \| sm` |
| `StatusBadge` / `StatusIcon` | `status`, optional `label` |
| `Card`, `CardHeader`, `CardBody`, `Section` | `Card padded interactive`; `CardHeader title description icon actions` |
| `PageHeader` | `title description icon breadcrumbs=[{label,to}] meta actions tabs` |
| `Tabs` / `Segmented` | `items=[{value,label,icon,count}]` + `value/onChange`, or `items=[{to,label}]` for route tabs |
| `DataTable` | `columns=[{key,header,cell,sortable,sortValue,align,width}]`, `rows`, `onRowClick`, `loading`, `empty` (EmptyState props or node), `dense`, `footer` |
| `Tooltip` | `content`, `side`; wraps one element |
| `Avatar` / `AvatarStack` | `name email seed size color` / `people max` |
| `Kbd` | Keyboard hint |
| `StatTile` | `label value hint delta invertDelta icon` + children for a sparkline |
| `Dialog` | `open onClose title description icon footer size: sm \| md \| lg \| xl` |
| `Drawer` | `open onClose title description actions width footer` |
| `CopyButton` | `value`, optional `label` for a text button |
| `Toolbar`, `ToolbarGroup`, `ToolbarDivider` | Control rows and joined groups |
| `IntegrationLogo` | `id` (integration id or manifest icon), `size: xs…xl` |
| `NodeTypeIcon` | `type`, `size`, `tile` |
| `EmptyState` | `icon` (lucide component), `title body action secondaryAction compact` |
| `Skeleton`, `SkeletonCard`, `SkeletonGrid`, `SkeletonTable` | Loading placeholders |
| `Menu`, `MenuLink`, `MenuButton`, `MenuSeparator`, `MenuHeading` | Dropdowns; items accept a leading lucide icon as their first child; `align`, `up` |
| `confirm()` | Promise-based confirmation (`title body confirmLabel destructive typeToConfirm`) |

## App shell

`components/Layout.jsx`: a 240px left sidebar (collapsible to a 64px rail,
remembered per browser) with the workspace switcher, Build / Operate / Connect
sections, Settings and Status, and the user menu; a 48px top bar with
breadcrumbs, the ⌘K search trigger, theme toggle and notifications. The
Builder and Run Monitor are full-bleed (they size to
`calc(100vh - var(--topbar-h))`); every other page renders inside a centred
`max-w-6xl` column with `px-6 py-8`, so pages shouldn't add their own outer
padding.
