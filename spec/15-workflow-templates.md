# Spec: Workflow Templates

**Status:** Stretch
**Milestone:** M3
**Depends on:** `04-workflow-persistence.md`

## Summary

Reusable saved workflow shapes a user can clone into a new, independent workflow — useful both as a demo-friendly "starter examples" feature and as a way to avoid rebuilding similar graphs from scratch.

## Goals

- Save any existing workflow "as a template" (snapshot of its nodes/edges, decoupled from the original).
- Browse available templates (the user's own, plus a small set of built-in seed templates shipped with the app for demo purposes, e.g. "Summarize & Notify").
- "Use template" creates a new, independent Workflow doc pre-populated from the template's graph.

## Non-goals

- Public template marketplace / sharing between users.
- Keeping a live link between a template and workflows created from it (cloning is a one-time copy, not a reference).

## Data Model

**Template**
```
{
  _id,
  ownerId: ObjectId | null,   // null for built-in seed templates
  name: string,
  description: string,
  nodes: [...],               // same shape as Workflow.nodes
  edges: [...],
  createdAt: Date
}
```

## Non-goals (continued)

- **Deleting a template.** Not in the API below, so the gallery is add-only for now. Worth adding later; called out here so its absence reads as scope, not oversight.

## API

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/templates` | — | list (user's own + built-in, `ownerId: null`) |
| POST | `/api/templates` | `{ workflowId, name, description }` | new Template doc (snapshot of that workflow) |
| POST | `/api/templates/:id/use` | `{ workflowName }` | new Workflow doc cloned from the template |

## UI Behavior

- Dashboard has a "New from template" option alongside "New Workflow," opening a template gallery (cards with name/description, maybe a small graph thumbnail).
- Workflow Builder has a "Save as template" action, **disabled while the graph is dirty** — a template snapshots the last *saved* version, so offering it on unsaved edits would quietly capture something other than what's on screen.
- Templates get their own page at `/templates` (the nav item phase 1 left disabled), with built-ins and the user's own templates in separate sections. The Dashboard's "New from template" links there rather than duplicating the gallery.

## Edge Cases & Error Handling

- Cloning a template whose node config references a tool type that's since been removed from the registry (`05`) — surface the same "unknown tool type" warning `03` already defines, don't crash.
- Cloning also re-checks for cycles. `POST /:id/use` creates a `Workflow` directly, bypassing the `PUT` route's guard from `19`, so a template stored before that validation existed could otherwise reintroduce one.
- A template owned by another user 404s on both read and use; built-ins (`ownerId: null`) are usable by everyone. Snapshots are deep-copied on both save and clone, so a template and its clones never share nested config objects.

## Acceptance Criteria

- [ ] Saving a workflow as a template and then using that template produces a new, independently editable workflow with the same graph.
- [ ] Built-in seed templates are visible to every user without needing to be created manually.
- [ ] Editing a workflow created from a template never modifies the original template.
