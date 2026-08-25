import { describe, expect, it } from 'vitest';
import type { LessonOccurrence } from '$lib/types/timetable';
import {
	DEFAULT_COURSE_NAME_MAPPINGS,
	applyDefaultCourseNameMappings,
	applyCourseNameMapping,
	mappedCourseTitle
} from './course-name-mapping';

describe('course name mapping', () => {
	it('formats title as Course Code Full Name (LessonType)', () => {
		expect(mappedCourseTitle('VAR3033', 'Visual Storytelling', 'Workshop')).toBe(
			'VAR3033 Visual Storytelling (Workshop)'
		);
		expect(mappedCourseTitle('VAR3033', 'Visual Storytelling')).toBe('VAR3033 Visual Storytelling');
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
		expect(result.updated[0].title).toBe('VAR3033 Visual Arts Workshop (Workshop)');
		expect(result.updated[1].title).toBe('VAR3033 Visual Arts Workshop (Workshop)');
		expect(result.updated[2].title).toBe('VOT3002 (Lecture)');
	});

	it('applies the built-in session mappings for known timetable course codes', () => {
		const occurrences: LessonOccurrence[] = [
			{
				id: 'vch',
				lessonId: 'vch',
				title: 'VCH3101 (Tutorial)',
				courseCode: 'vch3101',
				lessonType: 'Tutorial',
				day: 'Monday',
				weekNumber: 2,
				startIso: '2026-09-07T09:30:00+08:00',
				endIso: '2026-09-07T11:30:00+08:00',
				sourceText: 'sample'
			},
			{
				id: 'unknown',
				lessonId: 'unknown',
				title: 'OTHER0001 (Lecture)',
				courseCode: 'OTHER0001',
				lessonType: 'Lecture',
				day: 'Tuesday',
				weekNumber: 2,
				startIso: '2026-09-08T09:30:00+08:00',
				endIso: '2026-09-08T11:30:00+08:00',
				sourceText: 'sample'
			}
		];

		const result = applyDefaultCourseNameMappings(occurrences);
		expect(result.changed).toBe(1);
		expect(result.updated[0].title).toBe(
			'VCH3101 Vocational Chinese: Reading Comprehension and Administrative Text Writing (Tutorial)'
		);
		expect(result.updated[1].title).toBe('OTHER0001 (Lecture)');
	});

	it('contains all course mappings supplied in the catalog screenshots', () => {
		expect(Object.keys(DEFAULT_COURSE_NAME_MAPPINGS)).toHaveLength(57);
		expect(DEFAULT_COURSE_NAME_MAPPINGS.VAR3233).toBe('Project');
		expect(DEFAULT_COURSE_NAME_MAPPINGS.VEN3302).toBe(
		'Vocational English 3B: Workplace Correspondence III'
	);
	});
});
