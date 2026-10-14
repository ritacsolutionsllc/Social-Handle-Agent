import { expect, test } from '@playwright/test';
import { csrf, login, runCheck } from './helpers';

test('mock vertical slice: input → report → alternatives → plan preview (creation disabled)', async ({ page }) => {
  await login(page, 'disabled');
  await expect(page.getByText('Mock provider · simulated')).toBeVisible();
  await expect(page.getByText('Account creation disabled')).toBeVisible();

  const checkId = await runCheck(page);

  // Simulated results are clearly labelled, never presented as real checks.
  await expect(page.getByTestId('simulated-banner')).toContainText('No social platform was contacted');
  await expect(page.getByTestId('row-x')).toContainText('Taken');
  await expect(page.getByTestId('row-x')).toContainText('sim');
  await expect(page.getByTestId('row-facebook')).toContainText('Unknown');
  await expect(page.getByText(/do not reserve a handle/)).toBeVisible();

  // Recommendation + ranked alternatives
  await expect(page.getByTestId('recommendation')).toContainText('@acmeroboticshq');
  await expect(page.getByTestId('candidate-acmeroboticshq')).toContainText('Selected');
  await expect(page.getByTestId('candidate-acme_robotics')).toBeVisible();

  await page.getByRole('button', { name: 'Review creation plan →' }).click();
  await expect(page).toHaveURL(new RegExp(`/checks/${checkId}/plan\\?handle=acmeroboticshq`));
  await expect(page.getByText('Preview only — account creation is disabled on this server')).toBeVisible();
  await expect(page.getByTestId('plan-threads')).toContainText('inherited from instagram');

  // Even with every confirmation ticked, the server-side switch keeps Create disabled.
  for (const box of await page.locator('[data-testid^="confirm-"]').all()) await box.check();
  await page.getByTestId('ack').check();
  await expect(page.getByTestId('create')).toBeDisabled();
});

test('server rejects job creation before enqueueing when disabled', async ({ page }) => {
  await login(page, 'disabled-api');
  const checkId = await runCheck(page);
  const res = await page.request.post('/api/creation-jobs', {
    headers: { 'x-csrf-token': await csrf(page), origin: new URL(page.url()).origin },
    data: { checkId, handle: 'acmeroboticshq', platforms: ['reddit'], confirmedPlatforms: ['reddit'], acknowledgedTerms: true },
  });
  expect(res.status()).toBe(403);
  expect((await res.json()).error.code).toBe('feature_disabled');
  const jobs = await (await page.request.get('/api/creation-jobs')).json();
  expect(jobs.jobs).toEqual([]);
});

test('unauthenticated users are redirected to login and API returns 401', async ({ page }) => {
  await page.goto('/jobs');
  await expect(page).toHaveURL(/\/login$/);
  const res = await page.request.post('/api/check', { data: { input: 'Acme' } });
  expect(res.status()).toBe(401);
});
