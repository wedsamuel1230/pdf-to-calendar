import { describe, expect, it } from 'vitest';
import {
	ensurePdfFile,
	ensureStartDate,
	lessonOccurrenceSchema,
	notionConfigSchema,
	notionDatabaseSetupSchema
} from './schemas';

describe('schemas and validation', () => {
	it('accepts pdf files and rejects non-pdf files', () => {
		const pdf = new File([new Uint8Array([1, 2, 3])], 'time-table.pdf', { type: 'application/pdf' });
		expect(ensurePdfFile(pdf)).toBe(pdf);

		const txt = new File(['abc'], 'notes.txt', { type: 'text/plain' });
		expect(() => ensurePdfFile(txt)).toThrow('Only PDF files are supported.');
	});

	it('requires a start date and validates notion config defaults', () => {
		expect(() => ensureStartDate('')).toThrow('Please provide the starting Monday date.');
		expect(ensureStartDate('2026-09-07')).toBe('2026-09-07');
		expect(
			notionConfigSchema.parse({
				databaseIdOrUrl: 'https://notion.so/db',
				datePropertyName: 'Date',
				titlePropertyName: 'Name',
				timezone: 'Asia/Hong_Kong'
			}).timezone
		).toBe('Asia/Hong_Kong');
	});

	it('validates notion database setup defaults', () => {
		expect(
			notionDatabaseSetupSchema.parse({
				parentPageIdOrUrl: 'https://www.notion.so/example-page-a1b2c3d4e5f6478899aabbccddeeff00',
				databaseName: 'Timetable Calendar',
				datePropertyName: 'Date',
				titlePropertyName: 'Name',
				timezone: 'Asia/Hong_Kong'
			}).databaseName
		).toBe('Timetable Calendar');
	});

	it('validates lesson occurrence payloads', () => {
		expect(() =>
			lessonOccurrenceSchema.parse({
				id: '1',
				lessonId: 'l1',
				title: 'VOT3002',
				courseCode: 'VOT3002',
				day: 'Monday',
				weekNumber: 36,
				startIso: '2026-09-07T13:30:00+08:00',
				endIso: '2026-09-07T15:30:00+08:00',
				sourceText: 'sample'
			})
		).not.toThrow();
	});
});
