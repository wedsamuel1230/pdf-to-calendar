import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
	DAY_LABELS,
	type DayLabel,
	type ImportPreview,
	type LessonOccurrence,
	type ParseIssue,
	type ParsedLesson,
	type UnparsedLessonCandidate
} from '$lib/types/timetable';
import { ensurePdfJsWebViewCompatibility } from './webview-compat';

interface PositionedText {
	text: string;
	x: number;
	y: number;
}

interface DayAnchor {
	day: DayLabel;
	x: number;
}

interface DayRange {
	day: DayLabel;
	minX: number;
	maxX: number;
}

interface ParseLessonsResult {
	lessons: ParsedLesson[];
	missedCandidates: UnparsedLessonCandidate[];
}

const COURSE_CODE_PATTERN = /([A-Z]{3}\d{4})/;
const TIME_RANGE_PATTERN = /(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/;
const VENUE_PATTERN = /[A-Z]{2,}-[A-Z0-9-]+/;
const LESSON_TYPE_PATTERN = /\b(Lecture|Tutorial|Workshop|Lab|Seminar)\b/i;
const HK_OFFSET = '+08:00';
const LESSON_TYPE_MAP: Record<string, string> = {
	LECTURE: 'Lecture',
	TUTORIAL: 'Tutorial',
	WORKSHOP: 'Workshop',
	LAB: 'Lab',
	SEMINAR: 'Seminar',
	WS: 'Workshop',
	L: 'Lecture',
	T: 'Tutorial',
	SEM: 'Seminar'
};

GlobalWorkerOptions.workerSrc = new URL(
	'pdfjs-dist/legacy/build/pdf.worker.mjs',
	import.meta.url
).toString();

function normalizeText(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function parseCourseCode(value: string): string | undefined {
	return value.match(COURSE_CODE_PATTERN)?.[1];
}

function normalizeTimeText(value: string): string {
	const [hourText, minuteText] = value.split(':');
	return `${hourText.padStart(2, '0')}:${minuteText}`;
}

function parseWeekExpression(value: string): number[] {
	const source = value.replace(/^Wk\s*:?\s*/i, '').trim();
	const tokens = source
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
	const result = new Set<number>();

	for (const token of tokens) {
		const rangeMatch = token.match(/^(\d+)\s*-\s*(\d+)$/);
		if (rangeMatch) {
			const start = Number(rangeMatch[1]);
			const end = Number(rangeMatch[2]);
			if (Number.isFinite(start) && Number.isFinite(end)) {
				const [from, to] = start <= end ? [start, end] : [end, start];
				for (let week = from; week <= to; week += 1) {
					result.add(week);
				}
			}
			continue;
		}

		const numeric = Number(token);
		if (Number.isFinite(numeric)) {
			result.add(numeric);
		}
	}

	return [...result].sort((a, b) => a - b);
}

function parseWeekLine(value: string): number[] {
	const normalized = value
		.replace(/W\s*k/gi, 'Wk')
		.replace(/[\u2013\u2014]/g, '-')
		.replace(/\s+/g, '')
		.replace(/;+$/g, '');
	return parseWeekExpression(normalized);
}

function buildBlockLines(blockItems: PositionedText[]): string[] {
	const sorted = [...blockItems]
		.map((item) => ({ ...item, text: normalizeText(item.text) }))
		.filter((item) => item.text.length > 0)
		.sort((a, b) => b.y - a.y || a.x - b.x);
	const rows: Array<{ y: number; items: PositionedText[] }> = [];

	for (const item of sorted) {
		const row = rows[rows.length - 1];
		if (row && Math.abs(row.y - item.y) <= 1.2) {
			row.items.push(item);
			row.y = (row.y + item.y) / 2;
		} else {
			rows.push({ y: item.y, items: [item] });
		}
	}

	return rows
		.map((row) =>
			normalizeText(
				row.items
					.sort((a, b) => a.x - b.x)
					.map((item) => item.text)
					.join(' ')
			)
		)
		.filter(Boolean);
}

function collectDayAnchors(items: PositionedText[]): DayAnchor[] {
	const anchors: DayAnchor[] = [];
	for (const day of DAY_LABELS) {
		const candidates = items.filter((item) => item.text === day);
		if (candidates.length === 0) {
			continue;
		}
		const top = candidates.sort((a, b) => b.y - a.y)[0];
		anchors.push({ day, x: top.x });
	}
	return anchors.sort((a, b) => a.x - b.x);
}

function buildDayRanges(anchors: DayAnchor[]): DayRange[] {
	const ranges: DayRange[] = [];
	for (let index = 0; index < anchors.length; index += 1) {
		const current = anchors[index];
		const prev = anchors[index - 1];
		const next = anchors[index + 1];
		const minX = prev ? (prev.x + current.x) / 2 : current.x - 72;
		const maxX = next ? (current.x + next.x) / 2 : current.x + 72;
		ranges.push({ day: current.day, minX, maxX });
	}
	return ranges;
}

function findDayByX(x: number, ranges: DayRange[]): DayLabel | undefined {
	for (const range of ranges) {
		if (x >= range.minX && x < range.maxX) {
			return range.day;
		}
	}
	return undefined;
}

function alphaTokens(value: string): string[] {
	return value
		.toUpperCase()
		.replace(/[^A-Z]/g, ' ')
		.split(/\s+/)
		.filter(Boolean);
}

function isLessonTypeFragmentLine(value: string): boolean {
	if (LESSON_TYPE_PATTERN.test(value)) {
		return true;
	}
	const tokens = alphaTokens(value);
	if (tokens.length === 0) {
		return false;
	}
	if (tokens.length === 1) {
		return Boolean(LESSON_TYPE_MAP[tokens[0]]) && (/[()]/.test(value) || tokens[0].length <= 3);
	}
	return tokens.every((token) => Boolean(LESSON_TYPE_MAP[token]));
}

function findLessonType(
	lines: string[],
	courseLine: string
): { value?: string; fromFragment: boolean; consumedIndexes: number[] } {
	for (const line of lines) {
		const match = line.match(LESSON_TYPE_PATTERN);
		if (match?.[1]) {
			return { value: LESSON_TYPE_MAP[match[1].toUpperCase()], fromFragment: false, consumedIndexes: [] };
		}
	}

	const courseCode = parseCourseCode(courseLine);
	if (courseCode) {
		const marker = courseLine.toUpperCase().indexOf(courseCode);
		const suffix = marker >= 0 ? courseLine.slice(marker + courseCode.length) : '';
		const suffixTokens = alphaTokens(suffix);
		for (const token of suffixTokens) {
			if (LESSON_TYPE_MAP[token]) {
				return { value: LESSON_TYPE_MAP[token], fromFragment: true, consumedIndexes: [] };
			}
		}
	}

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (!isLessonTypeFragmentLine(line)) {
			continue;
		}
		const tokens = alphaTokens(line);
		for (const token of tokens) {
			if (LESSON_TYPE_MAP[token]) {
				return { value: LESSON_TYPE_MAP[token], fromFragment: true, consumedIndexes: [index] };
			}
		}
	}

	return { fromFragment: false, consumedIndexes: [] };
}

function extractWeekData(lines: string[]): { weeks: number[]; consumedIndexes: number[] } {
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (!/W\s*k/i.test(line)) {
			continue;
		}

		const direct = parseWeekLine(line);
		if (direct.length > 0) {
			return { weeks: direct, consumedIndexes: [index] };
		}

		const next = lines[index + 1];
		if (next) {
			const combined = parseWeekLine(`${line}${next}`);
			if (combined.length > 0) {
				return { weeks: combined, consumedIndexes: [index, index + 1] };
			}
		}
	}

	const joined = lines.join(' ');
	const match = joined.match(/W\s*k\s*:?\s*([0-9,\-\s]+)/i);
	if (!match) {
		return { weeks: [], consumedIndexes: [] };
	}
	return { weeks: parseWeekExpression(match[1]), consumedIndexes: [] };
}

function extractTimeRange(lines: string[]): { startTime?: string; endTime?: string; lineIndex?: number } {
	for (let index = 0; index < lines.length; index += 1) {
		const match = lines[index].match(TIME_RANGE_PATTERN);
		if (!match) {
			continue;
		}
		return {
			startTime: normalizeTimeText(match[1]),
			endTime: normalizeTimeText(match[2]),
			lineIndex: index
		};
	}
	return {};
}

function buildUnparsedCandidate(
	blockItems: PositionedText[],
	day: DayLabel,
	fallbackId: string
): UnparsedLessonCandidate | undefined {
	const lines = buildBlockLines(blockItems);
	if (lines.length === 0) {
		return undefined;
	}

	const timeRange = extractTimeRange(lines);
	const { weeks } = extractWeekData(lines);
	if (!timeRange.startTime || !timeRange.endTime || weeks.length === 0) {
		return undefined;
	}

	const joined = lines.join(' | ');
	const courseCode = lines
		.map((line) => parseCourseCode(line))
		.find((value): value is string => Boolean(value));

	return {
		id: fallbackId,
		day,
		sourceText: joined,
		startTime: timeRange.startTime,
		endTime: timeRange.endTime,
		weeks,
		courseCode,
		issues: [
			{
				code: 'missed_candidate_recovery',
				message: 'Deterministic parser flagged this block for LLM missed-lesson recovery.'
			}
		]
	};
}

function cleanInstructorLine(value: string): { cleaned: string; removedFragment: boolean } {
	const normalized = normalizeText(value);
	if (!normalized) {
		return { cleaned: '', removedFragment: false };
	}
	if (isLessonTypeFragmentLine(normalized)) {
		return { cleaned: '', removedFragment: true };
	}

	const withoutFragments = normalized
		.replace(/\(\s*(?:WS|L|T|LAB|SEM)\s*\)\s*\)?/gi, ' ')
		.replace(/\b(?:WS|LAB|SEM)\)+$/gi, ' ')
		.trim();
	const cleaned = normalizeText(withoutFragments);
	return { cleaned, removedFragment: cleaned !== normalized };
}

function mergeInstructorLines(lines: string[]): string | undefined {
	if (lines.length === 0) {
		return undefined;
	}

	const merged = lines.join(' ').replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').trim();
	return merged || undefined;
}

function parseLessonFromBlock(
	blockItems: PositionedText[],
	day: DayLabel,
	fallbackId: string
): ParsedLesson | undefined {
	const lines = buildBlockLines(blockItems);
	if (lines.length === 0) {
		return undefined;
	}

	const courseLineIndex = lines.findIndex((line) => Boolean(parseCourseCode(line)));
	if (courseLineIndex < 0) {
		return undefined;
	}
	const courseLine = lines[courseLineIndex];
	const courseCode = parseCourseCode(courseLine);
	if (!courseCode) {
		return undefined;
	}

	const timeRange = extractTimeRange(lines);
	if (!timeRange.startTime || !timeRange.endTime || timeRange.lineIndex === undefined) {
		return undefined;
	}
	const startTime = timeRange.startTime;
	const endTime = timeRange.endTime;
	const timeLineIndex = timeRange.lineIndex;

	const { weeks, consumedIndexes: consumedWeekIndexes } = extractWeekData(lines);
	if (weeks.length === 0) {
		return undefined;
	}

	const venueLineIndex = lines.findIndex((line) => VENUE_PATTERN.test(line));
	const venue = venueLineIndex >= 0 ? lines[venueLineIndex] : undefined;

	const lessonTypeInfo = findLessonType(lines, courseLine);
	const lessonType = lessonTypeInfo.value;
	const consumedLineIndexes = new Set<number>([
		courseLineIndex,
		timeLineIndex,
		venueLineIndex,
		...consumedWeekIndexes,
		...lessonTypeInfo.consumedIndexes
	]);
	const instructorLines: string[] = [];
	let hadInstructorPollution = false;

	for (let index = 0; index < lines.length; index += 1) {
		if (consumedLineIndexes.has(index)) {
			continue;
		}
		const line = lines[index];
		if (!line || TIME_RANGE_PATTERN.test(line) || /W\s*k/i.test(line) || VENUE_PATTERN.test(line)) {
			continue;
		}
		if (/^[\d:()\-\s]+$/.test(line)) {
			continue;
		}
		const cleaned = cleanInstructorLine(line);
		if (cleaned.removedFragment) {
			hadInstructorPollution = true;
		}
		if (cleaned.cleaned) {
			instructorLines.push(cleaned.cleaned);
		}
	}

	const title = lessonType ? `${courseCode} (${lessonType})` : courseCode;
	const issues: ParseIssue[] = [];
	if (!venue) {
		issues.push({ code: 'missing_venue', message: 'Venue was not detected from this lesson block.' });
	}
	const instructor = mergeInstructorLines(instructorLines);
	if (!instructor) {
		issues.push({ code: 'missing_instructor', message: 'Instructor was not detected from this lesson block.' });
	}
	if (!lessonType) {
		issues.push({ code: 'missing_lesson_type', message: 'Lesson type was not detected from this lesson block.' });
	}
	if (lessonTypeInfo.fromFragment) {
		issues.push({ code: 'lesson_type_fragment', message: 'Lesson type was recovered from an abbreviated fragment.' });
	}
	if (/\([^)]*$/.test(courseLine)) {
		issues.push({ code: 'title_partial', message: 'Original title line looked partial; canonical title was normalized.' });
	}
	if (hadInstructorPollution) {
		issues.push({ code: 'instructor_polluted', message: 'Instructor line had lesson-type fragments that were removed.' });
	}
	const confidence = Math.max(0.35, 1 - issues.length * 0.1);

	return {
		id: fallbackId,
		title,
		courseCode,
		lessonType,
		day,
		startTime,
		endTime,
		venue,
		instructor,
		weeks,
		sourceText: lines.join(' | '),
		confidence,
		issues
	};
}

function dayIndex(day: DayLabel): number {
	return DAY_LABELS.indexOf(day);
}

function sortLessons(lessons: ParsedLesson[]): ParsedLesson[] {
	return [...lessons].sort((a, b) => {
		const dayDelta = dayIndex(a.day) - dayIndex(b.day);
		if (dayDelta !== 0) {
			return dayDelta;
		}
		const start = a.startTime.localeCompare(b.startTime);
		if (start !== 0) {
			return start;
		}
		return a.courseCode.localeCompare(b.courseCode);
	});
}

function formatDate(date: Date): string {
	const year = date.getUTCFullYear().toString().padStart(4, '0');
	const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
	const day = date.getUTCDate().toString().padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function isoWithHongKongOffset(date: Date, time: string): string {
	const [hourText, minuteText] = time.split(':');
	return `${formatDate(date)}T${hourText.padStart(2, '0')}:${minuteText.padStart(2, '0')}:00${HK_OFFSET}`;
}

function addDays(base: Date, amount: number): Date {
	const copy = new Date(base);
	copy.setUTCDate(copy.getUTCDate() + amount);
	return copy;
}

function parseStartWeekDate(value: string): Date {
	const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!match) {
		throw new Error('Invalid starting week date.');
	}
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	if (Number.isNaN(date.getTime())) {
		throw new Error('Invalid starting week date.');
	}
	return date;
}

function expandLessonsToOccurrences(lessons: ParsedLesson[], startWeekDate: string, minWeek: number): LessonOccurrence[] {
	const mondayDate = parseStartWeekDate(startWeekDate);

	const occurrences: LessonOccurrence[] = [];
	for (const lesson of lessons) {
		const dayOffset = dayIndex(lesson.day);
		for (const weekNumber of lesson.weeks) {
			const weekOffset = weekNumber - minWeek;
			const dayDate = addDays(mondayDate, weekOffset * 7 + dayOffset);
			const startIso = isoWithHongKongOffset(dayDate, lesson.startTime);
			const endIso = isoWithHongKongOffset(dayDate, lesson.endTime);
			const occurrenceId = `${lesson.id}-${weekNumber}`;
			occurrences.push({
				id: occurrenceId,
				lessonId: lesson.id,
				title: lesson.title,
				courseCode: lesson.courseCode,
				lessonType: lesson.lessonType,
				day: lesson.day,
				weekNumber,
				startIso,
				endIso,
				venue: lesson.venue,
				instructor: lesson.instructor,
				sourceText: lesson.sourceText
			});
		}
	}

	return occurrences.sort((a, b) => {
		const startDelta = a.startIso.localeCompare(b.startIso);
		if (startDelta !== 0) {
			return startDelta;
		}
		return a.title.localeCompare(b.title);
	});
}

function isAnchorSignal(text: string): boolean {
	return Boolean(parseCourseCode(text)) || TIME_RANGE_PATTERN.test(text) || /W\s*k/i.test(text);
}

function anchorPriority(text: string): number {
	if (parseCourseCode(text)) {
		return 3;
	}
	if (TIME_RANGE_PATTERN.test(text)) {
		return 2;
	}
	if (/W\s*k/i.test(text)) {
		return 1;
	}
	return 0;
}

function missedCandidateKey(candidate: UnparsedLessonCandidate): string {
	return [
		candidate.day,
		candidate.startTime ?? '',
		candidate.endTime ?? '',
		candidate.courseCode ?? '',
		candidate.weeks.join(','),
		candidate.sourceText
	].join('|');
}

function lessonParseKey(lesson: ParsedLesson): string {
	return `${lesson.day}|${lesson.startTime}|${lesson.endTime}|${lesson.courseCode}|${lesson.weeks.join(',')}`;
}

function parseLessonsWithCandidatesFromPositionedText(items: PositionedText[]): ParseLessonsResult {
	const dayAnchors = collectDayAnchors(items);
	if (dayAnchors.length === 0) {
		throw new Error('Could not find weekday headers in the timetable PDF.');
	}

	const dayRanges = buildDayRanges(dayAnchors);
	const contentItems = items.filter((item) => item.y < 700);
	const blockCandidates = contentItems
		.filter((item) => isAnchorSignal(item.text))
		.map((item) => ({ ...item, day: findDayByX(item.x, dayRanges) }))
		.filter((item): item is PositionedText & { day: DayLabel } => Boolean(item.day));

	const dedup = new Map<string, PositionedText & { day: DayLabel; priority: number }>();
	for (const candidate of blockCandidates) {
		const key = `${candidate.day}:${Math.round(candidate.y * 2) / 2}`;
		const priority = anchorPriority(candidate.text);
		const existing = dedup.get(key);
		if (!existing || priority > existing.priority) {
			dedup.set(key, { ...candidate, priority });
		}
	}

	const groups = new Map<DayLabel, (PositionedText & { day: DayLabel; priority: number })[]>();
	for (const candidate of dedup.values()) {
		const list = groups.get(candidate.day) ?? [];
		list.push(candidate);
		groups.set(candidate.day, list);
	}

	const lessons: ParsedLesson[] = [];
	const missedCandidates: UnparsedLessonCandidate[] = [];
	for (const day of DAY_LABELS) {
		const dayCandidates = groups.get(day);
		const dayRange = dayRanges.find((range) => range.day === day);
		if (!dayRange || !dayCandidates) {
			continue;
		}

		const dayItems = contentItems
			.filter((item) => item.x >= dayRange.minX && item.x < dayRange.maxX)
			.sort((a, b) => b.y - a.y || a.x - b.x);
		const sortedCandidates = [...dayCandidates].sort((a, b) => b.y - a.y);

		for (let index = 0; index < sortedCandidates.length; index += 1) {
			const candidate = sortedCandidates[index];
			const next = sortedCandidates[index + 1];
			const lowerBoundary =
				next && candidate.y - next.y > 55 ? next.y + 1.5 : -Infinity;
			const blockItems = dayItems.filter(
				(item) => item.y <= candidate.y + 4 && item.y > lowerBoundary && item.y >= candidate.y - 145
			);
			const lessonId = `${candidate.day}-${Math.round(candidate.y)}-${parseCourseCode(candidate.text) ?? 'candidate'}`;
			const parsed = parseLessonFromBlock(blockItems, day, lessonId);
			if (parsed) {
				lessons.push(parsed);
				continue;
			}
			const unresolved = buildUnparsedCandidate(blockItems, day, lessonId);
			if (unresolved) {
				missedCandidates.push(unresolved);
			}
		}

		// Second-pass day scan for missed blocks: time + week signals in unresolved windows.
		const timeAnchors = dayItems.filter((item) => TIME_RANGE_PATTERN.test(item.text));
		for (const anchor of timeAnchors) {
			const blockItems = dayItems.filter((item) => item.y <= anchor.y + 44 && item.y >= anchor.y - 96);
			const parsed = parseLessonFromBlock(blockItems, day, `${day}-${Math.round(anchor.y)}-scan`);
			if (parsed) {
				continue;
			}
			const unresolved = buildUnparsedCandidate(
				blockItems,
				day,
				`${day}-${Math.round(anchor.y)}-scan`
			);
			if (unresolved) {
				missedCandidates.push(unresolved);
			}
		}
	}

	const unique = new Map<string, ParsedLesson>();
	for (const lesson of lessons) {
		const key = lessonParseKey(lesson);
		if (!unique.has(key)) {
			unique.set(key, lesson);
		}
	}

	const uniqueMissed = new Map<string, UnparsedLessonCandidate>();
	for (const candidate of missedCandidates) {
		const lessonKey = `${candidate.day}|${candidate.startTime ?? ''}|${candidate.endTime ?? ''}|${candidate.courseCode ?? ''}|${candidate.weeks.join(',')}`;
		if (unique.has(lessonKey)) {
			continue;
		}
		const key = missedCandidateKey(candidate);
		if (!uniqueMissed.has(key)) {
			uniqueMissed.set(key, candidate);
		}
	}

	return { lessons: sortLessons([...unique.values()]), missedCandidates: [...uniqueMissed.values()] };
}

export function parseLessonsFromPositionedText(items: PositionedText[]): ParsedLesson[] {
	return parseLessonsWithCandidatesFromPositionedText(items).lessons;
}

async function extractPositionedTextFromPdfBytes(data: Uint8Array): Promise<PositionedText[]> {
	ensurePdfJsWebViewCompatibility();
	const document = await getDocument({ data }).promise;
	const items: PositionedText[] = [];

	for (let pageIndex = 1; pageIndex <= document.numPages; pageIndex += 1) {
		const page = await document.getPage(pageIndex);
		const content = await page.getTextContent();
		for (const item of content.items as Array<{ str?: string; transform?: number[] }>) {
			const text = normalizeText(item.str ?? '');
			if (!text || !item.transform || item.transform.length < 6) {
				continue;
			}
			items.push({
				text,
				x: item.transform[4],
				y: item.transform[5]
			});
		}
	}

	return items;
}

export function rebuildPreviewFromLessons(lessons: ParsedLesson[], startWeekDate: string): ImportPreview {
	if (lessons.length === 0) {
		throw new Error('No lessons were detected from this PDF. Please review the timetable format.');
	}

	const allWeeks = lessons.flatMap((lesson) => lesson.weeks);
	const minWeek = Math.min(...allWeeks);
	const maxWeek = Math.max(...allWeeks);
	const occurrences = expandLessonsToOccurrences(lessons, startWeekDate, minWeek);

	return {
		lessons,
		occurrences,
		minWeek,
		maxWeek
	};
}

function buildImportPreview(positionedItems: PositionedText[], startWeekDate: string): ImportPreview {
	const parsed = parseLessonsWithCandidatesFromPositionedText(positionedItems);
	if (parsed.lessons.length === 0) {
		return {
			lessons: [],
			occurrences: [],
			minWeek: 0,
			maxWeek: 0,
			missedCandidates: parsed.missedCandidates
		};
	}
	const preview = rebuildPreviewFromLessons(parsed.lessons, startWeekDate);
	return {
		...preview,
		missedCandidates: parsed.missedCandidates
	};
}

export async function parseTimetablePdfBytes(data: Uint8Array, startWeekDate: string): Promise<ImportPreview> {
	const positionedItems = await extractPositionedTextFromPdfBytes(data);
	return buildImportPreview(positionedItems, startWeekDate);
}

export async function parseTimetablePdf(file: File, startWeekDate: string): Promise<ImportPreview> {
	const data = new Uint8Array(await file.arrayBuffer());
	return parseTimetablePdfBytes(data, startWeekDate);
}

export const __testables = {
	parseWeekExpression,
	parseWeekLine,
	parseLessonsFromPositionedText,
	parseLessonsWithCandidatesFromPositionedText,
	expandLessonsToOccurrences
};
