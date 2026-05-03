import { z } from 'zod';
import { DAY_LABELS } from '$lib/types/timetable';

const timeZoneDefault = 'Asia/Hong_Kong';

export const notionConfigSchema = z.object({
	token: z.string().trim().min(1).optional(),
	databaseIdOrUrl: z.string().trim().min(1, 'Database ID or URL is required'),
	datePropertyName: z.string().trim().min(1, 'Date property is required').default('Start Time'),
	titlePropertyName: z.string().trim().min(1, 'Title property is required').default('Class/Event'),
	timezone: z.string().trim().min(1).default(timeZoneDefault)
});

export const notionDatabaseSetupSchema = z.object({
	token: z.string().trim().min(1).optional(),
	parentPageIdOrUrl: z.string().trim().min(1, 'Parent page URL or ID is required'),
	databaseName: z.string().trim().min(1, 'Database name is required').default('Timetable Calendar'),
	datePropertyName: z.string().trim().min(1, 'Date property is required').default('Start Time'),
	titlePropertyName: z.string().trim().min(1, 'Title property is required').default('Class/Event'),
	timezone: z.string().trim().min(1).default(timeZoneDefault)
});

export const dayLabelSchema = z.enum(DAY_LABELS);

export const lessonOccurrenceSchema = z.object({
	id: z.string().min(1),
	lessonId: z.string().min(1),
	title: z.string().min(1),
	courseCode: z.string().min(1),
	lessonType: z.string().optional(),
	day: dayLabelSchema,
	weekNumber: z.number().int().min(1),
	startIso: z.string().datetime({ offset: true }),
	endIso: z.string().datetime({ offset: true }),
	venue: z.string().optional(),
	instructor: z.string().optional(),
	sourceText: z.string().min(1)
});

export const recurringLessonSchema = z.object({
	id: z.string().min(1),
	title: z.string().min(1),
	courseCode: z.string().min(1),
	lessonType: z.string().optional(),
	day: dayLabelSchema,
	startIso: z.string().datetime({ offset: true }),
	endIso: z.string().datetime({ offset: true }),
	startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	repeatWeekly: z.boolean(),
	weekPattern: z.enum(['All', 'Odd', 'Even']),
	venue: z.string().optional(),
	instructor: z.string().optional(),
	sourceText: z.string().min(1)
});

export function ensurePdfFile(file: File | null): File {
	if (!file) {
		throw new Error('Please select a PDF timetable file.');
	}

	const byName = file.name.toLowerCase().endsWith('.pdf');
	const byMime = file.type === 'application/pdf';
	if (!byName && !byMime) {
		throw new Error('Only PDF files are supported.');
	}

	return file;
}

export function ensureStartDate(value: string): string {
	if (!value) {
		throw new Error('Please provide the starting Monday date.');
	}

	return value;
}
