import { expect, test } from '@playwright/test';
import { login, runCheck } from './helpers';

test('enabled: explicit per-platform confirmation → guided manual jobs → dashboard actions', async ({ page }) => {
  await login(page, 'enabled');
  const checkId = await runCheck(page);
  await page.goto(`/checks/${checkId}/plan?handle=acmeroboticshq&platforms=reddit,facebook`);

  const create = page.getByTestId('create');
  await expect(create).toBeDisabled();
  await page.getByTestId('confirm-reddit').check();
  await page.getByTestId('ack').check();
  await expect(create).toBeDisabled(); // facebook still unconfirmed
  await page.getByTestId('confirm-facebook').check();
  await expect(create).toBeEnabled();
  await create.click();

  await expect(page).toHaveURL(/\/jobs$/);
  const reddit = page.getByTestId('job-reddit');
  const facebook = page.getByTestId('job-facebook');
  await expect(reddit).toContainText('awaiting verification', { timeout: 15_000 });
  await expect(reddit.getByRole('link', { name: 'Open registration page ↗' })).toHaveAttribute('href', 'https://www.reddit.com/register/');
  await expect(reddit).toContainText('mock provider');

  // Reddit still looks confidently available (simulated) → confirmation is refused.
  await reddit.getByRole('button', { name: 'I’ve completed signup' }).click();
  await expect(page.getByText(/still appears available on Reddit/)).toBeVisible();

  // Facebook can't be verified automatically → user confirmation is accepted and recorded.
  await expect(facebook).toContainText('awaiting verification');
  await facebook.getByRole('button', { name: 'I’ve completed signup' }).click();
  await expect(facebook).toContainText('succeeded');
  await facebook.getByText(/Audit trail/).click();
  await expect(facebook).toContainText('automated verification not possible');

  // Cancel → retry follows the state machine.
  await reddit.getByRole('button', { name: 'Cancel' }).click();
  await expect(reddit).toContainText('cancelled');
  await reddit.getByRole('button', { name: 'Retry' }).click();
  await expect(reddit).toContainText('awaiting verification', { timeout: 15_000 });
});
