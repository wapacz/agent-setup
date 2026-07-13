/**
 * AWS SSO Auto Re-login
 *
 * When a model (provider) request fails because the AWS SSO token has expired,
 * pi surfaces an assistant message with stopReason "error" whose errorMessage
 * reads roughly:
 *
 *   Error: Token is expired. To refresh this SSO session run 'aws sso login'
 *   with the corresponding profile.
 *
 * This extension detects that specific failure, runs the configured
 * `aws sso login` command, waits for it to succeed (exit code 0 — even when
 * the CLI merely reports the session was renewed), and then automatically
 * re-sends the user prompt whose turn failed, so the request is retried.
 *
 * Interception point: the model request (e.g. Amazon Bedrock via AWS SSO),
 * NOT bash `aws ...` tool calls.
 *
 * Location: ~/.pi/agent/extensions/aws-sso-auto-relogin.ts (global).
 * Reload with /reload after editing.
 */

import { spawn } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// --- Configuration -----------------------------------------------------------

/**
 * Command used to refresh the AWS SSO session. Runs through `bash -c`, so the
 * inline `BROWSER=...` assignment and `~` expansion behave like a normal shell.
 * Override with the PI_AWS_SSO_LOGIN_COMMAND environment variable if needed.
 */
const ssoLoginCommand =
	process.env.PI_AWS_SSO_LOGIN_COMMAND ??
	"BROWSER=~/aws-browser-profile-6.sh aws sso login --sso-session my-admin";

/** Matches the expired-SSO-token error that pi shows in chat. */
const expiredTokenErrorPattern = /token is expired[\s\S]*aws sso login/i;

/** Maximum automatic login+retry attempts per detected token expiry. */
const maximumAutomaticRetries = 1;

/**
 * How long to wait for the login command before giving up (milliseconds).
 * The command blocks until you finish authenticating in the browser, so keep
 * this generous. Override with PI_AWS_SSO_LOGIN_TIMEOUT_MS.
 */
const loginTimeoutMilliseconds = Number(process.env.PI_AWS_SSO_LOGIN_TIMEOUT_MS) || 600_000;

const statusKey = "aws-sso-auto-relogin";

// --- Helpers -----------------------------------------------------------------

/** Extract plain text from a user message's content. */
function extractUserMessageText(message: unknown): string {
	if (!message || typeof message !== "object") return "";
	const candidate = message as { role?: string; content?: unknown };
	if (candidate.role !== "user") return "";
	const content = candidate.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((part) => part && typeof part === "object" && (part as { type?: string }).type === "text")
			.map((part) => (part as { text?: string }).text ?? "")
			.join("\n");
	}
	return "";
}

/** True if this assistant message is the expired-SSO-token failure. */
function isExpiredSsoTokenError(message: unknown): boolean {
	if (!message || typeof message !== "object") return false;
	const candidate = message as { role?: string; stopReason?: string; errorMessage?: string };
	return (
		candidate.role === "assistant" &&
		candidate.stopReason === "error" &&
		typeof candidate.errorMessage === "string" &&
		expiredTokenErrorPattern.test(candidate.errorMessage)
	);
}

/**
 * Run the SSO login command through bash. Resolves with the exit code and
 * captured output. A non-zero exit code (or timeout) is treated as failure.
 */
function runSsoLogin(): Promise<{ exitCode: number; combinedOutput: string }> {
	return new Promise((resolve) => {
		const loginProcess = spawn("bash", ["-c", ssoLoginCommand], {
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let combinedOutput = "";
		let settled = false;

		const finish = (exitCode: number) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutHandle);
			resolve({ exitCode, combinedOutput });
		};

		const timeoutHandle = setTimeout(() => {
			loginProcess.kill("SIGTERM");
			finish(124);
		}, loginTimeoutMilliseconds);

		loginProcess.stdout?.on("data", (chunk) => {
			combinedOutput += chunk.toString();
		});
		loginProcess.stderr?.on("data", (chunk) => {
			combinedOutput += chunk.toString();
		});
		loginProcess.on("error", (error) => {
			combinedOutput += `\n${error.message}`;
			finish(127);
		});
		loginProcess.on("close", (code) => finish(code ?? 1));
	});
}

// --- Extension ---------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	// Per-session runtime state. Reset on session start / shutdown.
	let automaticRetryCount = 0;
	let loginInProgress = false;

	const resetState = () => {
		automaticRetryCount = 0;
		loginInProgress = false;
	};

	pi.on("session_start", () => resetState());
	pi.on("session_shutdown", () => resetState());

	// Keep the model from ever seeing its own failed (expired-token) attempt,
	// so retries stay clean and consecutive.
	pi.on("context", (event) => {
		const filteredMessages = event.messages.filter((message) => !isExpiredSsoTokenError(message));
		if (filteredMessages.length === event.messages.length) return;
		return { messages: filteredMessages };
	});

	pi.on("agent_end", async (event, ctx) => {
		const failedMessageIndex = event.messages.findIndex((message) => isExpiredSsoTokenError(message));

		// The turn succeeded (or failed for an unrelated reason): clear the retry budget.
		if (failedMessageIndex === -1) {
			automaticRetryCount = 0;
			return;
		}

		if (loginInProgress) return;

		if (automaticRetryCount >= maximumAutomaticRetries) {
			automaticRetryCount = 0;
			notify(
				ctx,
				`AWS SSO login didn't resolve the expired token. Run manually:\n  ${ssoLoginCommand}`,
				"error",
			);
			return;
		}

		// Find the user prompt that triggered the failed turn, to re-send it.
		let originalPromptText = "";
		for (let index = failedMessageIndex - 1; index >= 0; index--) {
			const text = extractUserMessageText(event.messages[index]);
			if (text) {
				originalPromptText = text;
				break;
			}
		}
		if (!originalPromptText) {
			// Fall back to a generic nudge if the prompt text can't be recovered.
			originalPromptText = "Continue with my previous request.";
		}

		loginInProgress = true;
		automaticRetryCount += 1;
		ctx.ui.setStatus(statusKey, "AWS SSO expired — finish login in your browser…");
		notify(
			ctx,
			"AWS SSO token expired — running 'aws sso login'. Complete the login in your browser; the request retries automatically afterwards.",
			"warning",
		);

		let loginResult: { exitCode: number; combinedOutput: string };
		try {
			loginResult = await runSsoLogin();
		} catch (error) {
			loginResult = { exitCode: 1, combinedOutput: String(error) };
		} finally {
			ctx.ui.setStatus(statusKey, undefined);
			loginInProgress = false;
		}

		if (loginResult.exitCode !== 0) {
			automaticRetryCount = 0;
			const tail = loginResult.combinedOutput.trim().split("\n").slice(-3).join("\n");
			notify(
				ctx,
				`AWS SSO login failed (exit ${loginResult.exitCode}). Retry aborted.` +
					(tail ? `\n${tail}` : ""),
				"error",
			);
			return;
		}

		notify(ctx, "AWS SSO session refreshed — retrying the request.", "info");
		pi.sendUserMessage(originalPromptText, { deliverAs: "followUp" });
	});
}

/** Notify via the TUI when available, otherwise log to stderr. */
function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error") {
	if (ctx.hasUI) {
		ctx.ui.notify(message, level);
	} else {
		console.error(`[aws-sso-auto-relogin] ${message}`);
	}
}
