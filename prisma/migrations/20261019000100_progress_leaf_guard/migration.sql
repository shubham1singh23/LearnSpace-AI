-- Preserve every existing row. Abort for explicit owner review if invalid data exists.
BEGIN;
LOCK TABLE topics, learning_progress IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM learning_progress p JOIN topics t ON t."parentId" = p."topicId") THEN
    RAISE EXCEPTION 'Existing progress belongs to a container; review data before migration' USING ERRCODE = '23514';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION validate_topic_tree() RETURNS trigger LANGUAGE plpgsql AS $$
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
    IF EXISTS (SELECT 1 FROM lessons WHERE "topicId" = NEW."parentId") OR EXISTS (SELECT 1 FROM learning_progress WHERE "topicId" = NEW."parentId") THEN
      RAISE EXCEPTION 'Lesson or progress owner must remain a leaf; use explicit wrap' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
COMMIT;
