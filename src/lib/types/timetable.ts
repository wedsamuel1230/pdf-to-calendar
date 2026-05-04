export const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export type DayLabel = (typeof DAY_LABELS)[number];

export interface ParsedLesson {
	id: string;
	title: string;
	courseCode: string;
	lessonType?: string;
	day: DayLabel;
	startTime: string;
	endTime: string;
	venue?: string;
	instructor?: string;
	weeks: number[];
	sourceText: string;
	confidence?: number;
	issues?: ParseIssue[];
	repairedByLlm?: boolean;
}

export interface LessonOccurrence {
	id: string;
	lessonId: string;
	title: string;
	courseCode: string;
	lessonType?: string;
	day: DayLabel;
	weekNumber: number;
	startIso: string;
	endIso: string;
	venue?: string;
	instructor?: string;
	sourceText: string;
}

export interface ImportPreview {
	lessons: ParsedLesson[];
	occurrences: LessonOccurrence[];
	minWeek: number;
	maxWeek: number;
	missedCandidates?: UnparsedLessonCandidate[];
}

export interface ImportResult {
	total: number;
	imported: number;
	duplicates: number;
	failed: number;
	errors: string[];
}

export interface ParseIssue {
	code: string;
	message: string;
}

export interface UnparsedLessonCandidate {
	id: string;
	day: DayLabel;
	sourceText: string;
	startTime?: string;
	endTime?: string;
	weeks: number[];
	courseCode?: string;
	issues: ParseIssue[];
}
