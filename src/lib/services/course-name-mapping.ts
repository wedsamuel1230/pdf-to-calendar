import type { LessonOccurrence } from '$lib/types/timetable';

export function mappedCourseTitle(fullCourseName: string, lessonType?: string): string {
	const normalizedName = fullCourseName.trim();
	if (!normalizedName) {
		return '';
	}
	return lessonType ? `${normalizedName} (${lessonType})` : normalizedName;
}

export function applyCourseNameMapping(
	occurrences: LessonOccurrence[],
	courseCode: string,
	fullCourseName: string
): { updated: LessonOccurrence[]; changed: number } {
	const normalizedCode = courseCode.trim().toUpperCase();
	const normalizedName = fullCourseName.trim();
	if (!normalizedCode || !normalizedName) {
		return { updated: occurrences, changed: 0 };
	}

	let changed = 0;
	const updated = occurrences.map((item) => {
		if (item.courseCode.trim().toUpperCase() !== normalizedCode) {
			return item;
		}
		changed += 1;
		return {
			...item,
			title: mappedCourseTitle(normalizedName, item.lessonType)
		};
	});
	return { updated, changed };
}
