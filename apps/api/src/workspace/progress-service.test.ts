import { expect, it } from 'vitest';
import { aggregateProgress } from './progress-service.js';
it('aggregates actual leaves iteratively through deep hierarchies and handles empty courses', () => {
  expect(aggregateProgress([], new Map()).course).toEqual({ completedLeaves: 0, totalLeaves: 0 });
  const topics = Array.from({ length: 2000 }, (_, index) => ({ id: String(index), parentId: index ? String(index - 1) : null }));
  expect(aggregateProgress(topics, new Map([['1999', 'completed']])).course).toEqual({ completedLeaves: 1, totalLeaves: 1 });
  expect(aggregateProgress(topics, new Map([['0', 'completed']])).course.completedLeaves).toBe(0);
});
