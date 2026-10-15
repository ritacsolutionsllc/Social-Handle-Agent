import { expect, type Page } from '@playwright/test';

export async function login(page: Page, tag: string) {
  const email = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Find a consistent social handle' })).toBeVisible();
  return email;
}

export async function runCheck(page: Page) {
  await page.getByLabel('Company, brand or handle').fill('Acme Robotics');
  await page.getByRole('button', { name: '+ Exact desired handle (optional)' }).click();
  await page.getByLabel('Exact handle').fill('acmerobotics');
  await page.getByRole('button', { name: 'Check availability' }).click();
  await expect(page).toHaveURL(/\/checks\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: '@acmerobotics', exact: true })).toBeVisible();
  return page.url().split('/').at(-1)!;
}

export async function csrf(page: Page) {
  return (await page.context().cookies()).find((c) => c.name === 'sha_csrf')!.value;
}
