import type { TerminalTheme } from '../../types/grid';

// Light or dark terminal? Ask the terminal for its background colour (OSC 11) and follow it
// with a device-attributes query (DA1), which every terminal answers: if DA1's reply arrives
// without an OSC 11 reply, the terminal doesn't support the question and there's no need to
// wait. Without a terminal to ask, fall back to COLORFGBG, then to dark.

const OSC11_QUERY = '\x1b]11;?\x07';
const DA1_QUERY = '\x1b[c';
const SAFETY_TIMEOUT_MS = 1000;

/**
 * Check that a CLI string names a theme.
 *
 * @returns true (narrowing the type) for "light" or "dark".
 * Called by: cli.
 * Calls: nothing.
 */
export const isTerminalTheme = (value: string): value is TerminalTheme => value === 'light' || value === 'dark';

/**
 * Read a theme from an OSC 11 reply such as `\x1b]11;rgb:ffff/ffff/ffff\x07`. Each channel
 * has 1–4 hex digits; the background counts as light when its relative luminance is above 0.5.
 *
 * @returns "light" or "dark", or null when the text holds no OSC 11 colour.
 * Called by: queryTerminalTheme, tests.
 * Calls: nothing.
 */
export function themeFromOscReply(reply: string): TerminalTheme | null {
	const match = /\]11;rgb:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})/i.exec(reply);
	if (!match) return null;
	const [red, green, blue] = match.slice(1, 4).map((hex) => parseInt(hex, 16) / (16 ** hex.length - 1));
	const luminance = 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
	return luminance > 0.5 ? 'light' : 'dark';
}

/**
 * Read a theme from the COLORFGBG variable some terminals set (`"fg;bg"`, sometimes with a
 * middle field). Its last field is the background's ANSI colour index: 7 (light grey) and 15
 * (white) are light backgrounds, everything else is treated as dark.
 *
 * @returns "light" or "dark", or null when the variable is unset or malformed.
 * Called by: detectTheme, tests.
 * Calls: nothing.
 */
export function themeFromColorFgBg(value: string | undefined): TerminalTheme | null {
	const background = Number(value?.split(';').at(-1));
	if (!value || !Number.isInteger(background)) return null;
	return background === 7 || background === 15 ? 'light' : 'dark';
}

/**
 * Ask the terminal for its background colour. Puts stdin into raw mode for the exchange and
 * restores it afterwards. Resolves as soon as the DA1 reply arrives (or the safety timeout
 * passes), so terminals that ignore OSC 11 cost a round trip, not a fixed delay.
 *
 * @returns the theme from the reply, or null when the terminal didn't report a colour.
 * Called by: detectTheme.
 * Calls: themeFromOscReply.
 */
function queryTerminalTheme(): Promise<TerminalTheme | null> {
	return new Promise((resolve) => {
		const stdin = process.stdin;
		let replies = '';
		const finish = () => {
			clearTimeout(timer);
			stdin.off('data', onData);
			stdin.setRawMode(false);
			stdin.pause();
			resolve(themeFromOscReply(replies));
		};
		const onData = (chunk: Buffer) => {
			replies += chunk.toString('latin1');
			// DA1 replies look like ESC [ ? 6 2 ; … c and always come after the OSC 11 reply.
			if (/\[\?[\d;]*c/.test(replies)) finish();
		};
		stdin.setRawMode(true);
		stdin.resume();
		stdin.on('data', onData);
		const timer = setTimeout(finish, SAFETY_TIMEOUT_MS);
		process.stdout.write(OSC11_QUERY + DA1_QUERY);
	});
}

/**
 * Decide whether the terminal grid should use the light or dark colour ramp. Only asks the
 * terminal when both stdin and stdout are a TTY and colour is on; otherwise reads COLORFGBG.
 *
 * @returns the detected theme, "dark" when nothing could be detected.
 * Called by: cli.
 * Calls: queryTerminalTheme, themeFromColorFgBg.
 */
export async function detectTheme(): Promise<TerminalTheme> {
	const interactive = process.stdin.isTTY && process.stdout.isTTY && !process.env.NO_COLOR;
	const fromTerminal = interactive ? await queryTerminalTheme() : null;
	return fromTerminal ?? themeFromColorFgBg(process.env.COLORFGBG) ?? 'dark';
}
