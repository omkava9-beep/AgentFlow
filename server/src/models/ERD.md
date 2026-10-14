# AgentFlow model ER diagram

This diagram covers the Mongoose models in this directory. `PK` is MongoDB's
`_id`; `FK` marks an `ObjectId` reference declared by a model. MongoDB does not
enforce these references as relational foreign keys.

```mermaid
erDiagram
    USER {
        ObjectId _id PK
        string email UK
        string name
        string passwordHash
        number tokenVersion
    }

    WORKSPACE {
        ObjectId _id PK
        string name
        string slug UK
        string plan
        boolean personal
        ObjectId createdBy FK
    }

    MEMBERSHIP {
        ObjectId _id PK
        ObjectId workspaceId FK
        ObjectId userId FK
        string role
        date onboardingDismissedAt
    }

    INVITATION {
        ObjectId _id PK
        ObjectId workspaceId FK
        string email
        string role
        string tokenHash UK
        ObjectId invitedBy FK
        ObjectId acceptedBy FK
        string status
        date expiresAt
    }

    API_KEY {
        ObjectId _id PK
        ObjectId workspaceId FK
        string name
        string prefix
        string keyHash UK
        array scopes
        ObjectId createdBy FK
        date lastUsedAt
        date revokedAt
    }

    CONNECTION {
        ObjectId _id PK
        ObjectId workspaceId FK
        string integration
        string name
        string mode
        ObjectId createdBy FK
        string status
    }

    KNOWLEDGE_DOC {
        ObjectId _id PK
        ObjectId workspaceId FK
        string title
        string text
        array chunks
        ObjectId createdBy FK
    }

    WORKFLOW {
        ObjectId _id PK
        ObjectId workspaceId FK
        ObjectId createdBy FK
        ObjectId updatedBy FK
        ObjectId publishedBy FK
        ObjectId publishedVersionId FK
        ObjectId eventConnectionId FK
        string name
        array nodes
        array edges
    }

    WORKFLOW_VERSION {
        ObjectId _id PK
        ObjectId workflowId FK
        ObjectId workspaceId FK
        ObjectId publishedBy FK
        number version
        string contentHash
        array nodes
        array edges
    }

    RUN {
        ObjectId _id PK
        ObjectId workflowId FK
        ObjectId workspaceId FK
        ObjectId triggeredBy FK
        ObjectId apiKeyId FK
        ObjectId versionId FK
        ObjectId parentRunId FK
        ObjectId rootRunId FK
        ObjectId rerunOf FK
        ObjectId retryOf FK
        string status
        string trigger
        array nodeResults
    }

    SANDBOX_RECORD {
        ObjectId _id PK
        ObjectId workspaceId FK
        ObjectId runId FK
        string integration
        string collectionName
        object doc
    }

    TEMPLATE {
        ObjectId _id PK
        ObjectId workspaceId FK
        ObjectId createdBy FK
        string name
        string key
        array nodes
        array edges
    }

    USAGE_COUNTER {
        ObjectId _id PK
        ObjectId workspaceId FK
        string day
        number runs
        number nodeExecutions
        object integrationCalls
        number mcpCalls
    }

    COMMENT_THREAD {
        ObjectId _id PK
        ObjectId workspaceId FK
        ObjectId workflowId FK
        ObjectId createdBy FK
        ObjectId resolvedBy FK
        object anchor
        date resolvedAt
    }

    COMMENT {
        ObjectId _id PK
        ObjectId workspaceId FK
        ObjectId threadId FK
        ObjectId authorId FK
        array mentions
        string body
        date editedAt
        date deletedAt
    }

    WORKFLOW_WATCH {
        ObjectId _id PK
        ObjectId workspaceId FK
        ObjectId workflowId FK
        ObjectId userId FK
        boolean watching
    }

    NOTIFICATION {
        ObjectId _id PK
        ObjectId workspaceId FK
        ObjectId userId FK
        ObjectId actorId FK
        string kind
        string title
        string groupKey
        date readAt
    }

    AUDIT_EVENT {
        ObjectId _id PK
        ObjectId workspaceId FK
        string actorType
        ObjectId actorId
        string targetType
        ObjectId targetId
        string action
        string summary
        date createdAt
    }

    OUTBOX_MESSAGE {
        ObjectId _id PK
        ObjectId workspaceId FK
        string to
        string subject
        string kind
        object meta
    }

    USER o|--o{ WORKSPACE : creates
    WORKSPACE ||--o{ MEMBERSHIP : has
    USER ||--o{ MEMBERSHIP : joins
    WORKSPACE ||--o{ INVITATION : invites
    USER ||--o{ INVITATION : sends
    USER o|--o{ INVITATION : accepts
    WORKSPACE ||--o{ API_KEY : owns
    USER o|--o{ API_KEY : creates
    WORKSPACE ||--o{ CONNECTION : owns
    USER o|--o{ CONNECTION : creates
    WORKSPACE ||--o{ KNOWLEDGE_DOC : contains
    USER o|--o{ KNOWLEDGE_DOC : creates
    WORKSPACE ||--o{ WORKFLOW : contains
    USER o|--o{ WORKFLOW : creates
    USER o|--o{ WORKFLOW : updates
    USER o|--o{ WORKFLOW : publishes
    CONNECTION o|--o{ WORKFLOW : triggers
    WORKFLOW ||--o{ WORKFLOW_VERSION : versions
    USER o|--o{ WORKFLOW_VERSION : publishes
    WORKFLOW o|--o| WORKFLOW_VERSION : published_as
    WORKSPACE ||--o{ WORKFLOW_VERSION : contains
    WORKFLOW ||--o{ RUN : executes
    WORKSPACE ||--o{ RUN : contains
    USER o|--o{ RUN : triggers
    API_KEY o|--o{ RUN : starts
    WORKFLOW_VERSION o|--o{ RUN : runs_version
    RUN o|--o{ RUN : parent_of
    RUN o|--o{ RUN : root_of
    RUN o|--o{ RUN : rerun_of
    RUN o|--o{ RUN : retry_of
    WORKSPACE ||--o{ SANDBOX_RECORD : contains
    RUN o|--o{ SANDBOX_RECORD : produces
    WORKSPACE o|--o{ TEMPLATE : owns
    USER o|--o{ TEMPLATE : creates
    WORKSPACE ||--o{ USAGE_COUNTER : tracks
    WORKSPACE ||--o{ COMMENT_THREAD : contains
    WORKFLOW ||--o{ COMMENT_THREAD : has
    USER ||--o{ COMMENT_THREAD : creates
    USER o|--o{ COMMENT_THREAD : resolves
    COMMENT_THREAD ||--o{ COMMENT : contains
    WORKSPACE ||--o{ COMMENT : contains
    USER ||--o{ COMMENT : writes
    WORKSPACE ||--o{ WORKFLOW_WATCH : contains
    WORKFLOW ||--o{ WORKFLOW_WATCH : watched_by
    USER ||--o{ WORKFLOW_WATCH : watches
    WORKSPACE o|--o{ NOTIFICATION : scopes
    USER ||--o{ NOTIFICATION : receives
    USER o|--o{ NOTIFICATION : acts
    WORKSPACE ||--o{ AUDIT_EVENT : records
    WORKSPACE o|--o{ OUTBOX_MESSAGE : scopes
```

## Notes

- Fields marked `FK` are Mongoose `ref` paths except `AUDIT_EVENT.actorId` and
  `AUDIT_EVENT.targetId`, which are polymorphic IDs interpreted using
  `actorType`/`targetType`. `COMMENT.mentions` is an array of user IDs, not a
  populated `ref` path.
- `WORKFLOW.eventConnectionId` is the diagram label for
  `eventTrigger.connectionId`.
- `WORKFLOW.publishedVersionId` points to a version, while
  `WORKFLOW_VERSION.workflowId` points back to its workflow. The published
  pointer is optional and creates a cycle in the model references.
- Workflow graph nodes/edges, run node results, comment anchors, connection
  credentials, and several other nested values are embedded subdocuments or
  mixed data; they are shown as attributes rather than separate collections.
- `WORKSPACE.createdBy` is optional. A workspace's `personal` flag and
  membership lifecycle are application-level rules, not additional entity
  relationships.
