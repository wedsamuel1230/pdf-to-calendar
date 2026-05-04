import { describe, expect, it } from 'vitest';
import type { LessonOccurrence } from '$lib/types/timetable';
import { applyCourseNameMapping, mappedCourseTitle } from './course-name-mapping';

describe('course name mapping', () => {
	it('formats title as Full Name (LessonType) when lesson type exists', () => {
		expect(mappedCourseTitle('Visual Storytelling', 'Workshop')).toBe(
			'Visual Storytelling (Workshop)'
		);
		expect(mappedCourseTitle('Visual Storytelling', undefined)).toBe('Visual Storytelling');
	});

	it('updates all matching rows in one apply action', () => {
		const occurrences: LessonOccurrence[] = [
			{
				id: '1',
				lessonId: 'l1',
				title: 'VAR3033 (Workshop)',
				courseCode: 'VAR3033',
				lessonType: 'Workshop',
				day: 'Wednesday',
				weekNumber: 36,
				startIso: '2026-09-09T09:30:00+08:00',
				endIso: '2026-09-09T12:30:00+08:00',
				sourceText: 'a'
			},
			{
				id: '2',
				lessonId: 'l1',
				title: 'VAR3033 (Workshop)',
				courseCode: 'VAR3033',
				lessonType: 'Workshop',
				day: 'Wednesday',
				weekNumber: 37,
				startIso: '2026-09-16T09:30:00+08:00',
				endIso: '2026-09-16T12:30:00+08:00',
				sourceText: 'b'
			},
			{
				id: '3',
				lessonId: 'l2',
				title: 'VOT3002 (Lecture)',
				courseCode: 'VOT3002',
				lessonType: 'Lecture',
				day: 'Monday',
				weekNumber: 36,
				startIso: '2026-09-07T13:30:00+08:00',
				endIso: '2026-09-07T15:30:00+08:00',
				sourceText: 'c'
			}
		];

		const result = applyCourseNameMapping(occurrences, 'VAR3033', 'Visual Arts Workshop');
		expect(result.changed).toBe(2);
		expect(result.updated[0].title).toBe('Visual Arts Workshop (Workshop)');
		expect(result.updated[1].title).toBe('Visual Arts Workshop (Workshop)');
		expect(result.updated[2].title).toBe('VOT3002 (Lecture)');
	});
});
