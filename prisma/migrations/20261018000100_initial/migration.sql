-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "goal" TEXT NOT NULL,
    "preferences" JSONB NOT NULL,
    "treeRevision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topics" (
    "id" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "parentId" UUID,
    "title" VARCHAR(240) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "position" INTEGER NOT NULL,
    "objectives" JSONB NOT NULL,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topic_prerequisites" (
    "topicId" UUID NOT NULL,
    "prerequisiteId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "choice" VARCHAR(20) NOT NULL DEFAULT 'undecided',

    CONSTRAINT "topic_prerequisites_pkey" PRIMARY KEY ("topicId","prerequisiteId")
);

-- CreateTable
CREATE TABLE "lessons" (
    "id" UUID NOT NULL,
    "topicId" UUID NOT NULL,
    "document" JSONB NOT NULL,
    "documentSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "contentHash" VARCHAR(64) NOT NULL,
    "source" VARCHAR(30) NOT NULL DEFAULT 'manual',
    "operationId" UUID,
    "restoredFromRevision" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" UUID NOT NULL,
    "lessonId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "documentSchemaVersion" INTEGER NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "source" VARCHAR(30) NOT NULL,
    "operationId" UUID,
    "restoredFromRevision" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_mutations" (
    "lessonId" UUID NOT NULL,
    "mutationId" UUID NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "resultingRevision" INTEGER NOT NULL,
    "resultingUpdatedAt" TIMESTAMP(3) NOT NULL,
    "resultingContentHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_mutations_pkey" PRIMARY KEY ("lessonId","mutationId")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "lessonId" UUID NOT NULL,
    "role" VARCHAR(16) NOT NULL,
    "content" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "turnId" UUID NOT NULL,
    "operationId" UUID,
    "status" VARCHAR(20) NOT NULL,
    "contextRevision" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_progress" (
    "topicId" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'not_started',
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_progress_pkey" PRIMARY KEY ("topicId")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "storageKey" VARCHAR(200) NOT NULL,
    "originalName" VARCHAR(240) NOT NULL,
    "mimeType" VARCHAR(80) NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "state" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_assets" (
    "lessonId" UUID NOT NULL,
    "assetId" UUID NOT NULL,

    CONSTRAINT "lesson_assets_pkey" PRIMARY KEY ("lessonId","assetId")
);

-- CreateTable
CREATE TABLE "version_assets" (
    "versionId" UUID NOT NULL,
    "assetId" UUID NOT NULL,

    CONSTRAINT "version_assets_pkey" PRIMARY KEY ("versionId","assetId")
);

-- CreateTable
CREATE TABLE "ai_operations" (
    "id" UUID NOT NULL,
    "courseId" UUID,
    "topicId" UUID,
    "lessonId" UUID,
    "providerConfigId" UUID,
    "kind" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "scopeKey" VARCHAR(200) NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "baseRevision" INTEGER,
    "baseTreeRevision" INTEGER,
    "retryOfOperationId" UUID,
    "target" JSONB,
    "contextManifest" JSONB,
    "result" JSONB,
    "modelSnapshot" JSONB NOT NULL,
    "promptVersion" VARCHAR(40) NOT NULL,
    "ownerToken" UUID,
    "leaseUntil" TIMESTAMP(3),
    "errorCode" VARCHAR(60),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_provider_configurations" (
    "id" UUID NOT NULL,
    "purpose" VARCHAR(16) NOT NULL,
    "provider" VARCHAR(30) NOT NULL,
    "modelId" VARCHAR(160) NOT NULL,
    "options" JSONB NOT NULL,
    "credentialSource" VARCHAR(16) NOT NULL,
    "credentialEnvName" VARCHAR(80),
    "capabilities" JSONB NOT NULL,
    "registryVersion" VARCHAR(40) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provider_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "preferences" JSONB NOT NULL,
    "textConfigId" UUID,
    "imageConfigId" UUID,

    CONSTRAINT "workspace_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_usage" (
    "id" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "provider" VARCHAR(30) NOT NULL,
    "modelId" VARCHAR(160) NOT NULL,
    "attempt" INTEGER NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER NOT NULL,
    "outcome" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_leases" (
    "id" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "ownerToken" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_leases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_assets" (
    "leaseId" UUID NOT NULL,
    "assetId" UUID NOT NULL,

    CONSTRAINT "export_assets_pkey" PRIMARY KEY ("leaseId","assetId")
);

-- CreateIndex
CREATE INDEX "topics_courseId_parentId_position_idx" ON "topics"("courseId", "parentId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "topics_id_courseId_key" ON "topics"("id", "courseId");

-- CreateIndex
CREATE INDEX "topic_prerequisites_prerequisiteId_idx" ON "topic_prerequisites"("prerequisiteId");

-- CreateIndex
CREATE UNIQUE INDEX "lessons_topicId_key" ON "lessons"("topicId");

-- CreateIndex
CREATE INDEX "document_versions_lessonId_createdAt_idx" ON "document_versions"("lessonId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_lessonId_revision_key" ON "document_versions"("lessonId", "revision");

-- CreateIndex
CREATE INDEX "chat_messages_lessonId_createdAt_idx" ON "chat_messages"("lessonId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_lessonId_sequence_key" ON "chat_messages"("lessonId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_turnId_role_key" ON "chat_messages"("turnId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "assets_storageKey_key" ON "assets"("storageKey");

-- CreateIndex
CREATE INDEX "assets_courseId_state_idx" ON "assets"("courseId", "state");

-- CreateIndex
CREATE INDEX "lesson_assets_assetId_idx" ON "lesson_assets"("assetId");

-- CreateIndex
CREATE INDEX "version_assets_assetId_idx" ON "version_assets"("assetId");

-- CreateIndex
CREATE INDEX "ai_operations_courseId_idx" ON "ai_operations"("courseId");

-- CreateIndex
CREATE INDEX "ai_operations_topicId_idx" ON "ai_operations"("topicId");

-- CreateIndex
CREATE INDEX "ai_operations_providerConfigId_idx" ON "ai_operations"("providerConfigId");

-- CreateIndex
CREATE INDEX "ai_operations_retryOfOperationId_idx" ON "ai_operations"("retryOfOperationId");

-- CreateIndex
CREATE INDEX "ai_operations_status_leaseUntil_idx" ON "ai_operations"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "ai_operations_lessonId_createdAt_idx" ON "ai_operations"("lessonId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_operations_scopeKey_idempotencyKey_key" ON "ai_operations"("scopeKey", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "model_usage_operationId_attempt_key" ON "model_usage"("operationId", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "export_leases_courseId_key" ON "export_leases"("courseId");

-- CreateIndex
CREATE INDEX "export_leases_expiresAt_idx" ON "export_leases"("expiresAt");

-- CreateIndex
CREATE INDEX "export_assets_assetId_idx" ON "export_assets"("assetId");

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topics_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topics_parentId_courseId_fkey" FOREIGN KEY ("parentId", "courseId") REFERENCES "topics"("id", "courseId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic_prerequisites" ADD CONSTRAINT "topic_prerequisites_topicId_courseId_fkey" FOREIGN KEY ("topicId", "courseId") REFERENCES "topics"("id", "courseId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic_prerequisites" ADD CONSTRAINT "topic_prerequisites_prerequisiteId_courseId_fkey" FOREIGN KEY ("prerequisiteId", "courseId") REFERENCES "topics"("id", "courseId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "ai_operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "ai_operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_mutations" ADD CONSTRAINT "lesson_mutations_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "ai_operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_progress" ADD CONSTRAINT "learning_progress_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_assets" ADD CONSTRAINT "lesson_assets_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_assets" ADD CONSTRAINT "lesson_assets_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "version_assets" ADD CONSTRAINT "version_assets_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "version_assets" ADD CONSTRAINT "version_assets_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_providerConfigId_fkey" FOREIGN KEY ("providerConfigId") REFERENCES "ai_provider_configurations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_retryOfOperationId_fkey" FOREIGN KEY ("retryOfOperationId") REFERENCES "ai_operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_textConfigId_fkey" FOREIGN KEY ("textConfigId") REFERENCES "ai_provider_configurations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_imageConfigId_fkey" FOREIGN KEY ("imageConfigId") REFERENCES "ai_provider_configurations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_usage" ADD CONSTRAINT "model_usage_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "ai_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_leases" ADD CONSTRAINT "export_leases_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_assets" ADD CONSTRAINT "export_assets_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "export_leases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_assets" ADD CONSTRAINT "export_assets_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reviewed PostgreSQL invariants not expressible in the Prisma schema.
CREATE UNIQUE INDEX topics_child_position_unique ON topics ("courseId", "parentId", position) WHERE "parentId" IS NOT NULL;
CREATE UNIQUE INDEX topics_root_position_unique ON topics ("courseId", position) WHERE "parentId" IS NULL;
CREATE UNIQUE INDEX ai_operations_active_scope_unique ON ai_operations ("scopeKey")
  WHERE status IN ('pending', 'running') AND kind IN ('initial_lesson', 'chat');

ALTER TABLE courses ADD CONSTRAINT courses_valid CHECK ("treeRevision" >= 0 AND length(trim(title)) > 0 AND length(goal) BETWEEN 1 AND 8000 AND jsonb_typeof(preferences) = 'object');
ALTER TABLE topics ADD CONSTRAINT topics_valid CHECK (position >= 0 AND "parentId" IS DISTINCT FROM id AND kind IN ('module','topic','subtopic') AND length(trim(title)) > 0 AND jsonb_typeof(objectives) = 'array');
ALTER TABLE topic_prerequisites ADD CONSTRAINT prerequisites_valid CHECK ("topicId" <> "prerequisiteId" AND choice IN ('undecided','study','skip'));
ALTER TABLE lessons ADD CONSTRAINT lessons_valid CHECK (
  revision >= 1 AND "documentSchemaVersion" >= 1 AND "contentHash" ~ '^[a-f0-9]{64}$'
  AND source IN ('manual','initial_ai','ai_edit','regenerate','restore')
  AND jsonb_typeof(document) = 'object' AND document ? 'type' AND document->>'type' = 'doc'
  AND document ? 'content' AND jsonb_typeof(document->'content') = 'array'
  AND ("restoredFromRevision" IS NULL OR "restoredFromRevision" >= 1)
);
ALTER TABLE document_versions ADD CONSTRAINT versions_valid CHECK (
  revision >= 1 AND "documentSchemaVersion" >= 1 AND "contentHash" ~ '^[a-f0-9]{64}$'
  AND source IN ('manual','initial_ai','ai_edit','regenerate','restore')
  AND jsonb_typeof(document) = 'object' AND document ? 'type' AND document->>'type' = 'doc'
  AND document ? 'content' AND jsonb_typeof(document->'content') = 'array'
  AND ("restoredFromRevision" IS NULL OR "restoredFromRevision" >= 1)
);
ALTER TABLE lesson_mutations ADD CONSTRAINT mutations_valid CHECK ("resultingRevision" >= 1 AND "requestHash" ~ '^[a-f0-9]{64}$' AND "resultingContentHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE learning_progress ADD CONSTRAINT progress_valid CHECK (status IN ('not_started','in_progress','completed') AND ((status = 'completed') = ("completedAt" IS NOT NULL)));
ALTER TABLE chat_messages ADD CONSTRAINT messages_valid CHECK (role IN ('user','assistant') AND status IN ('pending','completed','failed','interrupted','cancelled') AND sequence >= 0 AND ("contextRevision" IS NULL OR "contextRevision" >= 1));
ALTER TABLE assets ADD CONSTRAINT assets_valid CHECK (bytes > 0 AND width > 0 AND height > 0 AND sha256 ~ '^[a-f0-9]{64}$' AND "mimeType" IN ('image/png','image/jpeg','image/webp') AND source IN ('upload','generated') AND state IN ('staged','ready') AND "storageKey" ~ '^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$');
ALTER TABLE ai_operations ADD CONSTRAINT operations_valid CHECK (
  kind IN ('syllabus','initial_lesson','regeneration','edit','chat','image')
  AND status IN ('pending','running','ready','applied','rejected','failed','cancelled','interrupted','expired')
  AND "requestHash" ~ '^[a-f0-9]{64}$'
  AND ("baseRevision" IS NULL OR "baseRevision" >= 1) AND ("baseTreeRevision" IS NULL OR "baseTreeRevision" >= 0)
  AND "retryOfOperationId" IS DISTINCT FROM id
);
ALTER TABLE ai_provider_configurations ADD CONSTRAINT provider_config_valid CHECK (
  purpose IN ('text','image') AND provider IN ('openai','anthropic','google','ollama') AND revision >= 1 AND length(trim("modelId")) > 0
  AND "credentialSource" IN ('environment','session','none')
  AND (("credentialSource" = 'environment' AND "credentialEnvName" IN ('OPENAI_API_KEY','ANTHROPIC_API_KEY','GOOGLE_API_KEY')) OR ("credentialSource" <> 'environment' AND "credentialEnvName" IS NULL))
  AND jsonb_typeof(options) = 'object' AND options - ARRAY['temperature','maxOutputTokens','timeoutMs','baseUrl'] = '{}'::jsonb
);
ALTER TABLE workspace_settings ADD CONSTRAINT settings_valid CHECK (id = 1 AND jsonb_typeof(preferences) = 'object');
ALTER TABLE model_usage ADD CONSTRAINT usage_valid CHECK (attempt >= 1 AND "durationMs" >= 0 AND ("inputTokens" IS NULL OR "inputTokens" >= 0) AND ("outputTokens" IS NULL OR "outputTokens" >= 0) AND outcome IN ('success','failed','cancelled','interrupted') AND provider IN ('openai','anthropic','google','ollama'));

-- Serialize structural validation by the course row, including direct seed/test writes.
CREATE FUNCTION validate_topic_tree() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM courses WHERE id = NEW."courseId" FOR UPDATE;
  IF TG_OP = 'UPDATE' AND NEW."courseId" <> OLD."courseId" THEN
    RAISE EXCEPTION 'Topic course cannot change' USING ERRCODE = '23514';
  END IF;
  IF NEW."parentId" IS NOT NULL THEN
    IF EXISTS (
      WITH RECURSIVE ancestors AS (
        SELECT id, "parentId" FROM topics WHERE id = NEW."parentId"
        UNION
        SELECT t.id, t."parentId" FROM topics t JOIN ancestors a ON t.id = a."parentId"
      ) SELECT 1 FROM ancestors WHERE id = NEW.id
    ) THEN RAISE EXCEPTION 'Topic hierarchy cycle' USING ERRCODE = '23514'; END IF;
    IF EXISTS (SELECT 1 FROM lessons WHERE "topicId" = NEW."parentId") THEN
      RAISE EXCEPTION 'Lesson owner must remain a leaf; use explicit wrap' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER topics_tree_guard BEFORE INSERT OR UPDATE OF "parentId", "courseId" ON topics FOR EACH ROW EXECUTE FUNCTION validate_topic_tree();

CREATE FUNCTION validate_prerequisite_graph() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM courses WHERE id = NEW."courseId" FOR UPDATE;
  IF EXISTS (
    WITH RECURSIVE dependencies AS (
      SELECT NEW."prerequisiteId" AS id
      UNION
      SELECT p."prerequisiteId" FROM topic_prerequisites p JOIN dependencies d ON p."topicId" = d.id
      WHERE p."courseId" = NEW."courseId"
    ) SELECT 1 FROM dependencies WHERE id = NEW."topicId"
  ) THEN RAISE EXCEPTION 'Prerequisite cycle' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER prerequisites_graph_guard BEFORE INSERT OR UPDATE ON topic_prerequisites FOR EACH ROW EXECUTE FUNCTION validate_prerequisite_graph();

CREATE FUNCTION validate_leaf_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_course uuid;
BEGIN
  SELECT "courseId" INTO owner_course FROM topics WHERE id = NEW."topicId";
  PERFORM 1 FROM courses WHERE id = owner_course FOR UPDATE;
  IF EXISTS (SELECT 1 FROM topics WHERE "parentId" = NEW."topicId") THEN
    RAISE EXCEPTION 'Only leaf topics own lessons or explicit progress' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lesson_leaf_guard BEFORE INSERT OR UPDATE OF "topicId" ON lessons FOR EACH ROW EXECUTE FUNCTION validate_leaf_owner();
CREATE TRIGGER progress_leaf_guard BEFORE INSERT OR UPDATE OF "topicId" ON learning_progress FOR EACH ROW EXECUTE FUNCTION validate_leaf_owner();

CREATE FUNCTION validate_asset_course() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_course uuid; asset_course uuid;
BEGIN
  SELECT "courseId" INTO asset_course FROM assets WHERE id = NEW."assetId";
  IF TG_TABLE_NAME = 'lesson_assets' THEN
    SELECT t."courseId" INTO owner_course FROM lessons l JOIN topics t ON t.id = l."topicId" WHERE l.id = NEW."lessonId";
  ELSIF TG_TABLE_NAME = 'version_assets' THEN
    SELECT t."courseId" INTO owner_course FROM document_versions v JOIN lessons l ON l.id = v."lessonId" JOIN topics t ON t.id = l."topicId" WHERE v.id = NEW."versionId";
  ELSE
    SELECT "courseId" INTO owner_course FROM export_leases WHERE id = NEW."leaseId";
  END IF;
  IF owner_course IS DISTINCT FROM asset_course THEN RAISE EXCEPTION 'Cross-course asset reference' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lesson_asset_course_guard BEFORE INSERT OR UPDATE ON lesson_assets FOR EACH ROW EXECUTE FUNCTION validate_asset_course();
CREATE TRIGGER version_asset_course_guard BEFORE INSERT OR UPDATE ON version_assets FOR EACH ROW EXECUTE FUNCTION validate_asset_course();
CREATE TRIGGER export_asset_course_guard BEFORE INSERT OR UPDATE ON export_assets FOR EACH ROW EXECUTE FUNCTION validate_asset_course();

CREATE FUNCTION validate_operation_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE topic_course uuid; lesson_course uuid; lesson_topic uuid;
BEGIN
  SELECT "courseId" INTO topic_course FROM topics WHERE id = NEW."topicId";
  SELECT t."courseId", t.id INTO lesson_course, lesson_topic FROM lessons l JOIN topics t ON t.id = l."topicId" WHERE l.id = NEW."lessonId";
  IF (NEW."courseId" IS NOT NULL AND topic_course IS NOT NULL AND NEW."courseId" <> topic_course)
    OR (NEW."courseId" IS NOT NULL AND lesson_course IS NOT NULL AND NEW."courseId" <> lesson_course)
    OR (NEW."topicId" IS NOT NULL AND lesson_topic IS NOT NULL AND NEW."topicId" <> lesson_topic) THEN
    RAISE EXCEPTION 'Operation scopes disagree' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER operation_scope_guard BEFORE INSERT OR UPDATE OF "courseId", "topicId", "lessonId" ON ai_operations FOR EACH ROW EXECUTE FUNCTION validate_operation_scope();

CREATE FUNCTION validate_default_purpose() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."textConfigId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ai_provider_configurations WHERE id = NEW."textConfigId" AND purpose = 'text') THEN
    RAISE EXCEPTION 'Text default requires text configuration' USING ERRCODE = '23514';
  END IF;
  IF NEW."imageConfigId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ai_provider_configurations WHERE id = NEW."imageConfigId" AND purpose = 'image') THEN
    RAISE EXCEPTION 'Image default requires image configuration' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER settings_purpose_guard BEFORE INSERT OR UPDATE ON workspace_settings FOR EACH ROW EXECUTE FUNCTION validate_default_purpose();
CREATE FUNCTION guard_provider_purpose() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.purpose <> OLD.purpose AND EXISTS (SELECT 1 FROM workspace_settings WHERE "textConfigId" = OLD.id OR "imageConfigId" = OLD.id) THEN
    RAISE EXCEPTION 'Referenced provider purpose cannot change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER provider_purpose_guard BEFORE UPDATE OF purpose ON ai_provider_configurations FOR EACH ROW EXECUTE FUNCTION guard_provider_purpose();
