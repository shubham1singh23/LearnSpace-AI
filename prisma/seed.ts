import { pathToFileURL } from 'node:url';
import { defaultPreferences } from '@learnspace/shared';
import { createDatabase, type Database } from '../apps/api/src/db.js';
import { loadEnvironment } from '../apps/api/src/config.js';

export const sampleCourseId = 'aa000000-0000-4000-8000-000000000001';
const moduleId = 'aa000000-0000-4000-8000-000000000002';
const topicId = 'aa000000-0000-4000-8000-000000000003';
const firstLeafId = 'aa000000-0000-4000-8000-000000000004';
const secondLeafId = 'aa000000-0000-4000-8000-000000000005';

export async function seedSample(db: Database): Promise<void> {
  // Insert only. Re-running never rewrites the learner's existing sample course/notes.
  await db.$transaction(async tx => {
    await tx.workspaceSettings.upsert({ where: { id: 1 }, create: { id: 1, preferences: defaultPreferences }, update: {} });
    if (await tx.course.findUnique({ where: { id: sampleCourseId } })) return;
    await tx.course.create({ data: { id: sampleCourseId, title: 'Explore generative AI', goal: 'Understand generative AI from first principles.', preferences: defaultPreferences } });
    await tx.topic.create({ data: { id: moduleId, courseId: sampleCourseId, parentId: null, title: 'Foundations', kind: 'module', position: 0, objectives: ['Build the prerequisite vocabulary.'] } });
    await tx.topic.create({ data: { id: topicId, courseId: sampleCourseId, parentId: moduleId, title: 'Language model basics', kind: 'topic', position: 0, objectives: ['Connect input representations to model predictions.'] } });
    await tx.topic.createMany({ data: [
      { id: firstLeafId, courseId: sampleCourseId, parentId: topicId, title: 'Tokens', kind: 'subtopic', position: 0, objectives: ['Describe the purpose of tokens.'] },
      { id: secondLeafId, courseId: sampleCourseId, parentId: topicId, title: 'Next-token prediction', kind: 'subtopic', position: 1, objectives: ['Explain a prediction task.'] }
    ] });
    await tx.topicPrerequisite.create({ data: { topicId: secondLeafId, prerequisiteId: firstLeafId, courseId: sampleCourseId } });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = createDatabase(loadEnvironment().DATABASE_URL);
  try { await seedSample(db); console.info('Sample hierarchy is ready. No lesson content was generated or changed.'); }
  catch { console.error('Seed failed. Check the database and applied migrations.'); process.exitCode = 1; }
  finally { await db.$disconnect(); }
}
