/**
 * Slim UI
 *
 * A single extension that compresses pi's status chrome into less vertical
 * space and surfaces the most useful info closer to where you type.
 *
 * What it changes:
 *
 *   1. Editor top border: right-aligned model / thinking indicator
 *      ────────────────────────────── •••  🧠 model-name ──
 *      > your prompt here
 *      ───────────────────────────────────────────────────────
 *
 *      - Dots (•) on the left of the brain show the thinking level:
 *        off=0, minimal=1, low=2, medium=3, high=4, xhigh=5.
 *      - When off, the brain icon is rendered dim (SGR 2). Most terminals
 *        mute the emoji; some ignore the sequence and keep it colorful.
 *      - Uses the same color as the editor border, which already reflects
 *        the thinking level via the built-in `updateEditorBorderColor`.
 *      - Suppressed when the model does not support reasoning (model name
 *        only), and when the top border is rendering an "↑ N more" scroll
 *        indicator.
 *
 *   2. Footer: collapsed to a single line with token status on the right
 *      ~/path/to/project (main)              ↑120 ↓340 $0.003 12%/200k
 *
 *      - Model name and thinking level are removed (they now live on the
 *        editor border).
 *      - Token stats (↑in ↓out Rcache Wcache $cost) and context % that used
 *        to sit on their own footer line are right-aligned on the pwd line.
 *      - Context % is still color-coded: >70% warning, >90% error.
 *      - Pwd is truncated with "..." if needed so the token stats always
 *        remain fully visible on the right.
 *      - Extension statuses from `setStatus()` continue to render on their
 *        own line beneath, when any are set.
 *
 * Pairs well with `quiet-thinking-cycle.ts`: that keeps "Thinking level: ..."
 * out of the chat thread, and this one shows the current level on the border.
 */

import { CustomEditor, type ExtensionAPI, type ThinkingLevel } from "@mariozechner/pi-coding-agent";
import type { AssistantMessage, Model } from "@mariozechner/pi-ai";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

/** Shared state updated from extension event handlers, read inside the editor. */
interface IndicatorState {
	getThinkingLevel: () => ThinkingLevel;
	getModel: () => Model<any> | undefined;
}

// Dim ANSI wrapper used to gray-out the brain icon when thinking is off.
// SGR 2 (faint) mutes most emoji glyphs; 22 resets it without clearing colors.
const DIM_ON = "\x1b[2m";
const DIM_OFF = "\x1b[22m";
const BRAIN = "\uD83E\uDDE0"; // 🧠

const LEVEL_DOTS: Record<ThinkingLevel, string> = {
	off: "",
	minimal: "•",
	low: "••",
	medium: "•••",
	high: "••••",
	xhigh: "•••••",
};

function formatLabel(model: Model<any> | undefined, level: ThinkingLevel): string | undefined {
	if (!model) return undefined;
	const name = model.name || model.id;
	if (!model.reasoning) return ` ${name} `;
	const brain = level === "off" ? `${DIM_ON}${BRAIN}${DIM_OFF}` : BRAIN;
	const dots = LEVEL_DOTS[level];
	const prefix = dots ? `${dots} ${brain}` : brain;
	return ` ${prefix} ${name} `;
}

class ThinkingBorderEditor extends CustomEditor {
	private readonly indicatorState: IndicatorState;

	constructor(
		tui: ConstructorParameters<typeof CustomEditor>[0],
		theme: ConstructorParameters<typeof CustomEditor>[1],
		keybindings: ConstructorParameters<typeof CustomEditor>[2],
		indicatorState: IndicatorState,
	) {
		super(tui, theme, keybindings);
		// NOTE: do not name this `state` - the base Editor class already owns a
		// `state` property (lines, cursor, etc.) and shadowing it breaks the editor.
		this.indicatorState = indicatorState;
	}

	render(width: number): string[] {
		const lines = super.render(width);
		if (lines.length === 0) return lines;

		const model = this.indicatorState.getModel();
		const label = formatLabel(model, this.indicatorState.getThinkingLevel());
		if (!label) return lines;

		const trailing = "──"; // leave a couple of border chars after the label
		const labelWidth = visibleWidth(label) + trailing.length;
		// Minimum breathing room on the left of the label
		const minLeft = 8;
		if (width < labelWidth + minLeft) return lines;

		const top = lines[0]!;
		const topWidth = visibleWidth(top);
		if (topWidth < labelWidth + minLeft) return lines;

		// Avoid clobbering the "↑ N more" scroll indicator on the left.
		// The indicator uses arrows; detect it with a simple substring check.
		if (top.includes("↑")) return lines;

		const keepWidth = width - labelWidth;
		const left = truncateToWidth(top, keepWidth, "");
		const color = this.borderColor ?? ((s: string) => s);
		lines[0] = left + color(label) + color(trailing);
		return lines;
	}
}

export default function slimUi(pi: ExtensionAPI) {
	let currentModel: Model<any> | undefined;

	const indicatorState: IndicatorState = {
		getThinkingLevel: () => pi.getThinkingLevel(),
		getModel: () => currentModel,
	};

	pi.on("session_start", (_event, ctx) => {
		currentModel = ctx.model;
		ctx.ui.setEditorComponent(
			(tui, theme, keybindings) => new ThinkingBorderEditor(tui, theme, keybindings, indicatorState),
		);

		// Install a custom footer that mirrors the built-in layout but omits
		// the model name and thinking level from the right side (they now live
		// on the editor's top border). Extension statuses, pwd, git branch,
		// session name, token stats and context % are preserved.
		ctx.ui.setFooter((_tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(() => _tui.requestRender());
			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					return renderSlimFooter(width, theme, ctx, footerData);
				},
			};
		});
	});

	pi.on("model_select", (event, _ctx) => {
		currentModel = event.model;
	});
}

// ---------------------------------------------------------------------------
// Slim footer (no model/thinking on the right side)
// ---------------------------------------------------------------------------

function sanitizeStatusText(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function renderSlimFooter(
	width: number,
	theme: { fg: (color: string, text: string) => string },
	ctx: {
		model: Model<any> | undefined;
		sessionManager: {
			getEntries(): any[];
			getCwd(): string;
			getSessionName(): string | undefined;
		};
		modelRegistry: { isUsingOAuth(model: Model<any>): boolean };
		getContextUsage(): { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
	},
	footerData: {
		getGitBranch(): string | null;
		getExtensionStatuses(): ReadonlyMap<string, string>;
	},
): string[] {
	// Usage totals
	let totalInput = 0,
		totalOutput = 0,
		totalCacheRead = 0,
		totalCacheWrite = 0,
		totalCost = 0;
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			const m = entry.message as AssistantMessage;
			totalInput += m.usage.input;
			totalOutput += m.usage.output;
			totalCacheRead += m.usage.cacheRead;
			totalCacheWrite += m.usage.cacheWrite;
			totalCost += m.usage.cost.total;
		}
	}

	// Context usage
	const contextUsage = ctx.getContextUsage();
	const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	const contextPercentValue = contextUsage?.percent ?? 0;
	const contextPercent = contextUsage?.percent !== null && contextUsage?.percent !== undefined
		? contextPercentValue.toFixed(1)
		: "?";

	// pwd line (with ~ collapsing + git branch + session name)
	let pwd = ctx.sessionManager.getCwd();
	const home = process.env.HOME || process.env.USERPROFILE;
	if (home && pwd.startsWith(home)) pwd = `~${pwd.slice(home.length)}`;
	const branch = footerData.getGitBranch();
	if (branch) pwd = `${pwd} (${branch})`;
	const sessionName = ctx.sessionManager.getSessionName();
	if (sessionName) pwd = `${pwd} \u2022 ${sessionName}`;

	// Stats line (no model / thinking on the right)
	const statsParts: string[] = [];
	if (totalInput) statsParts.push(`\u2191${formatTokens(totalInput)}`);
	if (totalOutput) statsParts.push(`\u2193${formatTokens(totalOutput)}`);
	if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
	if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);
	const usingSubscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
	if (totalCost || usingSubscription) {
		statsParts.push(`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
	}
	const ctxDisplay = contextPercent === "?"
		? `?/${formatTokens(contextWindow)}`
		: `${contextPercent}%/${formatTokens(contextWindow)}`;
	let ctxStr: string;
	if (contextPercentValue > 90) ctxStr = theme.fg("error", ctxDisplay);
	else if (contextPercentValue > 70) ctxStr = theme.fg("warning", ctxDisplay);
	else ctxStr = ctxDisplay;
	statsParts.push(ctxStr);

	let statsLine = statsParts.join(" ");
	const statsWidth = visibleWidth(statsLine);

	// Compose the single top line: pwd on the left, stats on the right.
	const dimmedPwd = theme.fg("dim", pwd);
	const dimmedStats = theme.fg("dim", statsLine);
	const pwdWidth = visibleWidth(dimmedPwd);
	const minGap = 2;

	let topLine: string;
	if (pwdWidth + minGap + statsWidth <= width) {
		// Both fit: right-align stats.
		const gap = " ".repeat(width - pwdWidth - statsWidth);
		topLine = dimmedPwd + gap + dimmedStats;
	} else if (statsWidth + minGap < width) {
		// Stats fit on the right; truncate pwd on the left.
		const availableForPwd = width - statsWidth - minGap;
		const truncatedPwd = truncateToWidth(dimmedPwd, availableForPwd, theme.fg("dim", "..."));
		const gap = " ".repeat(Math.max(minGap, width - visibleWidth(truncatedPwd) - statsWidth));
		topLine = truncatedPwd + gap + dimmedStats;
	} else {
		// Stats too wide on their own - truncate them, drop pwd.
		topLine = truncateToWidth(dimmedStats, width, theme.fg("dim", "..."));
	}

	const lines: string[] = [topLine];

	// Extension statuses line (preserved from built-in footer)
	const extensionStatuses = footerData.getExtensionStatuses();
	if (extensionStatuses.size > 0) {
		const sorted = Array.from(extensionStatuses.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([, text]) => sanitizeStatusText(text));
		lines.push(truncateToWidth(sorted.join(" "), width, theme.fg("dim", "...")));
	}
	return lines;
}
