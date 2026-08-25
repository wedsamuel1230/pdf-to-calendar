import { describe, expect, it } from 'vitest';
import type { ParsedLesson } from '$lib/types/timetable';
import { __testables } from './timetable-parser';

describe('timetable parser helpers', () => {
	it('expands week ranges with gaps', () => {
		expect(__testables.parseWeekExpression('36-38,40,42-43')).toEqual([36, 37, 38, 40, 42, 43]);
	});

	it('parses noisy week lines', () => {
		expect(__testables.parseWeekLine('W k : 36 - 38, 40')).toEqual([36, 37, 38, 40]);
	});

	it('parses polluted week lines by capturing only Wk token segment', () => {
		expect(__testables.parseWeekLine('11:00 Wk:38,40-44 | 22:30')).toEqual([38, 40, 41, 42, 43, 44]);
	});

	it('parses lessons from positioned text blocks', () => {
		const items = [
			{ text: 'Monday', x: 129.55, y: 723 },
			{ text: 'Tuesday', x: 222.05, y: 723 },
			{ text: 'Wednesday', x: 299.25, y: 723 },
			{ text: 'Thursday', x: 385.37, y: 723 },
			{ text: 'Friday', x: 465.76, y: 723 },
			{ text: 'Saturday', x: 518.19, y: 723 },
			{ text: 'VOT3002 (Lecture (L) )', x: 97.45, y: 361.5 },
			{ text: '(13:30 - 15:30)', x: 97.45, y: 351 },
			{ text: 'KB-PAEN-602B', x: 97.45, y: 340.5 },
			{ text: 'NG HONG MING,CHOY', x: 97.45, y: 330 },
			{ text: 'SHU SANG', x: 97.45, y: 319.5 },
			{ text: 'Wk:37,38,40-46', x: 135.88, y: 309 },
			{ text: 'VWP3009', x: 446.36, y: 582 },
			{ text: '(Lecture (L) )', x: 446.36, y: 571.5 },
			{ text: '(09:30 - 12:30)', x: 446.36, y: 561 },
			{ text: 'KB-YCSDO-299', x: 446.36, y: 550.5 },
			{ text: 'HUI KIT CHI', x: 446.36, y: 540 },
			{ text: 'Wk:36-41,43-47', x: 451.14, y: 529.5 }
		];

		const lessons = __testables.parseLessonsFromPositionedText(items);
		expect(lessons).toHaveLength(2);
		expect(lessons[0]).toMatchObject({
			courseCode: 'VOT3002',
			day: 'Monday',
			startTime: '13:30',
			endTime: '15:30',
			venue: 'KB-PAEN-602B',
			instructor: 'NG HONG MING, CHOY SHU SANG'
		});
		expect(lessons[0].confidence).toBeGreaterThan(0.7);
		expect(lessons[0].issues?.map((issue) => issue.code)).not.toContain('missing_venue');
		expect(lessons[0].issues?.map((issue) => issue.code)).not.toContain('missing_instructor');
		expect(lessons[1]).toMatchObject({
			courseCode: 'VWP3009',
			day: 'Friday',
			startTime: '09:30',
			endTime: '12:30',
			weeks: [36, 37, 38, 39, 40, 41, 43, 44, 45, 46, 47]
		});
	});

	it('normalizes trailing WS fragment as lesson type and keeps instructor clean', () => {
		const items = [
			{ text: 'Wednesday', x: 299.25, y: 723 },
			{ text: 'VAR3003 WS))', x: 299.25, y: 560 },
			{ text: '(14:30 - 16:30)', x: 299.25, y: 549.5 },
			{ text: 'KB-ROOM-101', x: 299.25, y: 539 },
			{ text: 'CHAN TAI MAN', x: 299.25, y: 528.5 },
			{ text: 'Wk:36-37', x: 299.25, y: 518 }
		];

		const lessons = __testables.parseLessonsFromPositionedText(items);
		expect(lessons).toHaveLength(1);
		expect(lessons[0]).toMatchObject({
			courseCode: 'VAR3003',
			title: 'VAR3003 (Workshop)',
			instructor: 'CHAN TAI MAN',
			day: 'Wednesday'
		});
	});

	it('handles split workshop fragment without polluting instructor', () => {
		const items = [
			{ text: 'Wednesday', x: 299.25, y: 723 },
			{ text: 'VAR3033 (Workshop', x: 299.25, y: 560 },
			{ text: '(WS) )', x: 299.25, y: 550 },
			{ text: '(09:30 - 12:30)', x: 299.25, y: 540 },
			{ text: 'KB-PAEN-609', x: 299.25, y: 529.5 },
			{ text: 'CHOY SHU SANG', x: 299.25, y: 519 },
			{ text: 'Wk:37-42', x: 299.25, y: 508.5 }
			];

			const lessons = __testables.parseLessonsFromPositionedText(items);
		expect(lessons).toHaveLength(1);
		expect(lessons[0]).toMatchObject({
			title: 'VAR3033 (Workshop)',
			courseCode: 'VAR3033',
			venue: 'KB-PAEN-609',
			instructor: 'CHOY SHU SANG',
			weeks: [37, 38, 39, 40, 41, 42]
		});
	});

	it('reconstructs a fully wrapped timetable cell from its course-code anchor', () => {
		const items = [
			{ text: 'Monday', x: 89.9, y: 772.9 },
			{ text: 'Tuesday', x: 139.8, y: 772.9 },
			{ text: 'VCH3101', x: 85, y: 649.9 },
			{ text: '(Tutorial (T)', x: 85, y: 639.4 },
			{ text: ')', x: 85, y: 628.9 },
			{ text: '(09:30 -', x: 85, y: 607.9 },
			{ text: '11:30)', x: 85, y: 597.4 },
			{ text: 'KB-YCCS-', x: 85, y: 586.9 },
			{ text: '103H', x: 85, y: 576.4 },
			{ text: 'LI CHAU', x: 85, y: 565.9 },
			{ text: 'YIP KZIA', x: 85, y: 555.4 },
			{ text: 'Wk:2-7,9-', x: 93.6, y: 544.9 },
			{ text: '16', x: 122.6, y: 534.4 },
				{ text: 'VCP3203', x: 85, y: 328.9 }
			];

			const lessons = __testables.parseLessonsFromPositionedText(items);
		expect(lessons).toHaveLength(1);
		expect(lessons[0]).toMatchObject({
			courseCode: 'VCH3101',
			title: 'VCH3101 (Tutorial)',
			day: 'Monday',
			startTime: '09:30',
			endTime: '11:30',
			venue: 'KB-YCCS-103H',
			instructor: 'LI CHAU YIP KZIA',
			weeks: [2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16]
		});
	});

	it('keeps parallel course blocks that start on the same visual row', () => {
		const items = [
			{ text: 'Tuesday', x: 139.8, y: 723 },
			{ text: 'Wednesday', x: 207.8, y: 723 },
			{ text: 'Thursday', x: 313.3, y: 723 },
			{ text: 'VEN2302 (Tutorial)', x: 186.9, y: 302.7 },
			{ text: '(13:30 - 15:30)', x: 186.9, y: 260.7 },
			{ text: 'KB-YCCS-502', x: 186.9, y: 239.7 },
			{ text: 'LAW YIK HO', x: 186.9, y: 218.7 },
			{ text: 'Wk:9-16', x: 200.5, y: 197.7 },
			{ text: 'VEN2303 (Tutorial)', x: 237, y: 302.7 },
			{ text: '(13:30 - 15:30)', x: 237, y: 260.7 },
			{ text: 'KB-YCCS-502', x: 237, y: 239.7 },
			{ text: 'LAW YIK HO', x: 237, y: 218.7 },
			{ text: 'Wk:1-8', x: 255.6, y: 197.7 }
		];

		const lessons = __testables.parseLessonsFromPositionedText(items);
		expect(lessons).toHaveLength(2);
		expect(lessons.map((lesson) => lesson.courseCode)).toEqual(['VEN2302', 'VEN2303']);
	});

	it('emits missed-candidate recovery blocks when deterministic parse fails with time+week signals', () => {
		const items = [
			{ text: 'Monday', x: 129.55, y: 723 },
			{ text: '(10:00 - 12:00)', x: 129.55, y: 640 },
			{ text: 'KB-ROOM-500', x: 129.55, y: 629.5 },
			{ text: 'SOME INSTRUCTOR', x: 129.55, y: 619 },
			{ text: 'Wk:36-38', x: 129.55, y: 608.5 }
		];

		const parsed = __testables.parseLessonsWithCandidatesFromPositionedText(items);
		expect(parsed.lessons).toHaveLength(0);
		expect(parsed.missedCandidates).toHaveLength(1);
		expect(parsed.missedCandidates[0]).toMatchObject({
			day: 'Monday',
			startTime: '10:00',
			endTime: '12:00',
			weeks: [36, 37, 38]
		});
		expect(parsed.missedCandidates[0].issues.map((issue) => issue.code)).toContain(
			'missed_candidate_recovery'
		);
	});

	it('stitches split time+week anchors from the course-code block', () => {
		const items = [
			{ text: 'Monday', x: 129.55, y: 723 },
			{ text: 'VAR3033', x: 129.55, y: 698 },
			{ text: '(10:00 - 12:00)', x: 129.55, y: 620 },
			{ text: 'KB-PAEN-609', x: 129.55, y: 610 },
			{ text: 'CHOY SHU SANG', x: 129.55, y: 600 },
			{ text: 'Wk:37-42', x: 129.55, y: 560 }
		];

		const lessons = __testables.parseLessonsFromPositionedText(items);
		expect(lessons).toHaveLength(1);
		expect(lessons[0]).toMatchObject({
			courseCode: 'VAR3033',
			day: 'Monday',
			startTime: '10:00',
			endTime: '12:00',
			weeks: [37, 38, 39, 40, 41, 42],
			instructor: 'CHOY SHU SANG'
		});
		expect(lessons[0].issues?.map((item) => item.code)).not.toContain('course_inferred');
	});

	it('filters malformed outlier week tokens and keeps valid weeks only', () => {
		const items = [
			{ text: 'Monday', x: 129.55, y: 723 },
			{ text: 'VOT3003 (Tutorial (T))', x: 129.55, y: 640 },
			{ text: '(09:00 - 12:00)', x: 129.55, y: 629.5 },
			{ text: 'KB-PAPE-204J', x: 129.55, y: 619 },
			{ text: 'NG HONG MING', x: 129.55, y: 608.5 },
			{ text: '11:00 Wk:38,40-44,163037', x: 129.55, y: 598 }
		];

		const lessons = __testables.parseLessonsFromPositionedText(items);
		expect(lessons).toHaveLength(1);
		expect(lessons[0].weeks).toEqual([38, 40, 41, 42, 43, 44]);
		expect(Math.max(...lessons[0].weeks)).toBeLessThanOrEqual(53);
		expect(lessons[0].issues?.map((issue) => issue.code)).toContain('week_token_polluted');
		expect(lessons[0].issues?.map((issue) => issue.code)).toContain('week_outlier_filtered');
	});

	it('maps the starting week date to the lowest week label', () => {
		const lessons: ParsedLesson[] = [
			{
				id: 'mon-1',
				title: 'VWP3009 (Lecture)',
				courseCode: 'VWP3009',
				day: 'Friday',
				startTime: '09:30',
				endTime: '12:30',
				weeks: [36, 37],
				sourceText: 'sample'
			}
		];

		const occurrences = __testables.expandLessonsToOccurrences(lessons, '2026-09-07', 36);
		expect(occurrences).toHaveLength(2);
		expect(occurrences[0].startIso).toBe('2026-09-11T09:30:00+08:00');
		expect(occurrences[1].startIso).toBe('2026-09-18T09:30:00+08:00');
	});
});
