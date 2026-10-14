import { describe, expect, test } from 'bun:test';
import { detectTheme, isTerminalTheme, themeFromColorFgBg, themeFromOscReply } from '../src/render/theme';

describe('themeFromOscReply', () => {
	test('reads the background colour of an OSC 11 reply', () => {
		expect(themeFromOscReply('\x1b]11;rgb:ffff/ffff/ffff\x07')).toBe('light');
		expect(themeFromOscReply('\x1b]11;rgb:0000/0000/0000\x1b\\')).toBe('dark');
		// Solarized light and dark backgrounds, two hex digits per channel
		expect(themeFromOscReply('\x1b]11;rgb:fd/f6/e3\x07')).toBe('light');
		expect(themeFromOscReply('\x1b]11;rgb:00/2b/36\x07')).toBe('dark');
	});

	test('ignores the DA1 reply that follows and returns null without an OSC 11 colour', () => {
		expect(themeFromOscReply('\x1b]11;rgb:ffff/ffff/ffff\x07\x1b[?62;22c')).toBe('light');
		expect(themeFromOscReply('\x1b[?62;22c')).toBeNull();
		expect(themeFromOscReply('')).toBeNull();
	});
});

describe('themeFromColorFgBg', () => {
	test('uses the last field as the background colour index', () => {
		expect(themeFromColorFgBg('0;15')).toBe('light');
		expect(themeFromColorFgBg('0;7')).toBe('light');
		expect(themeFromColorFgBg('15;0')).toBe('dark');
		expect(themeFromColorFgBg('15;default;0')).toBe('dark');
	});

	test('returns null when unset or malformed', () => {
		expect(themeFromColorFgBg(undefined)).toBeNull();
		expect(themeFromColorFgBg('')).toBeNull();
		expect(themeFromColorFgBg('15;default')).toBeNull();
	});
});

describe('detectTheme', () => {
	test("falls back to COLORFGBG, then dark, when there's no terminal to ask", async () => {
		// NO_COLOR keeps detectTheme from querying the terminal, even when `bun test` runs in one.
		const saved = { colorFgBg: process.env.COLORFGBG, noColor: process.env.NO_COLOR };
		process.env.NO_COLOR = '1';
		delete process.env.COLORFGBG;
		expect(await detectTheme()).toBe('dark');
		process.env.COLORFGBG = '0;15';
		expect(await detectTheme()).toBe('light');
		for (const [key, value] of [
			['COLORFGBG', saved.colorFgBg],
			['NO_COLOR', saved.noColor]
		] as const) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});
});

describe('isTerminalTheme', () => {
	test('accepts light and dark only', () => {
		expect(isTerminalTheme('light')).toBe(true);
		expect(isTerminalTheme('dark')).toBe(true);
		expect(isTerminalTheme('auto')).toBe(false);
	});
});
