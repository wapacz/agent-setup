#!/usr/bin/env node
// @ts-check
//
// Install pi agent extensions, pi packages and skills — cross-platform (Linux/macOS/Windows).
// Pure Node.js (>=18, built-in fetch), no external dependencies.
//
// Run:
//   node install-pi-extensions.mjs                 # installs the built-in lists below
//   node install-pi-extensions.mjs notify fetch    # only the given extensions
//
// Extension entry forms (same as the old bash script):
//   <path>                       -> uses the default repo
//   <owner>/<repo>:<path>        -> uses a specific repo
//   ...optionally "=<name>" suffix to override the install name.
// <path> may be a directory ("notify", "extensions/notify") or a single ".ts"
// file ("extensions/minimal.ts"). Directories get `bun install` if they ship a
// package.json.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const DEFAULT_REPO = "rytswd/pi-agent-extensions";
const BRANCH = "main";
const EXTENSIONS_DIR = path.join(os.homedir(), ".pi", "agent", "extensions");

// ---------------------------------------------------------------------------
// Built-in lists
// ---------------------------------------------------------------------------

// Extensions. Comment out anything you don't want.
const EXTENSIONS = [
  // rytswd/pi-agent-extensions (directory-based, run bun install)
  "rytswd/pi-agent-extensions:notify",
  "rytswd/pi-agent-extensions:fetch",
  "rytswd/pi-agent-extensions:slow-mode",
  "rytswd/pi-agent-extensions:statusline",

  // disler/pi-vs-claude-code (single-file .ts extensions)
  // "disler/pi-vs-claude-code:extensions/minimal.ts",
  // "disler/pi-vs-claude-code:extensions/coms-net.ts",
];

// Packages installed via the `pi install` CLI (npm:, git:, https://, ./local).
const PI_PACKAGES = [
  "npm:pi-provider-kiro",
  "npm:my-pi-themes",
  "npm:pi-subagents",
  "npm:@spences10/pi-themes",
  "npm:remote-pi",
  "git:github.com/obra/superpowers",
  "npm:pi-mcp-adapter",
];

// Skills installed via the `skills` CLI. Each entry is [repoUrl, skillName].
const SKILLS = [
  ["https://github.com/netresearch/context7-skill", "context7"],
  ["https://github.com/vercel-labs/agent-browser", "agent-browser"],
  ["https://github.com/vercel-labs/skills", "find-skills"],
  ["https://github.com/jimliu/baoyu-skills", "baoyu-image-gen"],
  ["https://github.com/google/agents-cli", "google-agents-cli-adk-code"],
  ["https://github.com/google/agents-cli", "google-agents-cli-deploy"],
  ["https://github.com/google/agents-cli", "google-agents-cli-eval"],
  ["https://github.com/google/agents-cli", "google-agents-cli-observability"],
  ["https://github.com/google/agents-cli", "google-agents-cli-publish"],
  ["https://github.com/google/agents-cli", "google-agents-cli-scaffold"],
  ["https://github.com/google/agents-cli", "google-agents-cli-workflow"],
  ["https://github.com/NicholasSpisak/second-brain", "second-brain"],
  ["https://github.com/NicholasSpisak/second-brain", "second-brain-ingest"],
  ["https://github.com/NicholasSpisak/second-brain", "second-brain-lint"],
  ["https://github.com/NicholasSpisak/second-brain", "second-brain-query"],
  ["https://github.com/igorwarzocha/opencode-workflows", "powerpoint"],
];

// Agents to install skills for. On Windows we copy (symlinks need Developer
// Mode / admin); on Linux/macOS we use the default symlink behavior.
const SKILL_AGENTS = ["claude-code", "pi", "kiro-cli"];
const COPY_SKILLS = process.platform === "win32";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_AGENT = "install-pi-extensions";

// Quote an argument if it contains whitespace or quotes (for shell invocation).
function shellQuote(arg) {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

// Build a single command line so we can use shell:true (needed on Windows for
// .cmd/.exe shims) WITHOUT passing an args array (avoids Node DEP0190 warning).
function buildCommandLine(command, args) {
  return [command, ...args.map(shellQuote)].join(" ");
}

/** Run a command through the shell so Windows .cmd/.exe shims resolve. */
function run(command, args = []) {
  const result = spawnSync(buildCommandLine(command, args), {
    stdio: "inherit",
    shell: true,
  });
  return result.status === 0;
}

/** Check whether a command exists on PATH. */
function hasCommand(command) {
  const probe = spawnSync(buildCommandLine(command, ["--version"]), {
    stdio: "ignore",
    shell: true,
  });
  return probe.status === 0 || probe.status === 1; // some tools exit 1 on --version
}

/** Download a single file (text or binary) to disk. */
async function downloadFile(url, destPath) {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`GET ${url} -> ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await mkdir(path.dirname(destPath), { recursive: true });
  await writeFile(destPath, buffer);
}

// Read a NUL-terminated string from a fixed-width tar header field.
function readTarField(header, start, length) {
  const raw = header.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.toString("utf8", 0, end === -1 ? length : end).trim();
}

// Minimal tar parser (ustar + GNU long names). Returns Map<path, Buffer> of files.
function parseTar(buffer) {
  const files = new Map();
  let offset = 0;
  let longName = null;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) break; // end-of-archive marker

    const size = parseInt(readTarField(header, 124, 12) || "0", 8) || 0;
    const typeflag = String.fromCharCode(header[156]);
    const blocks = Math.ceil(size / 512) * 512;

    if (typeflag === "L") {
      // GNU long filename: the real name is stored in this entry's data.
      longName = buffer.toString("utf8", offset, offset + size).replace(/\0+$/, "");
      offset += blocks;
      continue;
    }
    if (typeflag === "x" || typeflag === "g") {
      offset += blocks; // pax extended headers — ignored
      continue;
    }

    let name = longName || readTarField(header, 0, 100);
    const prefix = readTarField(header, 345, 155);
    if (!longName && prefix) name = `${prefix}/${name}`;
    longName = null;

    if (typeflag === "0" || typeflag === "\0" || typeflag === "") {
      files.set(name, Buffer.from(buffer.subarray(offset, offset + size)));
    }
    offset += blocks;
  }
  return files;
}

// Download + gunzip + parse a repo tarball from codeload (no API rate limit).
// Cached per repo so multiple extensions from the same repo download once.
const repoTarCache = new Map();
async function getRepoFiles(repo) {
  if (repoTarCache.has(repo)) return repoTarCache.get(repo);
  const url = `https://codeload.github.com/${repo}/tar.gz/refs/heads/${BRANCH}`;
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`GET ${url} -> ${response.status} ${response.statusText}`);
  }
  const gzipped = Buffer.from(await response.arrayBuffer());
  const files = parseTar(zlib.gunzipSync(gzipped));
  repoTarCache.set(repo, files);
  return files;
}

// Extract one repo directory (repoPath) into destDir, using the cached tarball.
async function downloadDir(repo, repoPath, destDir) {
  const files = await getRepoFiles(repo);
  const wantPrefix = `${repoPath}/`;
  let wrote = 0;

  for (const [fullPath, data] of files) {
    // Tarball paths are `<repo>-<branch>/<...>`; drop the top-level segment.
    const rel = fullPath.split("/").slice(1).join("/");
    if (rel !== repoPath && !rel.startsWith(wantPrefix)) continue;
    const sub = rel.slice(repoPath.length).replace(/^\/+/, "");
    const dest = sub ? path.join(destDir, sub) : destDir;
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, data);
    wrote++;
  }

  if (wrote === 0) {
    throw new Error(`path '${repoPath}' not found in ${repo}@${BRANCH}`);
  }
}

// ---------------------------------------------------------------------------
// Extension installers
// ---------------------------------------------------------------------------

async function installExtension(entry) {
  let name = "";
  const eqIndex = entry.lastIndexOf("=");
  if (eqIndex !== -1) {
    name = entry.slice(eqIndex + 1);
    entry = entry.slice(0, eqIndex);
  }

  let repo, repoPath;
  const colonIndex = entry.indexOf(":");
  if (colonIndex !== -1) {
    repo = entry.slice(0, colonIndex);
    repoPath = entry.slice(colonIndex + 1);
  } else {
    repo = DEFAULT_REPO;
    repoPath = entry;
  }

  repoPath = repoPath.replace(/^\/+|\/+$/g, "");
  const baseName = repoPath.split("/").pop();

  if (repoPath.endsWith(".ts")) {
    if (!name) name = baseName;
    if (!name.endsWith(".ts")) name += ".ts";
    const rawUrl = `https://raw.githubusercontent.com/${repo}/${BRANCH}/${repoPath}`;
    console.log(`==> Installing file '${name}' from ${repo}/${repoPath}`);
    await downloadFile(rawUrl, path.join(EXTENSIONS_DIR, name));
    console.log(`==> Done: ${name}`);
  } else {
    if (!name) name = baseName;
    const targetDir = path.join(EXTENSIONS_DIR, name);
    console.log(`==> Installing dir '${name}' from ${repo}/${repoPath}`);
    await downloadDir(repo, repoPath, targetDir);
    if (existsSync(path.join(targetDir, "package.json"))) {
      if (hasCommand("bun")) {
        run("bun", ["install", "--cwd", targetDir]);
      } else {
        console.warn(`!! 'bun' not found — skipping 'bun install' for ${name}`);
      }
    }
    console.log(`==> Done: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const builtinRun = args.length === 0;
  const extensions = builtinRun ? EXTENSIONS : args;

  for (const entry of extensions) {
    try {
      await installExtension(entry);
    } catch (error) {
      console.error(`!! Failed: ${entry}\n   ${error.message}`);
    }
  }

  if (builtinRun && PI_PACKAGES.length > 0) {
    if (hasCommand("pi")) {
      for (const pkg of PI_PACKAGES) {
        console.log(`==> pi install ${pkg}`);
        if (!run("pi", ["install", pkg])) {
          console.error(`!! pi install failed: ${pkg}`);
        }
      }
    } else {
      console.warn("!! 'pi' not found on PATH — skipping pi install packages:");
      for (const pkg of PI_PACKAGES) console.warn(`   - ${pkg}`);
    }
  }

  if (builtinRun && SKILLS.length > 0) {
    // Snapshot of already-installed skills so we skip re-adding them.
    const listed = spawnSync(buildCommandLine("npx", ["skills", "list"]), {
      encoding: "utf8",
      shell: true,
    });
    const installed = listed.stdout || "";
    const isInstalled = (skillName) =>
      new RegExp(`\\b${skillName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(
        installed
      );

    for (const [repoUrl, skillName] of SKILLS) {
      if (isInstalled(skillName)) {
        console.log(`== Skip (already installed): ${skillName}`);
        continue;
      }
      const agentArgs = SKILL_AGENTS.flatMap((agent) => ["--agent", agent]);
      const copyArgs = COPY_SKILLS ? ["--copy"] : [];
      console.log(
        `==> npx skills add ${repoUrl} --skill ${skillName} --agent ${SKILL_AGENTS.join(" ")} --global${COPY_SKILLS ? " --copy" : ""}`
      );
      run("npx", ["skills", "add", repoUrl, "--skill", skillName, ...agentArgs, "--global", ...copyArgs, "-y"]);
    }

    // Update all globally-installed skills to their latest versions.
    console.log("==> npx skills update --global");
    run("npx", ["skills", "update", "--global", "-y"]);
  }

  console.log("All extensions installed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
