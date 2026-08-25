import type { LessonOccurrence } from '$lib/types/timetable';

export const DEFAULT_COURSE_NAME_MAPPINGS: Readonly<Record<string, string>> = {
	VWP2023: 'Sportsmanship in Practice',
	VWP3007: 'Aiming at a Bright Future',
	VWP3008: 'Our Changing Society',
	VWP3009: 'Wellness in Action',
	VWP3010: 'Essentials of Personal Development',
	VAR2013: 'Artificial Intelligence & Basic Programming',
	VAR2030: 'Principles of Industrial Automation',
	VAR2033: 'Introduction to Robotics and Programming',
	VAR2034: 'Industrial Automation Assembly',
	VAR2043: 'Fundamental Robotic Instrumentation and Electronics',
	VAR2053: 'Electronic Signal and Communication Fundamental',
	VAR2063: 'Computer Aided Robotic Design',
	VAR2201: 'Mechanical Assembly Knowledge and Practice in Industrial Process',
	VAR3003: 'Microcontroller Programming and Applications',
	VAR3050: 'Computer Aided Drafting - Industrial Automation',
	VME2007: 'Manufacturing Technology',
	VOT2007: 'Safety, Health and Environment',
	VOT3002: 'Project Skills',
	VOT3003: 'Engineering Science',
	VMA3050: 'Mathematics 3E: Mathematics for Further Studies',
	VAR2023: 'Mobile and Computer Programming',
	VAR2150: 'Machining Practice',
	VAR3018: '3D Printing in Industrial Process',
	VAR3023: 'Automation System Risk and Safety',
	VAR3033: 'Computer Vision Applications',
	VAR3043: 'Intelligent Robotic Control Applications',
	VAR3231: 'Fluid Power Applications',
	VAR3233: 'Project',
	VDT3018: 'Internet-of-Things Applications',
	VME2025: 'Solid Modeling',
	VOT3004: 'Workplace Professional Training',
	VCH1101: 'Vocational Chinese: Putonghua Conversations and Administrative Text Writing',
	VCH2101: 'Vocational Chinese: Putonghua Listening Skills and Simplified Chinese Characters',
	VCH2102: 'Vocational Chinese: Cantonese Presentations and Administrative Text Writing',
	VCH2103: 'Vocational Chinese: Putonghua Conversations and Discussions',
	VCH3101: 'Vocational Chinese: Reading Comprehension and Administrative Text Writing',
	VCH3102: 'Vocational Chinese: Discussions and Social Correspondence',
	VCP2201: 'Information Technology (A)',
	VCP3202: 'Information Technology (B)',
	VCP3203: 'Information Technology (C)',
	VEN1101: 'Vocational English 1A: Workplace Oral Interaction I',
	VEN1102: 'Vocational English 1B: Workplace Correspondence I',
	VEN1103: 'Vocational English 1C: Workplace Writing I',
	VEN2101: 'Vocational English 2A: Workplace Oral Presentation I',
	VEN2302: 'Vocational English 2B: Workplace Oral Interaction II',
	VEN2303: 'Vocational English 2C: Workplace Correspondence II',
	VEN2304: 'Vocational English 2D: Workplace Writing II',
	VEN3301: 'Vocational English 3A: Workplace Oral Presentation II',
	VEN3302: 'Vocational English 3B: Workplace Correspondence III',
	VMA2010: 'Mathematics 2A: Arithmetic and Algebra',
	VMA2020: 'Mathematics 2B: Statistics',
	VMA2030: 'Mathematics 2C: Geometry and Trigonometry',
	VMA3010: 'Mathematics 3A: Algebra and Coordinate Geometry',
	VMA3020: 'Mathematics 3B: Functions and Statistics',
	VMA3040: 'Mathematics 3D: Probability and Differentiation',
	VWP2021: 'Discovering Yourself',
	VWP2022: 'Sports for All'
};

export function mappedCourseTitle(
	courseCode: string,
	fullCourseName: string,
	lessonType?: string
): string {
	const normalizedCode = courseCode.trim().toUpperCase();
	const normalizedName = fullCourseName.trim();
	if (!normalizedCode || !normalizedName) {
		return '';
	}
	const title = `${normalizedCode} ${normalizedName}`;
	return lessonType ? `${title} (${lessonType})` : title;
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
			title: mappedCourseTitle(normalizedCode, normalizedName, item.lessonType)
		};
	});
	return { updated, changed };
}

export function applyCourseNameMappings(
	occurrences: LessonOccurrence[],
	mappings: Readonly<Record<string, string>>
): { updated: LessonOccurrence[]; changed: number } {
	let updated = occurrences;
	let changed = 0;
	for (const [courseCode, fullCourseName] of Object.entries(mappings)) {
		const result = applyCourseNameMapping(updated, courseCode, fullCourseName);
		updated = result.updated;
		changed += result.changed;
	}
	return { updated, changed };
}

export function applyDefaultCourseNameMappings(
	occurrences: LessonOccurrence[]
): { updated: LessonOccurrence[]; changed: number } {
	return applyCourseNameMappings(occurrences, DEFAULT_COURSE_NAME_MAPPINGS);
}
