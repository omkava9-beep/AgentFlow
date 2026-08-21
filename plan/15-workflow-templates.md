# Plan: Workflow Templates

**Spec:** [`spec/15-workflow-templates.md`](../spec/15-workflow-templates.md)
**Depends on:** `04-workflow-persistence`

> **Status: complete.** Verified by `npm run check:templates` (27 checks across two users:
> snapshot decoupling, clone independence, ownership boundaries, and the removed-tool-type
> edge case) plus 17 browser checks (gallery, Use template → new workflow, Save as template
> dialog, and the saved template appearing under "Your templates").
>
> `src/scripts/seedTemplates.js` finally exists — `package.json` had referenced it since
> phase 1. It seeds three built-ins and upserts by name, so re-running updates a built-in's
> graph instead of duplicating it. One of them ("Conditional Retry Demo") is deliberately
> built to demo the engine: 60% failure rate, 5 attempts, and a condition branch.
>
> Two notes now in `spec/15`: "Save as template" is disabled while the graph is dirty (a
> template snapshots the *saved* graph), and cloning re-runs the cycle check because
> `POST /:id/use` creates a Workflow directly, bypassing the PUT guard from `19`.

## Backend Tasks

- [x] `models/Template.js` — Mongoose schema (`ownerId` nullable, `name`, `description`, `nodes[]`, `edges[]`, `createdAt`)
- [x] `GET /api/templates` — user's own templates + built-in (`ownerId: null`) seed templates
- [x] `POST /api/templates` — snapshot an existing workflow (`{ workflowId, name, description }`) into a new independent `Template` doc
- [x] `POST /api/templates/:id/use` — clone template's `nodes`/`edges` into a brand-new `Workflow` doc owned by `req.userId`
- [x] Seed script (`scripts/seedTemplates.js`, run once manually or on first boot) — inserts 1–2 built-in templates (e.g. "Summarize & Notify") with `ownerId: null`

## Frontend Tasks

- [x] Dashboard: "New from template" option opening a template gallery (cards: name, description)
- [x] Builder: "Save as template" action — prompts for name/description, calls `POST /api/templates`
- [x] Template gallery → "Use template" flow → creates and navigates into the new workflow

## Verification

- [x] Saving a workflow as a template, then using it, produces a new independently-editable workflow with the same graph
- [x] Built-in seed templates are visible to every user without manual creation
- [x] Editing a workflow created from a template never modifies the original template
- [x] Using a template referencing a since-removed tool type surfaces the existing "unknown tool type" warning (`03`) instead of crashing
