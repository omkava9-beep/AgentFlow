# Plan: Workflow Templates

**Spec:** [`spec/15-workflow-templates.md`](../spec/15-workflow-templates.md)
**Depends on:** `04-workflow-persistence`

## Backend Tasks

- [ ] `models/Template.js` — Mongoose schema (`ownerId` nullable, `name`, `description`, `nodes[]`, `edges[]`, `createdAt`)
- [ ] `GET /api/templates` — user's own templates + built-in (`ownerId: null`) seed templates
- [ ] `POST /api/templates` — snapshot an existing workflow (`{ workflowId, name, description }`) into a new independent `Template` doc
- [ ] `POST /api/templates/:id/use` — clone template's `nodes`/`edges` into a brand-new `Workflow` doc owned by `req.userId`
- [ ] Seed script (`scripts/seedTemplates.js`, run once manually or on first boot) — inserts 1–2 built-in templates (e.g. "Summarize & Notify") with `ownerId: null`

## Frontend Tasks

- [ ] Dashboard: "New from template" option opening a template gallery (cards: name, description)
- [ ] Builder: "Save as template" action — prompts for name/description, calls `POST /api/templates`
- [ ] Template gallery → "Use template" flow → creates and navigates into the new workflow

## Verification

- [ ] Saving a workflow as a template, then using it, produces a new independently-editable workflow with the same graph
- [ ] Built-in seed templates are visible to every user without manual creation
- [ ] Editing a workflow created from a template never modifies the original template
- [ ] Using a template referencing a since-removed tool type surfaces the existing "unknown tool type" warning (`03`) instead of crashing
