import { test, expect } from '@playwright/test';

test('session onboarding clears the password and persists only nonsecret configuration', async ({ page, request }) => {
  const original = await (await request.get('/api/v1/settings')).json() as { data: { textConfigId: string | null } };
  await page.goto('/'); await page.getByText('Text model settings', { exact: true }).click();
  await page.getByLabel('Model ID', { exact: true }).fill('browser-fixture-model');
  await page.getByLabel('Session API key').fill('browser-fixture-secret');
  const response = page.waitForResponse(response => response.url().endsWith('/provider-configurations') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save text configuration', exact: true }).click();
  const created = await response; expect(created.status()).toBe(201);
  const result = await created.json() as { data: { id: string } };
  try {
    await expect(page.getByLabel('Session API key')).toHaveValue('');
    await expect(page.getByRole('status')).toContainText('Configuration saved.');
    expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain('browser-fixture-secret');
    expect(await page.content()).not.toContain('browser-fixture-secret');
    await page.reload(); await page.getByText('Text model settings', { exact: true }).click();
    await expect(page.getByLabel('Default text configuration')).toContainText('browser-fixture-model');
    await expect(page.getByLabel('Session API key')).toHaveValue('');
  } finally {
    await request.patch('/api/v1/settings', { headers: { Origin: 'http://127.0.0.1:3101', 'Content-Type': 'application/json' }, data: { textConfigId: original.data.textConfigId } });
    await request.delete(`/api/v1/provider-configurations/${result.data.id}`, { headers: { Origin: 'http://127.0.0.1:3101', 'Content-Type': 'application/json' }, data: {} });
  }
});
