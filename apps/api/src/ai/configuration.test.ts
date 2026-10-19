import { expect, it } from 'vitest';
import { SessionCredentials } from './configuration.js';

it('expires session credentials and invalidates prior configuration revisions', () => {
  let now = 0; const secrets = new SessionCredentials(() => now);
  secrets.put('config', 1, 'fixture-only'); expect(secrets.get('config', 1)).toBe('fixture-only');
  secrets.put('config', 2, 'replacement'); expect(secrets.get('config', 1)).toBeUndefined();
  now += 8 * 60 * 60 * 1000; expect(secrets.get('config', 2)).toBeUndefined();
  secrets.put('config', 3, 'new'); secrets.clear(); expect(secrets.get('config', 3)).toBeUndefined();
});
