/*
 * Ride Leader Games — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version. This program is distributed WITHOUT ANY WARRANTY;
 * see the GNU General Public License <https://www.gnu.org/licenses/> for details.
 *
 * Pure logic for the pre-release hygiene scan: given a file's path + text, return findings for
 * leaked secrets, machine-local absolute paths, personal identifiers, and missing SPDX/copyright
 * headers. No filesystem or network side effects — kept headless so test/release-scan.mjs can
 * exercise it directly. The CLI wrapper (scripts/scan-release.mjs) walks the shipped file set and
 * feeds each file through here.
 *
 * Severity: 'error' findings BLOCK a release (definite leak / unlicensed file); 'warn' findings are
 * lower-confidence and printed for a human to eyeball. A line containing SUPPRESS_MARKER opts that
 * one line out (for documented examples).
 */

// Put this exact token in a comment on a line to silence findings on that line.
export const SUPPRESS_MARKER = 'release-scan-allow';

// Source files that must carry the copyright/SPDX header. Data/docs/binaries are exempt.
const HEADER_EXTS = new Set(['.mjs', '.js', '.cjs', '.html', '.css', '.scss']);

// Header is considered present if this appears near the top of the file.
const HEADER_NEEDLE = 'SPDX-License-Identifier';
const HEADER_SCAN_BYTES = 2048;

/*
 * Structured secret / key detectors. Each pattern is deliberately specific (a recognizable prefix +
 * length) so it almost never fires on ordinary code — we intentionally do NOT include a generic
 * "long hex/base64 blob" rule, because that would flag legitimate SHA-256 test vectors and hashes.
 * `redact: true` means the matched value is masked before it is ever printed, so the scan output
 * itself never re-leaks the secret.
 */
export const RULES = [
    {
        id: 'private-key',
        severity: 'error',
        label: 'private key block',
        redact: true,
        re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
    },
    {
        id: 'aws-access-key',
        severity: 'error',
        label: 'AWS access key id',
        redact: true,
        re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    },
    {
        id: 'github-token',
        severity: 'error',
        label: 'GitHub token',
        redact: true,
        re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
    },
    {
        id: 'slack-token',
        severity: 'error',
        label: 'Slack token',
        redact: true,
        re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    },
    {
        id: 'google-api-key',
        severity: 'error',
        label: 'Google API key',
        redact: true,
        re: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    },
    {
        id: 'sk-token',
        severity: 'error',
        label: 'API secret key (sk-…)',
        redact: true,
        re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}\b/g,
    },
    {
        id: 'jwt',
        severity: 'error',
        label: 'JSON Web Token',
        redact: true,
        re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    },
    {
        id: 'assigned-secret',
        severity: 'error',
        label: 'hard-coded credential',
        redact: true,
        // keyword as a whole word, then =/:, then a quoted value of some length.
        re: /\b(?:passwd|password|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|token)\b\s*[:=]\s*(['"])([^'"]{6,})\1/gi,
        // The credential is capture group 2; a bare placeholder is not a real leak.
        value: m => m[2],
        placeholder: true,
    },
    {
        id: 'email',
        severity: 'warn',
        label: 'email address',
        re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    },
];

// Values that look like a secret assignment but are obviously not one.
const PLACEHOLDER_VALUE = /^(?:x+|\.+|\*+|-+|_+|changeme|change[_-]?me|your[_-].*|my[_-].*|<.*>|%.*%|\$\{?[a-z_]+\}?|example.*|sample.*|dummy.*|fake.*|test.*|todo|tbd|none|null|nil|undefined|placeholder|redacted|xxx+)$/i;

// A path's user segment that is a documentation placeholder rather than a real, private user name.
const PLACEHOLDER_SEGMENT = /^(?:<[^/\\]*>|%[^/\\]*%|\$\{?[a-z_][a-z0-9_]*\}?|you|user|username|name|me|home)$/i;

/* Mask the middle of a matched value so scan output never reprints a live secret. */
export function redact(value) {
    const s = String(value);
    if (s.length <= 8) {
        return s[0] + '…' + (s.length > 1 ? s[s.length - 1] : '');
    }
    return s.slice(0, 4) + '…' + s.slice(-2);
}

/* NUL-byte sniff over the head of a buffer — good enough to skip images/binaries. */
export function isBinary(buf) {
    const n = Math.min(buf.length, 8000);
    for (let i = 0; i < n; i++) {
        if (buf[i] === 0) {
            return true;
        }
    }
    return false;
}

function extname(p) {
    const base = p.replace(/\\/g, '/').split('/').pop() || '';
    const dot = base.lastIndexOf('.');
    return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

/* Whether a file at this path is expected to carry the copyright/SPDX header. */
export function needsHeader(path) {
    return HEADER_EXTS.has(extname(path));
}

/* Whether the header needle appears near the top of the text. */
export function hasHeader(text) {
    return text.slice(0, HEADER_SCAN_BYTES).includes(HEADER_NEEDLE);
}

/*
 * Absolute-path detection. This is context-sensitive rather than a flat regex:
 *   - a placeholder user segment (`C:\Users\<you>\…`, `/Users/$USER/…`) is intentional docs → skip;
 *   - a path carrying one of `privateTokens` (this machine's real username / home dir) is a genuine
 *     leak → 'error';
 *   - any other concrete machine path (a drive-letter root, or a Unix Users/home/root path) is
 *     → 'warn' (worth a look — could be a hard-coded path or fine documentation).
 * Host-absolute *web* paths used by the mod (`/pages/src/common.mjs`, `url(/pages/…)`) are NOT
 * matched: they have no drive letter and do not start with /Users|/home|/root.
 */
const WIN_PATH = /(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s'"`)]*/g;
const NIX_PATH = /(?<![A-Za-z0-9._-])\/(?:Users|home|root)\/[^\s'"`)]*/g;

function classifyPath(match, privateTokens) {
    const lower = match.toLowerCase();
    const segments = match.split(/[\\/]/).filter(Boolean);
    // The user segment is the one right after a `Users`/`home` marker (`C:\Users\<who>`,
    // `/home/<who>`). If that segment is a documentation placeholder (`<you>`, `$USER`, `%USER%`),
    // the path is intentional example text, not a real machine path.
    const markerIdx = segments.findIndex(s => /^(?:users|home)$/i.test(s));
    const userSeg = markerIdx >= 0 ? segments[markerIdx + 1] : undefined;
    if (userSeg && PLACEHOLDER_SEGMENT.test(userSeg)) {
        return null;  // documentation placeholder, not a real path
    }
    for (const tok of privateTokens) {
        if (tok && lower.includes(tok.toLowerCase())) {
            return 'error';  // this machine's own username / home dir leaked
        }
    }
    return 'warn';
}

function detectPaths(line, privateTokens, re, ruleId) {
    const out = [];
    for (const m of line.matchAll(re)) {
        const severity = classifyPath(m[0], privateTokens);
        if (!severity) {
            continue;
        }
        out.push({
            ruleId,
            severity,
            label: severity === 'error' ? 'machine-local absolute path (personal)' : 'absolute path',
            col: m.index + 1,
            snippet: m[0].length > 80 ? m[0].slice(0, 80) + '…' : m[0],
        });
    }
    return out;
}

/*
 * Scan one file's text. Returns findings: {path, line, col, ruleId, severity, label, snippet}.
 * `privateTokens` are strings whose presence in an absolute path escalates it to an error
 * (typically this machine's OS username and home-dir segments); pass [] for a machine-agnostic scan.
 * Header findings are added by the caller via headerFinding(); this only scans line content.
 */
export function scanText({path, text, privateTokens = []}) {
    const findings = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes(SUPPRESS_MARKER)) {
            continue;
        }
        const lineNo = i + 1;
        const push = f => findings.push({path, line: lineNo, ...f});

        for (const rule of RULES) {
            rule.re.lastIndex = 0;
            for (const m of line.matchAll(rule.re)) {
                const value = rule.value ? rule.value(m) : m[0];
                if (rule.placeholder && PLACEHOLDER_VALUE.test(value.trim())) {
                    continue;
                }
                push({
                    ruleId: rule.id,
                    severity: rule.severity,
                    label: rule.label,
                    col: m.index + 1,
                    snippet: rule.redact ? redact(value) : value,
                });
            }
        }
        for (const f of detectPaths(line, privateTokens, WIN_PATH, 'abs-path-win')) {
            push(f);
        }
        for (const f of detectPaths(line, privateTokens, NIX_PATH, 'abs-path-nix')) {
            push(f);
        }
    }
    return findings;
}

/*
 * Produce a missing-header finding for a file that should have one, or null if it's fine / exempt.
 * Kept separate from scanText so callers can decide per-file (e.g. skip binaries) before reading
 * the whole text as a string.
 */
export function headerFinding({path, text}) {
    if (!needsHeader(path) || hasHeader(text)) {
        return null;
    }
    return {
        path,
        line: 1,
        col: 1,
        ruleId: 'missing-header',
        severity: 'error',
        label: 'missing copyright / SPDX header',
        snippet: `no "${HEADER_NEEDLE}" in first ${HEADER_SCAN_BYTES} bytes`,
    };
}

/* Convenience: full scan of one file (content rules + header), given its raw text. */
export function scanFile({path, text, privateTokens = []}) {
    const findings = scanText({path, text, privateTokens});
    const hf = headerFinding({path, text});
    if (hf) {
        findings.push(hf);
    }
    return findings;
}
