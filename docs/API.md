# REST and streaming contracts

Proposed `/api/v1` interface. JSON camelCase, UUID IDs, ISO-8601 UTC timestamps, UTF-8. No API is implemented yet. Shared Zod contracts are authoritative once implemented; examples here are design pseudocode. All object schemas are strict, lengths bounded, unknown keys rejected. Validate params, query, body, response and AI results. No secret fields in response schemas.

## Shared contract vocabulary

```typescript
const Id = z.string().uuid();
const Revision = z.number().int().min(1);
const TreeRevision = z.number().int().min(0);
const Preferences = z.object({
  depth: z.enum(['introductory','intermediate','deep']),
  style: z.enum(['first_principles','step_by_step']),
  examples: z.boolean(), analogies: z.boolean(), reflectionPauses: z.boolean(),
  pace: z.enum(['self_paced','guided']),
  background: z.string().max(4000)
}).strict();
const SaveLesson = z.object({
  baseRevision: Revision, mutationId: Id,
  documentSchemaVersion: z.literal(1), document: TiptapDocumentSchema,
  aiOperationId: Id.optional(),
  imageOperationId: Id.optional()
}).strict();
const LessonResponse = z.object({
  id: Id, topicId: Id, revision: Revision, documentSchemaVersion: z.literal(1),
  document: TiptapDocumentSchema, updatedAt: z.string().datetime()
}).strict();
const ProviderInput = z.object({
  purpose: z.enum(['text','image']),
  provider: z.enum(['openai','anthropic','google','ollama']),
  modelId: z.string().min(1).max(160), options: ProviderOptionsSchema,
  credential: z.discriminatedUnion('source', [
    z.object({source:z.literal('environment'), envName:z.string().max(80)}).strict(),
    z.object({source:z.literal('session'), secret:z.string().min(1).max(4096)}).strict(),
    z.object({source:z.literal('none')}).strict()
  ])
}).strict();
```

`TiptapDocumentSchema`, `ProviderOptionsSchema`, syllabus and fragment schemas must be recursive/semantic validators described in linked designs, not `z.any()` placeholders in implementation. Environment credential names come from a server allowlist, never arbitrary environment lookup. Image purpose/provider combinations are capability-checked; the enum does not imply every provider supports images. Provider read DTO returns `credentialSource`, `configured`, effective capabilities, and safe options, never secret or session handle.

Success: `{data:T, requestId}`; lists add `page:{nextCursor:string|null}` with limit 1-100, default 50. Course tree has a bounded complete-tree response rather than misleading partial hierarchy. Creation 201, accepted work 202, updates 200, deletion 204. Operation start responds `{data:{operationId,status,eventsUrl},requestId}`. DTOs below name required fields; all optional fields are explicitly noted.

Every `baseTreeRevision` uses TreeRevision (zero is valid); lesson `baseRevision` uses Revision. PATCH requests require at least one change. DELETE bodies use origin-checked fetch, not browser navigation. Health paths in the table are relative to `/api/v1`, as are all other paths.

## Endpoints

| Method/path | Request | Response / behavior |
|---|---|---|
| GET `/health/live`, `/health/ready` | None | Process/DB/storage health; readiness 503 if unavailable |
| GET `/courses` | cursor?, limit? | Course summaries `{id,title,goal,createdAt,updatedAt,progress}` |
| POST `/courses` | `{title:1..240,goal:1..8000,preferences}` | 201 Course with treeRevision=0; no automatic AI |
| GET `/courses/:id` | None | Course detail, preferences, treeRevision |
| PATCH `/courses/:id` | `{baseTreeRevision,title?,goal?,preferences?}` | Updated Course; CAS treeRevision prevents stale metadata/context writes |
| DELETE `/courses/:id` | `{baseTreeRevision,confirm:true}` | Cascades learning records, schedules file GC; 409 EXPORT_IN_PROGRESS if a live export lease exists, otherwise 204 |
| GET `/courses/:id/tree` | None | `{treeRevision,topics:[TopicDTO],prerequisites:[EdgeDTO]}` |
| POST `/courses/:id/syllabus-generations` | `{baseTreeRevision,instruction?:1..4000}` + Idempotency-Key | 202 validated draft operation; existing tree untouched |
| POST `/courses/:id/syllabus-commits` | `{operationId,baseTreeRevision,draft:SyllabusDraft}` | 201 updated tree. Initial MVP only when course tree empty; editing existing tree uses topic APIs. No bulk destructive replacement. |
| POST `/courses/:id/topics` | `{baseTreeRevision,parentId:null|Id,title,kind,position,objectives:string[]}` | 201 TopicDTO + treeRevision |
| PATCH `/topics/:id` | `{baseTreeRevision,title?,objectives?,kind?}` | TopicDTO + treeRevision |
| POST `/courses/:id/topic-moves` | `{baseTreeRevision,topicId,newParentId:null|Id,orderedSiblingIds:Id[]}` | New treeRevision; complete destination sibling list plus moved ID; source closes gap atomically |
| PUT `/courses/:id/topic-order` | `{baseTreeRevision,parentId:null|Id,orderedSiblingIds:Id[]}` | New treeRevision; IDs must equal complete current sibling set |
| POST `/topics/:id/wrap` | `{baseTreeRevision,containerTitle}` | Explicit new container preserving original leaf/lesson identity |
| DELETE `/topics/:id` | `{baseTreeRevision,confirmSubtree:true}` | 204; UI first displays affected subtree counts |
| PUT `/topics/:id/prerequisites` | `{baseTreeRevision,prerequisiteIds:Id[]}` | Validated full dependency set + treeRevision |
| PATCH `/topics/:id/prerequisites/:prerequisiteId` | `{choice:'study'|'skip'|'undecided'}` | EdgeDTO + treeRevision; no lesson deletion |
| GET `/topics/:id/lesson` | None | LessonResponse; 404 LESSON_NOT_GENERATED with no AI call |
| POST `/topics/:id/lessons` | `{mutationId:Id,documentSchemaVersion:1,document:TiptapDocument}` | 201 manual LessonResponse at revision 1, or replay of same creation receipt; 409 LESSON_EXISTS if a different creation already won. Same course lock/leaf checks as AI creation; no AI calls. |
| POST `/topics/:id/lesson-generations` | `{instruction?:string}` + Idempotency-Key | 202 initial generation, or 200 saved LessonResponse if it already exists; duplicate active work returns same operation |
| PUT `/lessons/:id` | SaveLesson | `{id,revision,mutationId,updatedAt,contentHash}` after commit |
| POST `/lessons/:id/regenerations` | `{baseRevision,instruction?:string}` + Idempotency-Key | 202 ready proposal; saved document unchanged |
| POST `/lessons/:id/regeneration-commits` | `{operationId,baseRevision,mutationId,confirmReplace:true}` | Saved revision DTO; atomically snapshot and replace |
| GET `/lessons/:id/versions` | cursor?, limit? | Metadata only, includes current revision separately |
| GET `/lessons/:id/versions/:revision` | None | JSON, schema version, metadata; current revision supported |
| POST `/lessons/:id/restores` | `{sourceRevision,baseRevision,mutationId,confirm:true}` | Saved revision DTO; new revision |
| POST `/lessons/:id/edits` | EditRequest below + Idempotency-Key | 202 proposal operation |
| POST `/operations/:id/rejections` | `{}` | Rejected operation; idempotent |
| GET `/lessons/:id/messages` | cursor?, limit? | Ordered ChatMessage DTOs with status, turnId, contextRevision |
| POST `/lessons/:id/chat-turns` | `{baseRevision,message:1..16000,clientTurnId:Id,selectedBlockIds?:Id[]}` + Idempotency-Key | 202; requires saved revision; one active turn per lesson |
| PATCH `/topics/:id/progress` | `{status:'not_started'|'in_progress'|'completed'}` | Leaf only; status + completedAt. Container totals computed from leaves, not independently writable. |
| GET `/courses/:id/progress` | None | `{completedLeaves,totalLeaves,topics:[...]}` |
| GET `/settings`, PATCH `/settings` | Patch `{preferences?,textConfigId?,imageConfigId?}` | Nonsecret workspace defaults; null may clear default |
| GET `/provider-configurations` | None | Nonsecret config DTOs and capabilities |
| POST `/provider-configurations` | ProviderInput | 201 nonsecret config; secret stored session-only if supplied |
| PUT `/provider-configurations/:id` | ProviderInput plus `{baseConfigRevision:Revision}` | Updated nonsecret config; running operations retain snapshots |
| DELETE `/provider-configurations/:id` | None | 204, defaults cleared; learning content retained |
| POST `/provider-configurations/:id/test` | `{capability?:'text'|'structured'|'image'}` | Bounded test result `{ok,latencyMs,capabilities,warnings}`; test may incur provider cost, image test requires explicit capability choice |
| POST `/courses/:id/assets` | Multipart `file`, `alt?` | 201 AssetDTO `{id,mimeType,bytes,width,height,url,alt?}` |
| GET `/assets/:id/content` | None | Validated MIME, immutable asset bytes, nosniff |
| DELETE `/assets/:id` | None | 204 if unreferenced by lessons, versions, ready proposals or live exports; otherwise 409 ASSET_IN_USE |
| POST `/courses/:id/image-generations` | `{prompt:1..4000,lessonId?:Id}` + Idempotency-Key | 202 image asset proposal; does not edit a document |
| GET `/operations/:id` | None | Safe operation status, result/proposal or durable result reference, sanitized error |
| GET `/operations/:id/events` | Last-Event-ID? | SSE status/delta/final protocol below |
| POST `/operations/:id/cancel` | `{}` | Cancellation status; completion may already have won, reported truthfully |
| GET `/courses/:id/export?format=markdown|docx` | format required | Stream ZIP with Content-Disposition; no AI. Also sets X-Export-Id. |

TopicDTO: `{id,courseId,parentId,title,kind,position,objectives,isLeaf,lessonId?:Id}`. EdgeDTO: `{topicId,prerequisiteId,choice}`. Course summaries omit documents. Message content is plain text; insertion requires conversion into safe editor blocks. Operations use model config defaults resolved server-side, never client-supplied provider keys on lesson endpoints.

## Selection edit schema

```typescript
const EditRequest = z.object({
  baseRevision: Revision,
  action: z.enum(['explain','simplify','expand','rewrite','example','analogy','custom']),
  mode: z.enum(['replace','insert_after']),
  instruction: z.string().max(4000).optional(),
  target: z.object({
    from:z.number().int().min(0), to:z.number().int().min(0),
    startBlockId:Id, endBlockId:Id, sliceHash:z.string().regex(/^[a-f0-9]{64}$/)
  }).strict()
}).strict();
```

Server derives selected slice and context from saved JSON rather than trusting text/offset claims. Enforce `to>from`, supported selection shapes, matching hash, current revision and action/mode pairing. Insert-after anchors at the end of the final selected text block; the server derives its block ID/boundary. Result: `{operationId,baseRevision,targetHash,mode,fragment:ValidatedFragment,explanation?:string}`. The model never generates target metadata.

Acceptance uses a single `PUT /lessons/:id` with `aiOperationId`, not a separate acceptance-claim endpoint. The request must contain exactly the server-validated proposal applied to its captured base document. The server reconstructs the expected targeted transformation and compares canonical JSON hashes, then atomically checks ready status/base revision, saves, snapshots and marks applied. Additional typing is excluded from this isolated save; see the editor commit barrier. Ordinary later saves omit aiOperationId. Cancellation/rejection racing acceptance is resolved by the same operation-row lock. Duplicate acceptance replays the mutation receipt.

Image insertion uses `imageOperationId` instead of aiOperationId (mutually exclusive). It verifies a ready image operation in the same course and its ready asset appears in the submitted document, then marks applied atomically with saving. Cursor/sequence checks are browser-owned because image generation does not modify document positions. Upload/chat insertion needs neither operation field. Server still validates the full JSON, assets and expected revision for every save. Missing/deleted image assets return 409 ASSET_UNAVAILABLE without discarding local notes.

Initial lesson start is triggered only by opening an ungenerated leaf and choosing Generate. GET, syllabus generation, prefetch, container expansion and export never initiate generation. Users may choose a blank manual lesson instead; it also prevents generation from overwriting it.

Syllabus commit deduplicates by operation ID and canonical draft hash: same operation/body returns the committed tree reference; a different draft after application returns 409. The initial operation records baseTreeRevision; generation/commit cannot silently adopt changed goals or tree metadata. Provider config reads include an integer `revision`; PUT requires `baseConfigRevision` in addition to ProviderInput and increments it. Settings references must match text/image purpose. Session secrets are submitted only on config create/update, and are cleared from the form after submission.

## SSE design

Start AI work with POST then subscribe with GET; requests always include local origin protections. Event types: `status`, `delta`, `ready`, `done`, `error`, `cancelled`, with JSON data `{operationId,sequence,...}`. `delta` contains provisional text only. `ready` includes validated proposal or fetch reference; `done` follows durable commit and includes lesson/message/asset reference. `error` is terminal even though HTTP headers may already be 200. Heartbeat comment every 15 seconds; disable response buffering and use `text/event-stream`, `Cache-Control:no-cache`.

Keep a bounded in-memory delta buffer; event IDs are monotonic per operation execution. Status/result is durable, token history is not. On reconnect outside buffer or after restart emit `status` with `reset:true`; client discards provisional text and loads durable result/status. Do not claim exact token replay. Polling GET operation is fallback. Provider without streaming emits statuses then complete result. Client disconnect leaves operation running until explicit cancel or timeout; no automatic duplicate POST.

## Errors, limits, and idempotency

Error envelope: `{error:{code,message,retryable,details?},requestId}`. Details are allowlisted field errors/current revision, not stack traces, request bodies, provider raw errors, paths, keys, or prompts. Frontend keeps unsaved JSON on any error. 400 malformed JSON; 413 size; 415 MIME; 422 validation/unsupported capability; 404 missing record; 409 revision conflict/active turn/changed idempotency body; 429 local/provider rate limit; 502 provider invalid response/failure; 503 DB/provider unavailable; 504 timeout; 500 internal failure. Invalid upstream key maps to 422 PROVIDER_AUTH_FAILED (not application-user 401). Unknown model maps 422 MODEL_UNAVAILABLE. Include Retry-After when meaningful.

Idempotency-Key is a UUID required on operation starts. Unique scope+key and canonical body hash deduplicate retries; mismatch is 409 IDEMPOTENCY_MISMATCH. Operation creation is durable before dispatch. Same key never reruns a failed provider call; explicit retry uses a new key and links to the prior operation. Text requests have 120-second default deadline, images 180 seconds, overridable with bounds. Proposed limits: document 2 MiB/20,000 nodes, course 2,000 topics, tree traversal 2,000 nodes, selection 12,000 characters, context 12,000 tokens subject to model budget, upload 10 MiB/25 megapixels, 2 active provider calls globally, 1 initial-generation per topic and 1 chat turn per lesson. No fixed semantic nesting depth, but reject pathological serialized recursion with a documented parser safety limit (128 structural levels initially). Export cap 250 MiB uncompressed, configurable. Enforce limits before provider costs/file allocation.

Operation starts may include `retryOfOperationId?:Id` (same kind and owner scope required). Chat retry must reuse clientTurnId and exact message/baseRevision to reuse the existing failed user turn; changed content/context starts a new clientTurnId. Reject retry while the prior turn is active or completed. Stable idempotency scopes are `<kind>:<ownerId>` even for edit proposals; only generation/chat kinds are subject to the active-scope unique constraint. Enforce the global concurrency cap before reserving work and return 429 instead of adding an unbounded queue. A newly created initial lesson operation captures current treeRevision server-side; leaf/goal/objective changes before finalization cause STALE_CONTEXT, not a silently outdated lesson.

## Contract verification

Test schema fixtures, status codes, no secret response fields, body limits, exact Origin/Host handling, CAS and idempotency races, stale operation finalization, SSE disconnect/reset/cancel, midstream errors, and ZIP headers. OpenAPI generation may be added after contracts stabilize; do not introduce another parallel hand-maintained schema.
