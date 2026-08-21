# AgentFlow: Phase 2 Internship Report

**AI Agent Orchestration & Workflow Automation Platform (MERN Stack)**

Four-week development phase

---

## Submission details

> To be filled in before submission.

| Field | Detail |
|---|---|
| Student name | _________________________ |
| Roll / enrolment number | _________________________ |
| Course & semester | _________________________ |
| College / department | _________________________ |
| Internship organisation | _________________________ |
| Industry mentor | _________________________ |
| Faculty guide | _________________________ |
| Reporting period | Four weeks (Phase 2) |
| Date of submission | _________________________ |

---

## Contents

1. Abstract
2. Introduction
3. What Phase 2 set out to do
4. Technology stack and constraints
5. How I worked
6. Week 1: the execution engine
7. Week 2: the builder, and agent handoff
8. Week 3: triggers and the tool catalogue
9. Week 4: templates, analytics and sharing
10. Testing
11. Problems I ran into, and what I took from them
12. Results
13. What the system still does not do
14. Future work
15. Conclusion
16. Appendices

---

## 1. Abstract

AgentFlow is a full-stack web application where a user builds a workflow by dragging "agent" and "tool" nodes onto a canvas, connecting them, and then running the whole thing on a backend graph engine while watching each node update live in the browser.

Phase 1 delivered the core loop: sign-in, the canvas, saving workflows to MongoDB, a graph execution engine, an in-process job queue and cache, live updates over Socket.IO, and run history.

Phase 2, which this report covers, ran for four weeks and had two goals. The first was to finish the seven features Phase 1 had shipped as visible but disabled placeholders: scheduled triggers, webhook triggers, an analytics dashboard, workflow templates, agent-to-agent handoff, configurable failure injection, and read-only sharing. The second goal was to go back over the features Phase 1 had already built and deepen them, because when I read that code properly I found several of them only worked in the one case they had been demonstrated in.

The biggest thing I found was in the execution engine. It dispatched work through a job queue built specifically to run jobs concurrently, but it awaited each node's job before starting the next one, so only one job was ever actually running. The queue's concurrency limit had no effect at all. Below that, the queue was corrupting its own in-flight counter on every retry, which was harmless only because concurrency was effectively one. Rewriting the engine and fixing the queue underneath it took up most of the first week and everything afterwards was built on top of it.

By the end of the phase I had delivered 10 features across 9 build steps, added 46 new source files and modified 41 existing ones (roughly 4,300 lines of code), and written six verification suites containing 241 automated checks, plus another 119 checks that drive the real application in a browser. I found and fixed over thirty defects along the way. Most of them surfaced because I wrote the acceptance criteria as scripts instead of checking them by hand.

---

## 2. Introduction

### 2.1 What the platform does

Tools like n8n and Zapier let people wire up automations visually without writing code. AgentFlow is a small version of that idea, and I picked it because it forces you to build the backend machinery a workflow platform actually needs: a directed acyclic graph engine, asynchronous job processing with retry and backoff, caching, event-driven triggers, and real-time push to the browser.

The user signs in, drags nodes onto a canvas (Start, Agent, Tool, Condition, End), connects them, configures each one, saves, and presses Run. The backend walks the graph, sends each executable node through an in-process job queue, and streams status changes to the browser over Socket.IO so the workflow lights up node by node as it executes.

### 2.2 Why the agents are simulated

Agent reasoning is simulated by default. This was a scoping decision rather than a shortcut, because the subject of the project is orchestration and not prompt design. Agent execution goes through a pluggable provider interface with two implementations: a mock provider that returns templated output after an artificial delay and fails at random occasionally, and a real provider that calls a model API. Which one runs is chosen by an environment variable, so the upgrade path to real models exists without touching any code. Tools stay simulated either way.

### 2.3 Where Phase 1 finished

Phase 1 finished the first eleven features and left the rest visible but disabled in the interface, driven by a single constant in the frontend. The idea was that a demo could show the shape of the whole product rather than only the finished part.

Before planning Phase 2 I audited what Phase 1 had actually left behind, and I am glad I did, because it changed my estimates quite a lot:

| Left behind by Phase 1 | State at the start of Phase 2 |
|---|---|
| Schedule, webhook and share-token fields on the workflow model | Fields present in the database, no routes |
| The webhook and share routers | Mounted, but returning `404 "coming soon"` |
| The template model | Defined, never used |
| `npm run seed:templates` | Referenced in `package.json`, but the file did not exist |
| Agent handoff | Already working in the engine and mock provider, with no interface at all |
| `node-cron` and `recharts` | Installed, unused |

Agent handoff turned out to be about three-quarters done on the backend, which made it a much smaller job than I expected. Templates and analytics, on the other hand, were completely new.

---

## 3. What Phase 2 set out to do

I split the work into two tracks and nine build steps.

**Track A: finish the deferred features.**

1. Scheduled triggers, so a workflow can run on a cron expression
2. A webhook trigger, so an external system can start a run over HTTP
3. An analytics dashboard with charts over run history
4. Workflow templates that can be cloned into new workflows
5. Agent-to-agent handoff, where an agent's output picks the next agent
6. Configurable failure injection, so retry and backoff can be demonstrated on demand
7. Read-only share links

**Track B: deepen what already existed.**

8. **Engine parallelism and run control.** Concurrent fan-out, correct fan-in behaviour, per-node retry policy, run cancellation, and the queue fixes those needed.
9. **Builder usability.** Undo and redo, copy and paste, edge label editing, and standing validation of the graph.
10. **An extended tool catalogue.** Per-tool configuration driven by schemas from the server, four more simulated tools, and a named-event trigger.

### 3.1 Why I built them in this order

I did not work through the list in order. I ordered by dependency instead:

```
engine → failure injection → builder → handoff → triggers → tools → templates → analytics → sharing
```

The engine went first because it fixed problems every later feature would otherwise have inherited, and because per-node retry configuration was needed before failure injection made sense. The builder came before handoff because a handoff agent needs editable edge labels to keep its candidate list in step with its outgoing connections, and edge labels could not be edited at all before this phase. Analytics went last on purpose, since a dashboard is much easier to build and judge once there is a real backlog of runs to aggregate.

Each step was chosen so that it could be demonstrated on its own. That way progress was visible every week instead of only at the end.

---

## 4. Technology stack and constraints

### 4.1 Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 (Vite), React Flow, Zustand, Tailwind CSS, Recharts, Socket.IO client, React Router 7 |
| Backend | Node.js, Express 5, Mongoose 9, Socket.IO, `node-cron`, JSON Web Tokens |
| Database | MongoDB |
| Orchestration | Custom in-process job queue, custom in-process TTL cache, pluggable agent provider |
| Tooling | oxlint, Vite, verification scripts written for this project |

### 4.2 Constraints

These were set at the start of the project and I kept to them throughout. I am recording them here because a few of my decisions only make sense if you know the constraints.

**No external infrastructure.** No Redis, no Kafka or RabbitMQ, no Docker, no managed queue or cache service. The job queue and cache run inside the Node process. Where a feature looked like it needed external infrastructure I built the in-memory equivalent instead, which is why the cron scheduler is an in-process registry that re-registers itself from MongoDB when the server starts.

**Agents are simulated by default.** No model API is called unless it is explicitly configured, and provider selection is read in exactly one place.

**This is a learning project, not production software.** I preferred clear orchestration logic over hardening against conditions that cannot occur in a single-instance, single-user setup, and I did not add defensive code for impossible states.

Working inside a fixed set of constraints turned out to be useful in itself. Twice the obvious solution was ruled out and the alternative was better. The cron scheduler is simpler than a managed scheduler would have been, and keeping the HTTP tool simulated avoided introducing a real security hole, which I explain in section 8.5.

---

## 5. How I worked

For each feature I wrote down what it needed to do before building it: the data model, the API and socket contract, what the interface should do, the edge cases, and a list of acceptance criteria. Then I built it. Then, and this is the part that mattered most, I turned those acceptance criteria into a script that either passes or fails.

### 5.1 Acceptance criteria as scripts

Writing the criteria as runnable code instead of a checklist to tick off by eye was the single practice that most improved this phase. I ended up with six suites:

```bash
cd server && npm run check:engine      # engine, handoff, failure injection
cd server && npm run check:triggers    # schedules, webhooks, events
cd server && npm run check:templates   # templates
cd server && npm run check:analytics   # analytics
cd server && npm run check:share       # sharing
cd client && npm run check:logic       # canvas store, graph validator, cron helper
```

Each script prints one labelled pass or fail line per criterion and exits non-zero if anything fails. The server suites build their own throwaway database name from the configured connection string and drop it on the way out, so they can never touch development data.

I verified interface behaviour separately by driving the real application in headless Chrome over the Chrome DevTools Protocol, without adding any test dependencies. This mattered more than I expected, because a few defects were completely invisible to the first layer and only showed up once the page was actually rendered and inspected.

### 5.2 Revising my own design as I went

Nine of the ten features ended up with something in their design changed during implementation, and I recorded the reason each time. Three of those changes were substantial:

- I had planned to throttle the queue statistics socket event to about four per second. When I implemented it I found the throttle threw away exactly the event the feature existed to broadcast, which is the moment the worker pool saturates.
- I had written that edge labels should be "kept in sync" with a handoff agent's candidate list, which does not say in which direction or how far, and the ambiguity turned out to matter.
- I had planned run outcomes as a stacked bar chart. It failed a colour-blindness threshold and had to become a different form entirely, which I cover in section 9.2.

Treating my first design as a draft rather than something to follow to the letter produced better results. The reason behind a decision is worth more than the decision, because that is what lets you review it later.

---

## 6. Week 1: the execution engine

**What I worked on:** engine parallelism and run control, then configurable failure injection.

### 6.1 Objectives

Rewrite the engine so independent nodes run concurrently. Fix the job queue underneath it. Add run cancellation and a correct run deadline. Add server-side graph validation. Finish the per-node failure injection dial.

### 6.2 The main finding

Phase 1 had promised sequential steps, parallel branches and conditional branching in the engine, plus a bounded-concurrency worker pool in the queue. The engine delivered the first and third but not the second. Its main loop looked like this:

```js
for (const nodeId of topologicalOrder(workflow.nodes, workflow.edges)) {
  // ...
  const result = await queue.enqueue({ run: () => executeAgentOrTool(node, input) });
  // ...
}
```

Because each node's queue job is awaited before the loop moves on, only one job was ever in flight. The concurrency setting did nothing observable, and the hand-built worker pool, which is the whole reason this project exists, never demonstrated anything.

What makes this worth writing about is that it was invisible in a demo. A sequential run of a small graph looks exactly like a concurrent one. It passed a live demonstration and nobody noticed, including me.

### 6.3 Rewriting the engine

I replaced the topological loop with a readiness-driven scheduler. A node becomes ready when every incoming edge's source has resolved, whether that was success, failure or being skipped. All ready nodes are dispatched at once, then the scheduler waits on whichever finishes first and re-evaluates. Real parallelism is bounded by the queue's concurrency setting, which is what was intended all along.

Four correctness bugs came out in the same rewrite.

**Skip propagation was wrong for any fan-in.** The old code marked a node skipped as soon as one incoming edge was skipped. That is wrong for every diamond-shaped graph, including the `Condition → A / B → Join` example the project's own product document uses, because the join node was skipped even though one branch had succeeded. The rule now is that a node is skipped only when every inbound path is dead.

**A timed-out run was recorded as successful.** The run deadline was a `break` out of the loop. That left unreached nodes stuck at `pending`, and since no node had actually failed, the run was saved with status `success`. A run that ran out of time was reported as a run that worked. The deadline is now an internal cancellation that produces a failed run with a timeout reason and skipped nodes.

**Cycle validation existed but was never called.** There was a `findCycle()` function sitting in the engine module that nothing referenced. Cycle prevention only existed in the browser's canvas store, so the API happily accepted a cyclic graph from anything that was not the browser. It is now called on the workflow update route, and the engine also detects the deadlock case and fails the nodes involved with an explanation instead of leaving them pending forever.

**Concurrent writes to one run document.** With nodes finishing in parallel, several of them would have called `save()` on the same Mongoose document at the same time, which Mongoose rejects. I changed per-node updates to atomic positional updates instead, which removes the problem rather than working around it.

### 6.4 Fixing the queue

Two bugs in the queue were only harmless because concurrency was never exercised.

**The in-flight counter was decremented twice on every retry.** The retry branch decremented the counter and returned, but the `finally` block then ran and decremented it again, because its guard called a private helper that always returned `true` regardless of its argument. Every retry permanently lowered the effective in-flight count, and the counter could go negative, which defeats the concurrency bound completely. As soon as real fan-out landed this would have become an unbounded-parallelism bug. I removed the `finally` block in favour of one explicit decrement per exit path, and deleted the stub helper rather than implementing it.

**The pool refilled one slot at a time.** After a job settled, only a single replacement started. It now fills every free slot.

The queue also gained per-job retry limits so a node can override the global setting, a per-job retry callback so a retry can be attributed to the node that caused it (the global event stream only has a job id, so it cannot), a `PermanentFailure` class for errors that will never succeed on retry, and a `stats()` method feeding a new `queue:stats` socket event.

### 6.5 Cancellation, and making concurrency visible

`POST /api/runs/:id/cancel` asks for cooperative cancellation. Nodes already in flight are allowed to finish, since their real results are more useful than throwing them away, and unreached nodes become skipped. Cancelling a run that has already finished returns `409`.

The Run Monitor got a Cancel button, an attempt badge on retried nodes, and a queue indicator showing active, queued and limit, with one filled square per worker slot. Without that indicator the entire engine rewrite would have been invisible in the interface. Watching the pool fill up and drain during a fan-out is the visible payoff for the week.

### 6.6 Failure injection

Most of the backend already existed. The tool wrapper read a failure-rate override and threw a distinctly worded simulated-failure error. What was left was the interface, plus two problems.

**A cache hit silently bypassed failure injection.** The tool cache was checked before the job was queued, so a cached result never went through the retry path and never applied the node's configured failure rate. A node set to fail every single time could succeed by picking up another node's cached result. The cache read is now skipped for any node with an explicit non-zero failure rate. It is an exception, and I documented it as one.

**A finished run showed no logs at all.** The log panel was only ever filled from live socket events. Reopening a completed run from history showed "No logs yet...", even though every log line was sitting in the database on the run document. One of the acceptance criteria I had written for this feature was that logs should distinguish simulated failures in both the live monitor and the history view, and it was literally impossible to satisfy. The socket hook now seeds itself from the fetched run and replaces on reconnect, which also stops reconnects from duplicating lines.

The interface now has a working failure-rate slider and a maximum-attempts field. Both are overrides, so when they are unset the panel shows the actual server default. An empty control never reads as zero.

### 6.7 Verification

| Check | Result |
|---|---|
| Engine suite established | 38 checks passing, later grew to 44 |
| Four-way fan-out at concurrency 4 | Four nodes running at once, statistics report four active |
| Same graph at concurrency 2 | Caps at two active, so the bound is observable rather than just configured |
| Diamond graph | Join node runs once instead of being skipped |
| Failure rate 1.0 with five attempts | Five logged attempts, backoff at 500, 1000 and 2000 ms, then a failed run |
| Cancellation mid-run | Status `cancelled`, unreached nodes skipped, completed results kept |
| Deadline exceeded | Status `failed` with a timeout reason, nothing left at `pending` |
| Queue health after retry-heavy runs | Active count returns to zero and never goes negative |
| Cyclic graph posted with `curl` | Rejected with `400`, bypassing the browser's own guard |
| Failure dial tested directly on the handler | 0 of 300 failures at 0%, 300 of 300 at 100%, 22 of 300 at the 10% default |

### 6.8 Looking back on Week 1

Two things stuck with me. The first is that a feature can pass a demo and still be broken, because a demo checks what something looks like and appearance diverges from behaviour exactly where the interesting properties are. The second is that making a behaviour visible is part of building it. The queue indicator was not decoration, it was the only way to confirm from the interface that any of the rewrite had worked. Related to that, I found the throttle I had planned for the statistics event would have discarded the saturation moment the indicator exists to show, which is why I changed the design.

---

## 7. Week 2: the builder, and agent handoff

**What I worked on:** builder usability, then finishing agent handoff.

### 7.1 Objectives

Bring the canvas up to the level of editing comfort the rest of the application implies, which meant undo and redo, duplication, edge label editing, standing validation and an unsaved-changes guard. Then finish the interface half of agent handoff, since the engine half already worked.

### 7.2 Undo and redo, and the coalescing problem

A history stack sounds simple. Snapshot before each change, cap it at fifty entries. The problem is that React Flow fires its change handler on every mouse-move during a drag, so the obvious implementation fills the whole history with a single gesture and undo becomes useless.

What fixed it was separating gestures from changes. A snapshot is stashed when a drag starts and committed when it ends, and only if a position actually changed, so clicking a node to select it adds nothing to the history. Text editing coalesces per field on a 500 ms idle window, so typing a word is one undo step instead of seven.

While I was in there I fixed something that had annoyed me since Phase 1: selecting a node marked the graph as having unsaved changes. Selection is not an edit.

### 7.3 Copy, paste and duplicate

Duplication assigns fresh ids, offsets the copy, keeps edges that are internal to the selection while dropping edges that leave it, and refuses to clone a Start node because a workflow can only have one.

The detail that matters is that node configuration is deep-copied. With a shallow copy, the clone's arrays (a handoff agent's candidate list, for example) point at the same array as the original, so editing the copy silently edits the source. This is exactly the kind of bug that is almost impossible to spot by clicking around and trivial to catch with one explicit check, and there is now a check for it in the suite.

### 7.4 Editing edge labels

In Phase 1 an edge's label was set once when the connection was drawn and could never be changed. That blocked handoff, where a candidate list has to correspond to outgoing edge labels, so I added an edge inspector with two rules.

Condition branches cannot be renamed. The engine routes on the source handle rather than the label, so a renamed condition label would be a lie about what the engine is going to do.

For an edge leaving a handoff agent, the label editor offers that agent's candidates as a dropdown. That keeps the two in step by construction instead of relying on the user to remember.

### 7.5 Standing validation, and a scoping fix

I replaced the single error string in the builder with a validation panel carrying ten rules. The useful part was not the rules, it was splitting them into errors and warnings.

Errors block saving: no nodes, no Start node, or a cycle in the graph. Warnings allow saving but block running: an unconfigured tool node, an unknown tool type, an expression that will not parse, a condition missing a branch, a handoff mismatch, an unreachable node, or zero or several End nodes.

Phase 1 blocked saving on a missing Start node, which meant you could not park a half-built graph and come back to it. Saving should be permissive and running should be strict. It is a small change but it makes a disproportionate difference to how the builder feels.

### 7.6 A structural change: the data router

The unsaved-changes guard needs to catch navigation inside the application, not just the page unloading, because losing an unsaved graph to a stray back-button press is the most expensive mistake the builder allows. React Router provides `useBlocker` for this but it only works with a data router, so I replaced `BrowserRouter` with `createBrowserRouter` and `RouterProvider`. The route tree is still declared as JSX, so this was a wiring change rather than a rewrite.

Using only `beforeunload` would have covered reload and closing the tab but not in-application navigation, and in-application navigation is the case that actually loses work.

### 7.7 Finishing agent handoff

The engine, the mock provider and the real provider already did handoff, and Week 1 had additionally persisted the chosen target on the run result. What was left was interface work.

The handoff checkbox became live, with a candidate list editor. Each candidate shows green or amber depending on whether an outgoing edge currently uses its name, and orphaned edge labels are reported inline. Handoff agents are badged on the canvas so they read differently from a plain agent.

The part I am most pleased with is that the taken branch is now highlighted in the Run Monitor: animated and accented, with the branches that were ruled out drawn dashed and faded. Condition nodes got identical treatment, since both node types resolve to exactly one outgoing edge. Before this, a routing decision was invisible on the graph. The untaken nodes just went grey, and you could not tell whether that was a routing choice or a failure further upstream.

**Resolving the ambiguity I had left myself.** "Keep edge labels in sync with candidate names" does not say in which direction, or how far. The rule I settled on is that renaming a candidate rewrites any outgoing edge already labelled with the old name, because that is the same branch being renamed and letting them drift would only manufacture a warning. Adding or removing a candidate does not touch edges, on purpose. That drift is real, and the validation panel should report it rather than having a configuration edit silently rewire the graph.

### 7.8 Bugs found in Week 2

**The history stack ignored workflow boundaries.** Loading a workflow reset the undo stacks but not the coalescing window. Opening a workflow within 500 ms of editing a different one folded the first edit into the previous workflow's window, so it got no undo entry of its own. Narrow, but it loses the user's work.

**The mock provider lied in the run log.** When no keyword matched the input it picked a candidate at random, but logged `routed based on keyword match in input` regardless. A log that states a reason the system did not use is worse than giving no reason at all. It now says which of the two paths it took.

**The run deadline was process-global.** Testing the timeout path needed a short deadline, which then starved every other run sharing the process. This is what made the handoff check fail the first time I ran it, and I initially thought I had broken the engine. I added a per-run deadline override, which also makes the timeout demonstrable instead of a hard-coded two-minute constant.

### 7.9 Verification

| Check | Result |
|---|---|
| Canvas store and validator logic | 37 checks passing, later folded into the client suite |
| Handoff candidate and edge synchronisation | 18 checks passing |
| Engine handoff routing | 6 new checks, bringing the engine suite to 44 |
| Browser checks for the builder | 16 passing |
| Browser checks for handoff | 14 passing |
| Drag coalescing | 40 simulated move events produce one history entry |
| Delete three nodes, then undo | All three nodes and every connecting edge come back |
| Clone independence | Editing a duplicated agent's candidates leaves the original alone |
| Handoff routing | Exactly one of three candidates runs, the other two are skipped |
| Invalid handoff target | Node fails at attempt one without defaulting to the only available edge |
| Unsaved-changes guard | Confirmation raised and navigation cancelled while the graph is dirty |

My first browser run reported ten failures and every single one was a bug in the test rather than the application. `innerText` returns text that CSS has transformed to uppercase, palette buttons contain an icon glyph before their label, and the navigation-guard test had not made the graph dirty first, so the blocker was correctly not blocking. Learning to be as suspicious of a failing test as of failing code was worth the wasted half hour.

---

## 8. Week 3: triggers and the tool catalogue

**What I worked on:** scheduled triggers, the webhook trigger, the named-event trigger, and the extended tool catalogue.

### 8.1 One entry point for four triggers

Three of these mechanisms share the same shape, which is that something other than a button starts a run, so I built the shared entry point once. A run service now exposes a single `createAndStartRun()` used by the manual Run button, cron ticks, webhook calls and event dispatch alike. Four ways in, one way to start a run, so the guards and the run document cannot drift apart between them.

It returns a result object rather than throwing, because cron and event callers have no HTTP request to fail, and a fan-out across many workflows has to be able to skip one without aborting the rest.

Two model additions support this. The run now records which trigger started it, and the payload a trigger supplied, which the engine hands to the Start node as its output. I also added a trigger badge to the Run Monitor and Run History, because with four trigger types live, "where did this run come from?" becomes a real question.

### 8.2 Scheduled triggers

The scheduler is an in-process registry keyed by workflow id, so enabling, editing or disabling a schedule starts or stops exactly one job without needing a restart. Two details mattered.

Each tick reloads the workflow from the database instead of closing over the copy captured when the job was registered. Otherwise an edited workflow keeps running its old graph.

Schedules are re-registered from MongoDB when the server starts. `node-cron` jobs only exist in memory, so without that step a restart silently stops every schedule the user thinks is still running. I tested this specifically: three enabled schedules were re-registered on boot, and I watched a re-registered cron fire afterwards.

The cron description and next-run preview are a small helper I wrote rather than two extra packages for one panel. It handles standard five-field syntax with ranges, lists and steps, describes expressions in plain English ("every 5 minutes", "hourly at :30", "at 09:00 on Monday"), and works out the next fire time. Eleven checks cover it, including the day-of-month and day-of-week union rule that standard cron specifies and that is easy to get wrong.

### 8.3 Webhook trigger

Token generation, an unauthenticated `POST /api/hooks/:token`, the payload passed through to the Start node, regeneration that invalidates the previous URL, and disabled or unknown tokens both returning an identical `404` so the response never confirms that a token was once valid.

I added one endpoint I had not originally planned: a `PUT` for the enable and disable toggle. Regeneration on its own can only ever turn a webhook on, so the interface had no way to switch one off without destroying the URL.

### 8.4 The named-event trigger

The fourth trigger type was described only as "External Event", which is vague. I implemented it as named-event fan-out, because that is what actually makes it different from a webhook rather than a duplicate of one.

A webhook token addresses one workflow. An event name addresses every workflow subscribed to it. So `POST /api/events/:eventName` starts a run of each enabled subscriber. A workflow that is already mid-run is skipped while the others still fire, and zero subscribers returns `202` with an empty list rather than `404`, because the caller is a publisher and whether anyone was listening is not its concern.

**A limitation I decided to document rather than fix.** Event names live in one global namespace on an unauthenticated endpoint, so two users who both pick `order.created` would trigger each other's workflows. That is acceptable at this project's single-user scope, and it is the deliberate counterpart to a webhook's per-workflow token, but it is a real limitation and not something I overlooked. I wrote it down along with the fix a multi-user version would need, which is namespacing the event per account. What I found interesting is that I only noticed it because it interfered with my own check scripts three separate times. The tests found a design problem, not just code problems.

### 8.5 From hardcoded forms to schemas

Four gated tool types needed to go live, each with its own configuration fields. Adding four more branches to the configuration panel would have put the tool catalogue in two places at once, so instead each tool handler now publishes a configuration schema, which is an ordered list of field descriptors, and the tools endpoint serves it. The panel renders any tool's form from that, with no per-tool branching in the frontend at all.

The four new simulated tools are email, Slack, HTTP request and database write. All four go through the existing mock-behaviour wrapper, so they inherit artificial latency, failure injection and retry without any extra work.

**Keeping the HTTP tool simulated was a deliberate decision, and it is the more interesting one in the week.** A tool node that makes a real outbound request to a user-supplied URL is a server-side request forgery primitive. Any signed-in user could point it at an internal address and read the response back out of the run log. It would also make demo runs depend on network reachability, and it would be the project's first genuine external dependency, which the constraints rule out. I put the reasoning in a code comment so it does not read as unfinished work, and I wrote down the conditions under which a real fetch could be added later, which would be an explicit allowlist behind an opt-in flag.

**The database write tool got a real, contained side effect.** Rather than being pure fiction it inserts into a dedicated collection, tagged with the run and owner that wrote it, so the tool is observably real without adding any infrastructure. Malformed JSON in its document field fails as a permanent error, so it does not burn three retries on input that is never going to parse.

### 8.6 Bugs found in Week 3

**The cache key was wrong once tools had configuration.** Keyed on tool type plus input alone, two email nodes with different recipients and the same upstream input would collide, and the second one would be served the first one's result. The key now includes the tool's own configuration. This was correct code until I changed the assumptions around it.

**Side-effecting tools must not be cached at all.** Caching an action means the second "send" silently does not happen, which is a bug and not a saving. Those four tools now opt out, while the three read-like tools stay cacheable.

**A form wrapper silently threw away its arguments.** The trigger panel's error-handling wrapper was written as `(fn) => async () => …`, which drops whatever arguments are passed to it, so a call like `applySchedule(true)` fell back to the current disabled value. Enable and Subscribe appeared to work while saving `enabled: false`. The browser check caught it. Clicking through by hand very possibly would not have, because the interface gave no wrong feedback, it just did not save what I asked for.

**`collection` is a reserved Mongoose schema path.** It shadows a document's own `collection` property and Mongoose warns that using it may break internal behaviour. The model stores `collectionName` instead, while the tool's user-facing field and its output still read `collection`.

**Malformed JSON produced an opaque error.** Express rejects an unparseable body with a syntax error carrying status 400 but no public message, which surfaced as a generic internal-error payload for what is plainly a caller mistake. It now returns a clear "Malformed JSON body".

**Two flaws in my own cron descriptions.** "Hourly at :30" was being rendered with a redundant "every day" appended, and a sub-minute expression like `*/2 * * * * *` was described as "every minute" when it actually fires every two seconds. Both were wrong in a way a user would have believed.

### 8.7 Verification

| Check | Result |
|---|---|
| Trigger suite | 28 checks passing |
| Cron helper | 11 checks passing |
| Tool handlers | 32 checks passing |
| Validator, required tool fields | 8 checks passing |
| Browser checks for triggers | 20 passing |
| Browser checks for tool forms | 15 passing |
| Schedules surviving a restart | Three re-registered from MongoDB, and a re-registered cron observed firing |
| Webhook payload flow | Body reaches the Start node and flows into the graph, `6*7` producing 42 |
| Token regeneration | Old URL returns `404` immediately, new URL returns `202` |
| Event fan-out | One dispatch starts runs of both subscribers, and a busy workflow is skipped while others fire |
| Database write tool | Real document confirmed in MongoDB, tagged with the run that wrote it |
| Adding an eighth tool | A temporary tool added to the registry on the server only appeared in the dropdown with all five widget types, its description, its select default and required-field validation, and was then removed |

That last one is worth calling out, because it is the direct proof of the week's main architectural claim: adding a tool needs no frontend change whatsoever.

---

## 9. Week 4: templates, analytics and sharing

**What I worked on:** workflow templates, the analytics dashboard, and read-only share links.

### 9.1 Workflow templates

Three endpoints: list templates (built-in ones plus the caller's own, never anybody else's), snapshot a workflow as a template, and clone a template into a new independent workflow.

Everything that makes templates useful is about independence, and it holds because snapshots are deep-copied both when saved and when cloned. Gutting the original workflow leaves its template intact. Editing a clone never touches the template. Two clones of the same template are independent of each other. Each of those is a check in the suite, because they are exactly the sort of guarantee that quietly stops being true.

Cloning also re-runs the cycle validation. `POST /:id/use` creates a workflow directly and therefore skips the update route's guard that I added in Week 1, so a template stored before that validation existed could otherwise sneak a cycle back in.

**The missing seed script finally exists.** `package.json` had referenced `npm run seed:templates` since Phase 1 and the file was simply not there. It now seeds three built-in templates and upserts them by name, so re-running it updates a built-in's graph rather than piling up duplicates. One of them, "Conditional Retry Demo", is built specifically to show off the engine, with a 60% failure rate, five attempts and a condition branch.

"Save as template" is disabled while the graph has unsaved changes, because a template snapshots the last saved version. Offering it on unsaved edits would quietly capture something other than what is on the screen.

### 9.2 The analytics dashboard

One aggregation endpoint returns totals, a status breakdown, success rate, mean and median duration, runs per day, runs by trigger, and node and tool type usage, scoped to the requesting user and filtered to a 7, 30 or 90 day window.

Three decisions are worth recording.

Success rate is calculated over finished runs, not all runs. Counting runs that are still in flight would drag the number down for no reason while a run is still going. It returns null rather than zero when nothing has finished yet, so the interface can show a dash instead of a misleading 0%.

Node and tool type usage is design-time, aggregated over stored workflows, because what I wanted was usage across all workflows. Working it out from run results would mean joining every node result back to its workflow's node list to recover a type that run results do not store.

Runs per day is zero-filled across the whole window, so a quiet day reads as an actual zero rather than as a gap the chart smooths over.

#### Chart decisions

I designed the charts against an explicit method rather than by eye, and validated the palette numerically against the application's real surfaces. That produced one substantial change.

**Run outcomes are one labelled meter per status, not a stacked bar.** The green and red status colours are only 4.1 units apart in perceptual distance under deuteranopia, which is the most common form of colour blindness. Green and red segments sitting flush against each other would be indistinguishable to a red-green colour-blind reader. Giving each status its own row with an icon, a word and a count means identity never depends on hue at all, and the colour is only reinforcement. This is a case where a numerical check overruled a design that looked completely fine on my screen.

The rest of the chart decisions were smaller. All the bar charts use a single hue, since the label already carries the identity and a multi-coloured palette would just be noise. The series colour is re-stepped for dark mode rather than reused as-is, and chart colours are declared as CSS variables so the SVG follows the theme without a re-render.

I also switched the line from a curve to straight segments. These are discrete daily counts, and a smooth curve invents values for days that never existed. Finally there is a table view behind a "Show data" toggle, as the accessibility fallback.

#### Two bugs only a rendered page could show

**Runs per day silently left out today.** MongoDB buckets dates in UTC unless you tell it otherwise, but I was generating the list of days from local midnight. In UTC+5:30, local midnight is 18:30 UTC on the previous day, so every key was shifted back a day and today was missing from the series entirely. The newest data simply was not on the chart. The endpoint is UTC throughout now, and the page says so.

**The area chart rendered completely blank.** The axes and gridlines drew correctly and the data did not. The path element had valid geometry and a correctly resolved two-pixel stroke, which is what made this take a while. It turned out that Recharts reveals a series by animating a clip rectangle out from zero width, and that animation sits at its first frame wherever the browser is not advancing frames. The clip rectangle measured 19.95 pixels against a plot about 1,030 pixels wide. Disabling the entry animation fixes it, and it is the better choice anyway, since it is noise on every range change and it breaks screenshots, exports and reduced-motion preferences.

This is the clearest argument in the whole phase for actually looking at what you have built. Every signal I could check programmatically was green: valid path data, correct computed styles, correct bounding box. Only a screenshot showed an empty chart.

### 9.3 Read-only share links

Three endpoints, being create or regenerate a share token, revoke it, and an unauthenticated fetch by token, plus a public page that renders the graph and recent runs with no navigation, no sign-out, no Save, no Run and no configuration panel.

**The most important decision here was what the shared payload leaves out.** I built it as an explicit whitelist rather than taking the workflow document and deleting a few fields, because a read-only viewer who receives the webhook token holds the ability to start runs. That turns a view link into an execute link. The schedule and event subscription are withheld for the same reason, the owner id and share token because neither is any of the viewer's business, and per-node run results because outputs can carry data the design itself does not reveal. Seven of the twenty-seven checks in this suite exist only to assert those absences.

Three more bugs came out of this feature.

Share URLs pointed at the wrong origin. I had built them from the public base URL, which addresses the API, so by default a link read `localhost:4000/shared/...`, an origin that serves no such page.

The page would have redirected its own visitor to the sign-in screen. Using the shared API client means a `401` triggers sign-out and a redirect, and a link meant for somebody who is not signed in has to render a "link not found" page instead. It uses a plain request that bypasses that interceptor on purpose.

Connection handles stayed interactive on the read-only canvas, because React Flow tags handles as connectable even when connections are switched off. They are now inert and invisible, and the CSS needed higher specificity because React Flow's own rule ties with mine and its stylesheet loads afterwards.

### 9.4 Removing the scaffolding

With sharing live, all six of the "coming soon" flags were false. I deleted the module and its badge component rather than leaving an all-false configuration behind, and the client-side tool catalogue had already gone in Week 3 in favour of the server registry. There is now one source of truth for the tool list and no dead configuration anywhere.

### 9.5 Verification

| Check | Result |
|---|---|
| Template suite | 27 checks passing, run across two users |
| Analytics suite | 29 checks passing |
| Sharing suite | 27 checks passing |
| Browser checks for templates | 17 passing |
| Browser checks for analytics | 15 passing |
| Browser checks for sharing | 22 passing |
| Ownership boundaries | A second user can neither see, use nor template another user's workflow, getting `404` each time, but can use a built-in |
| Shared payload | No webhook token, schedule, event subscription, owner id or node results |
| Revoked link | `404` straight away, and renders "link not found" rather than redirecting to sign-in |
| Analytics empty state | A new user sees an empty state with no `NaN`, `Infinity` or `undefined` anywhere |
| Axis ticks | 7, 8 and 8 labels at the three ranges with no overlap at any of them |

One test this week produced a false pass, which I think is worth recording. A check asserting that nodes cannot be dragged on the read-only canvas passed, but for the wrong reason. The synthetic mouse event it dispatched was missing properties React Flow's drag library expects, so the drag handler threw an exception and the node stayed where it was because the code crashed, not because dragging was disabled. I only caught it because an uncaught exception showed up in the same run. I replaced it with an assertion on the rendered state. A test that passes for the wrong reason is more dangerous than one that fails, because you stop looking.

---

## 10. Testing

### 10.1 Two layers

I did not add a test framework. The project has no unit-test infrastructure and setting one up mid-phase would have cost time without improving the specific thing I needed, which was confidence that each feature actually did what I had said it should do. I used two layers instead.

The first layer is executable acceptance criteria: Node scripts, one per feature area, each printing a labelled pass or fail line per criterion. The server suites use a throwaway database derived from the configured connection string and drop it on exit, so they cannot touch development data. That comes to 1,109 lines of verification code.

The second layer drives the real application in headless Chrome over the DevTools Protocol, with no extra dependencies. This layer checked rendering, interaction, theme behaviour and the absence of uncaught exceptions, and it caught several defects the first layer structurally could not.

### 10.2 Final results

| Suite | Covers | Checks |
|---|---|---|
| `check:engine` | Engine, handoff, failure injection | 44 |
| `check:triggers` | Schedules, webhooks, events | 28 |
| `check:templates` | Templates | 27 |
| `check:analytics` | Analytics | 29 |
| `check:share` | Sharing | 27 |
| `check:logic` | Canvas store, graph validator, cron helper | 86 |
| **Total automated** | | **241** |
| Browser-driven checks | Every interface surface | 119 |

All of them pass. I ran the engine suite repeatedly and at two different concurrency settings, partly to confirm the concurrency bound is really enforced and partly because the mock providers contain deliberate randomness, so stability across runs was worth confirming rather than assuming.

### 10.3 Which layer caught what

This is probably the most useful methodological result of the phase, so I tracked it.

| Defect | Found by |
|---|---|
| Sequential execution defeating the queue | Reading the code |
| Queue in-flight counter double-decrement | Reading the code |
| Fan-in skip behaviour | A check, using a diamond graph |
| Timeout reported as success | A check |
| End node output never persisted | A check on the fan-in input shape |
| Timeout relabelling a user cancellation | A check |
| Statistics throttle hiding saturation | A check |
| Coalescing window crossing workflows | A check |
| Cache key missing tool configuration | Reading the code while extending tools |
| Form wrapper discarding arguments | A browser check |
| UTC and local date bucketing dropping today | A check |
| Blank area chart | Screenshot review only |
| Colour-blind indistinguishable status bar | The palette validator only |
| Share URL on the wrong origin | A check |
| Shared payload leaking a capability | A check I wrote before the code |

Roughly two-thirds of the defects came from writing the acceptance criteria as code. Two came only from looking at rendered output, and one only from validating colour numerically. No amount of unit testing would have surfaced those three.

---

## 11. Problems I ran into, and what I took from them

### 11.1 A feature can pass a demo and still be broken

The engine's sequential execution survived a whole phase and a live demonstration, because a sequential run and a concurrent run look identical on a small graph. A demo verifies appearance, and appearance and behaviour diverge exactly where a system's interesting properties live. Where a property is not visible, either make it visible or assert it in code, and preferably both. That is why I built the queue indicator and the concurrency checks in the same sitting.

### 11.2 Latent bugs wake up when the code around them changes

The queue's counter corruption was harmless while concurrency was effectively one, and would have become an unbounded-parallelism bug the moment fan-out landed. The tool cache key was correct until tools gained per-node configuration, at which point it started colliding silently. Both were dormant faults switched on by an unrelated change. I caught both by reviewing the code next door when I changed a component's assumptions, which is a habit I did not have at the start of this phase.

### 11.3 My own designs were often wrong

Nine of the ten features had something in their design changed while I was building them. Three of those changes were substantial: the statistics throttle discarded the event it existed to deliver, "keep labels in sync" was ambiguous in a way that mattered, and a stacked status bar failed a colour-blindness threshold and had to become something else.

Treating my first write-up as a draft, and recording why I changed it, produced better documentation than treating it as fixed would have. The reasoning is more valuable than the decision, because the reasoning is what makes the decision reviewable six months later.

### 11.4 Security thinking in a project with one user

Three decisions this phase were security decisions even though the application has a single demo user. Keeping the HTTP tool simulated, because a real fetch to a user-supplied URL is a server-side request forgery primitive. Building the shared payload as a whitelist, because returning the workflow document with fields deleted would have leaked a webhook token and turned a view link into an execute link. And returning an identical `404` for unknown and revoked tokens, so a response never confirms that a token was once valid.

The habit I want to keep is asking what capability a response grants rather than whether the data in it is secret. A webhook token is not sensitive information in itself. It is an ability, and that is what made sharing it dangerous.

### 11.5 Broken tests look exactly like broken code

A lot of initially-failing checks this phase were faults in the test and not the application: CSS uppercasing text so `innerText` did not match, class names that had changed between library versions, event names left globally scoped so an earlier run interfered with a later one, and the synthetic mouse event that crashed a drag handler and produced a false pass. What I learned is to diagnose a failing check with the same suspicion I would apply to failing code, and to be particularly wary of a check that passes for a reason that was not the reason I wrote it.

### 11.6 A system should not misrepresent itself

Three fixes this phase were purely about honesty in output: the mock provider claiming a keyword match on a random choice, a timed-out run reporting success, and a smooth curve implying values between daily counts that never existed. None of them caused incorrect behaviour and all of them would have caused somebody to draw a wrong conclusion. Logs and charts are part of the interface, and being wrong there is a defect like any other.

---

## 12. Results

### 12.1 What works now

Every feature the project set out to build is finished. At the end of Phase 2 the application supports:

- Four trigger types: manual, scheduled by cron, webhook, and named event with fan-out to every subscriber
- Seven tool types: the three from Phase 1 plus simulated email, Slack, HTTP and database write, all driven by schemas the server publishes
- An execution engine that actually runs nodes concurrently, with a bounded and observable worker pool, correct fan-in and fan-out, conditional and dynamic branching, per-node retry policy, cooperative cancellation and a working run deadline
- A usable builder with undo and redo, copy and paste, edge editing, standing validation and an unsaved-changes guard
- Templates, three built-in plus any the user saves, cloneable into independent workflows
- An analytics dashboard with stat tiles, a runs-over-time chart, four breakdown panels and a table fallback
- Read-only share links with capability-safe payloads and immediate revocation

None of the "coming soon" flags remain, and the module that drove them has been deleted.

### 12.2 By the numbers

| Metric | Value |
|---|---|
| Features delivered | 10, across 9 build steps |
| New source files | 46, including six verification suites and the seed script |
| Existing source files modified | 41 |
| Application code changed | About 4,300 lines added and 270 removed, across 80 files |
| Verification code written | 1,109 lines across six suites |
| Automated checks | 241, all passing |
| Browser-driven checks | 119, all passing |
| Defects and corrections | Over 30 |
| Features whose design changed during implementation | 9 of 10 |
| Lint errors | 0 |

### 12.3 The result I did not expect

The more durable outcome is not any single feature. It is that the project now has a repeatable way of establishing that something works. At the start of the phase, "done" meant I had clicked through the feature once. By the end, "done" meant a named script asserted each of the criteria I had written for it and exited zero.

That change is what surfaced most of the thirty-odd defects, and several of those had already been built, demonstrated and believed finished in the previous phase.

---

## 13. What the system still does not do

These are deliberate boundaries. I am listing them so their absence reads as scope rather than as something I missed.

1. **Event names are global.** The event endpoint is unauthenticated and matches every enabled subscription regardless of owner. Fine for one user; a multi-user version needs the event namespaced per account.
2. **The HTTP tool makes no real network call.** Explained in section 8.5.
3. **Templates cannot be deleted.** The gallery is add-only at the moment.
4. **Sharing has one access level.** Owner, or anyone with the link in read-only mode. That is the whole access model. No roles, teams or expiring links.
5. **Shared run history has no detail view.** A viewer sees the run list, not individual node outputs.
6. **Analytics are not live.** They refresh on navigation or when the filter changes, not over the socket.
7. **Single instance only.** The queue, cache and cron registry all live in the Node process and lose state on restart. Schedules are re-registered from the database, but a queued job is not.
8. **Sub-minute cron schedules** are accepted by the underlying library but are not a supported feature, and the description helper labels them as such instead of computing a next-run time.
9. **Nothing runs the checks automatically.** The suites are run by hand. Wiring them to a pre-commit hook or a CI job is the obvious next step.

---

## 14. Future work

Ordered by value rather than by effort.

1. **Continuous integration.** The six suites exist and pass. Running them on every commit would turn them from a habit into a guarantee, and it is the cheapest remaining improvement by a wide margin.
2. **Namespace event triggers per account**, which closes the limitation above and makes the event system defensible with more than one user.
3. **Template deletion and editing**, so the gallery is not add-only.
4. **A shared run detail view**, with a considered decision about which node outputs are safe to expose.
5. **Queue durability**, so a restart resumes queued work rather than losing it. This would be the right moment to revisit the in-process constraint on purpose rather than by default.
6. **Per-workflow analytics.** The dashboard currently aggregates across all of a user's workflows, and a per-workflow view is a small extension of the same endpoint.
7. **Exercise the real model provider properly.** It is implemented and it asks for the handoff decision correctly, but I have only tested it structurally. Running a workflow against a live model would put the abstraction under real latency and real failure modes.
8. **Visualise retries on a timeline.** Attempt counts are recorded and shown as a badge, but showing the backoff intervals would make the retry machinery much clearer.

---

## 15. Conclusion

Phase 2 set out to finish seven deferred features and to deepen the ones already built, and both were achieved. Every feature is complete, the placeholder scaffolding is gone, and 241 automated checks alongside 119 browser-driven checks assert that each feature does what I said it would.

The most valuable thing that came out of the phase was not a feature though. It was finding that the project's centrepiece, a hand-built concurrent job queue chosen specifically to demonstrate asynchronous orchestration, was not doing the thing it was built for, because the engine above it awaited every job in sequence. That came from reading the code carefully rather than from any failing test, and fixing it meant correcting five more problems the sequential shape had been hiding: fan-in skip behaviour, timeout reporting, dead cycle validation, concurrent document writes, and a corrupted worker counter.

The lesson generalises well past this codebase. A system's most important properties are often its least visible ones, and code that appears to work in a demo may only be working in the one case it was demonstrated in. Two practices addressed that directly and I intend to keep both: making an intended behaviour visible in the interface, and writing every acceptance criterion as a script that fails loudly when the behaviour is missing. Between them they account for most of the defects I fixed this phase, including several that had already been shipped and believed complete.

---

## 16. Appendices

### Appendix A: running the project

MongoDB needs to be available at `mongodb://127.0.0.1:27017`, or update `MONGODB_URI` in `server/.env`.

```bash
# Backend, on http://localhost:4000
cd server
cp .env.example .env      # first time only
npm install               # first time only
npm run seed:templates    # optional, loads the three built-in templates
npm run dev

# Frontend, on http://localhost:5173
cd client
cp .env.example .env      # first time only
npm install               # first time only
npm run dev
```

### Appendix B: running the checks

```bash
# Manages its own throwaway database
cd server && npm run check:engine

# These need a running server; point BASE at it
cd server && BASE=http://localhost:4000/api npm run check:triggers
cd server && BASE=http://localhost:4000/api npm run check:templates   # run seed:templates first
cd server && MONGODB_URI=<same as the server> BASE=http://localhost:4000/api npm run check:analytics
cd server && BASE=http://localhost:4000/api npm run check:share

# Pure logic, no server needed
cd client && npm run check:logic

# Exercise the concurrency bound
cd server && QUEUE_CONCURRENCY=2 npm run check:engine
```

### Appendix C: main modules added this phase

**Backend**

| Module | Responsibility |
|---|---|
| `services/runService.js` | The single run-creation entry point shared by all four triggers |
| `scheduler/index.js` | In-process cron registry, re-registered from MongoDB at startup |
| `controllers/triggerController.js` | Schedule, webhook and event-trigger endpoints |
| `controllers/templateController.js` | Listing, snapshotting and cloning templates |
| `controllers/analyticsController.js` | The aggregation endpoint |
| `controllers/shareController.js` | Share token lifecycle and the public read-only payload |
| `queue/errors.js` | `PermanentFailure`, for errors that must not be retried |
| `tools/template.js` | `{{input.field}}` interpolation for tool configuration |
| `models/MockRecord.js` | The contained side effect for the database write tool |
| `routes/events.js`, `routes/templates.js`, `routes/analytics.js` | Route mounting |
| `scripts/seedTemplates.js` | The built-in templates, previously referenced but missing |
| `scripts/*Check.mjs` | Five executable acceptance-criteria suites |

**Frontend**

| Module | Responsibility |
|---|---|
| `utils/validateGraph.js` | Ten-rule graph validation, split into errors and warnings |
| `utils/cron.js` | Cron parsing, plain-English description and next-run calculation |
| `hooks/useCanvasShortcuts.js` | Keyboard shortcuts, suppressed while typing |
| `hooks/useUnsavedChangesGuard.js` | Navigation and unload guard |
| `components/ValidationPanel.jsx` | Collapsible problem list with click-to-reveal |
| `components/EdgeInspector.jsx` | Edge label editing, with the condition and handoff rules |
| `components/HandoffCandidates.jsx` | Candidate editor with live edge-match indicators |
| `components/ToolConfigFields.jsx` | Generic tool form built from the server's schema |
| `components/MockBehaviorFields.jsx` | Failure rate and attempt overrides |
| `components/QueueIndicator.jsx` | Live worker-pool saturation display |
| `components/charts/*` | Area chart, category bars, outcome meters, stat tiles, table view |
| `pages/Templates.jsx`, `pages/Analytics.jsx`, `pages/SharedWorkflow.jsx` | The three new pages |
| `scripts/checkLogic.mjs` | 86 logic checks over the store, validator and cron helper |

### Appendix D: features by week

| Feature | Week |
|---|---|
| Engine parallelism and run control | 1 |
| Configurable failure injection | 1 |
| Builder usability: undo, copy-paste, edge labels, validation | 2 |
| Agent-to-agent handoff | 2 |
| Scheduled triggers | 3 |
| Webhook trigger | 3 |
| Extended tool catalogue and named-event trigger | 3 |
| Workflow templates | 4 |
| Analytics dashboard | 4 |
| Read-only share links | 4 |

---

*End of report.*
