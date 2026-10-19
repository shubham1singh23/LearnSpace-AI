import type { Database } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';
import { HttpError } from '../errors.js';

export type Transaction = Prisma.TransactionClient;
export async function lockCourse(tx: Transaction, courseId: string, revision?: number) {
  await tx.$queryRaw`SELECT id FROM courses WHERE id = ${courseId}::uuid FOR UPDATE`;
  const course = await tx.course.findUnique({ where: { id: courseId } });
  if (!course) throw new HttpError(404, 'NOT_FOUND', 'Course not found.');
  if (revision !== undefined && course.treeRevision !== revision) throw new HttpError(409, 'TREE_REVISION_CONFLICT', 'The course changed. Reload its tree.', false, { currentTreeRevision: course.treeRevision });
  return course;
}
export async function transaction<T>(db: Database, work: (tx: Transaction) => Promise<T>) {
  try { return await db.$transaction(work, { timeout: 15000 }); }
  catch (error) {
    if (error instanceof HttpError) throw error;
    if (error && typeof error === 'object' && 'code' in error) {
      if (['P2002', 'P2003', 'P2004', 'P2010'].includes(String(error.code))) throw new HttpError(409, 'INVARIANT_CONFLICT', 'The change violates a data constraint. Reload and review the tree.');
      if (error.code === 'P2025') throw new HttpError(404, 'NOT_FOUND', 'Record not found.');
      if (['P1001', 'P1002', 'P1017', 'P2024', 'P2028', 'P2034'].includes(String(error.code))) throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Database unavailable. Retry the same request.', true);
    }
    throw error;
  }
}
