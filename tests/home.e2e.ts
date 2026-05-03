import path from 'node:path';
import { expect, test } from '@playwright/test';

const SAMPLE_PDF = path.resolve('memory-bank/reference/timetable-to-give.pdf');

test('supports parse workflow and review table', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Timetable PDF to Notion Calendar' })).toBeVisible();

	await page.locator('input[type="file"]').setInputFiles(SAMPLE_PDF);
	await page.getByRole('button', { name: 'Parse Timetable' }).click();
	await expect(page.getByText('Please provide the starting Monday date.')).toBeVisible();

	await page.locator('input[type="date"]').fill('2026-09-07');
	await page.getByRole('button', { name: 'Parse Timetable' }).click();
	await expect(page.getByRole('heading', { name: 'Review Lessons' })).toBeVisible({ timeout: 15000 });
	await expect(page.getByText(/Parsed .* event occurrences/)).toBeVisible();
});

test('keeps controls accessible on mobile viewport', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	const hideSettingsButton = page.getByRole('button', { name: 'Hide Settings' });
	await hideSettingsButton.focus();
	await expect(hideSettingsButton).toBeFocused();
	await expect(page.getByRole('button', { name: 'Parse Timetable' })).toBeVisible();
});
