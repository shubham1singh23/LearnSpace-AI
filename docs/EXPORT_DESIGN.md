# Saved-document export design

Markdown, DOCX, and ZIP are derived from saved Tiptap JSON, never from fresh model output or a stored Markdown copy. Read [document schema](EDITOR_DESIGN.md), [database](DATABASE.md), and [API](API.md).

## Export pipeline

1. Browser flushes active autosave and resolves conflicts before requesting export. API export reads only committed data; it cannot know about unsent browser edits.
2. Acquire one per-course ExportLease under the course lock (409 EXPORT_IN_PROGRESS for a live lease), then capture a repeatable-read DB snapshot of course, ordered topics, current lesson JSON/revisions, prerequisite metadata and referenced assets. Establish ExportAsset pins before releasing the snapshot transaction. GC/deletion must also take the course lock and honor the lease even before individual pins exist, preventing a snapshot-to-pin race. Release DB transaction before rendering; retain/heartbeat the lease through stream closure. Course deletion is blocked while the lease is live.
3. Validate document schema versions and all asset references. Resolve bytes by internal asset ID through an injected root-contained resolver. No filesystem path or remote URL supplied by a document is fetched.
4. Build deterministic sanitized path manifest; convert one lesson at a time through shared node visitors to Markdown or `docx` objects. Use an explicit stack for hierarchy traversal. Bound memory by configured course/export size limits; DOCX requires per-document buffering, not whole-course buffering.
5. Generate README and manifest, then ZIP with `archiver`. Stream with backpressure, count output, abort on disconnect, release pins/temp files in `finally`. No provider/model factory imports allowed in this package.

## Exact hierarchy and filenames

One directory per container topic, one file per leaf, ordered by numeric position then ID as deterministic tie-breaker. Course root is a sanitized title. Number prefixes reflect sibling order, zero-padded to at least two digits, wider above 99. A container README records its objectives/prerequisites. The course README explains goal, preferences, progress, generated/ungenerated leaves, export time, warnings, and saved revisions. A machine-readable `manifest.json` maps IDs/revisions/assets to portable paths; it contains no model settings or credentials.

```text
Generative_AI/
  README.md
  manifest.json
  01_Foundations/
    README.md
    01_Introduction.md
    02_Large_Language_Models.md
  02_LangChain/
    01_Chat_Models.md
  assets/
    79d3f0c1-0c43-4180-afcc-10ecbe9b27c0.png
```

DOCX export replaces lesson extensions with `.docx`; README and manifest remain text. Ungenerated leaves get a valid `.md` or `.docx` placeholder headed by topic title and “Lesson has not been generated”, with objectives. This preserves exact syllabus shape and avoids generation calls or silent omissions. Containers do not own lessons; legacy invalid container documents must fail preflight with a diagnostic rather than disappear.

Sanitizer normalizes Unicode NFC, removes path separators/control characters, replaces Windows-reserved punctuation, trims trailing dots/spaces, rejects `.`/`..`, and guards reserved Windows device names. Limit each component (80 characters proposed), total ZIP entry path (220 characters initially), and encoded byte size. Long/deep hierarchies exceeding portable limits return 422 EXPORT_PATH_TOO_LONG with affected topic IDs and a rename suggestion; do not flatten hierarchy silently. Duplicate or case-fold-equivalent names gain a stable short ID suffix. Number prefixes do not replace collision detection. Validate every final entry is relative, has no drive/UNC prefix, and contains no dot-dot components. ZIP paths always use `/`.

## Markdown visitor

| Node | Mapping |
|---|---|
| Heading / paragraph / hard break | ATX heading / separated paragraph / explicit line break |
| Marks | Escape text before applying `**bold**`, `*italic*`, inline code, safe links. Strike uses `~~`; underline becomes text plus warning unless safe HTML mode is explicitly enabled. |
| Lists | Recursive indentation, ordered start numbers; preserve paragraph separation inside items |
| Blockquote / rule | `>` lines / `---` |
| Code | Fence length exceeds longest backtick run in content; sanitized language identifier; no content interpretation |
| Table | Header and alignment row; escape pipes/newlines. Headerless tables get an empty header and warning. Nested rich blocks become escaped text with warning; no silent loss. |
| Math | `$...$` inline and `$$...$$` block, preserving LaTeX source |
| Example / analogy | Clearly labeled heading or quoted labeled block preserving children |
| Reflection / recall learningRole attrs | Labeled paragraphs/questions/answers, all revealed; learningGroupId is metadata, not hidden content |
| Image | `![escaped alt](relative/path)` plus caption; encode path components safely |

For `01_Foundations/01_Introduction.md`, asset reference is `../assets/<id>.png`; deeper files compute `../` segments from their actual directory relative to course root. Do not use `/api/assets/...`, absolute OS paths, or browser object URLs. Include each asset once. Link marks accept http/https/mailto and safe in-export relative links; dangerous protocols rejected on save. Exports escape Markdown syntax and raw HTML text so user content cannot accidentally produce active tags.

## DOCX visitor

Use `docx` package with native paragraph/text runs, heading styles, numbering definitions per list, table rows/cells, hyperlinks, and ImageRun from validated bytes. Images fit page width while retaining aspect ratio; include alt text/caption. Code uses monospace shaded paragraphs, preserving whitespace as far as Word allows. Examples and analogies get labeled styled paragraphs. Quote indentation and separators are mapped explicitly.

Initial math exports readable LaTeX text labeled “Equation (LaTeX)” instead of promising native Word equations. Other known limitations: exact CSS/colors, editor selection state, collapsible reflection UI, page-break equivalence, advanced table nesting, and underline/strike differences in Markdown. Unsupported nodes fail with node type/path and lesson ID. Supported but approximate mappings appear in README and `export-warnings.json`; never silently drop content. Use only library APIs supported by the pinned `docx` version; [official docx documentation](https://docx.js.org/) is the implementation reference.

## Assets, failures, and security

Images must have a ready DB record, checksum, supported MIME, dimensions, same-course ownership, and existing bytes. Missing/corrupt assets fail preflight by default, with affected lesson/asset IDs. A future explicit degraded export could insert alt text, but is not the default. No remote image fetching during export, no arbitrary local file reads. Validated asset metadata determines extension, not originalName. Preserve asset references in document history and hold export pins until streaming finishes.

Preflight small errors before headers so response is structured JSON. Rendering may still fail later: abort ZIP/HTTP stream, record request ID and remove scratch data. Browser treats interrupted download as failure; a download is not complete merely because headers arrived. Use bounded concurrency and per-export caps; only one export per course at a time initially. Stream errors and client cancellation release all resources. Avoid writing ZIP entries through the OS using user titles.

The API owns snapshot reads, lease/pin persistence, root-contained file access and cleanup. The export package receives immutable snapshot DTOs and an asset resolver, and owns only conversion/archive traversal. Preflight checks manifest/schema/assets before sending headers. Use a 10-minute hard export deadline and a lease renewed every 15 seconds; losing renewal aborts before the lease expires. Temp staging files may be reclaimed after process death; immutable asset files are never reclaimed based on age alone. Database proposal includes lease/pin tables, so this workflow has no hidden storage dependency.

## Future structured workspace backup

Separate format version, document schema version, course/topic IDs and order, dependency graph, lesson JSON/revisions, versions (optional), progress, chat (optional), asset manifest and checksums. Include migration compatibility and creation timestamp. Never include `.env`, provider configs with secret references, session handles, keys, request logs, or raw internal storage paths. Import requires ZIP-slip prevention, decompression limits, schema/checksum validation, ID remapping, transaction boundaries and explicit collision handling. Backup/restore UI is deferred; ordinary Markdown/DOCX ZIP is not described as a restorable database backup.

## Verification

Golden fixtures cover every supported node/mark, multilingual titles, emoji, malicious paths, reserved names, case-insensitive duplicates, nested lists/tables, long fences, LaTeX, deeply nested asset links, and missing lessons. Extract ZIP and assert exact paths and asset bytes; open all Markdown relative links against the ZIP manifest. Inspect DOCX XML for text/headings/numbering/table/image relationships, render representative files during implementation when tooling is available, and visually review them in a Word-compatible viewer. Round-trip full formatting through Word is not promised. Integration tests use customized saved JSON, disable the AI adapter, and assert zero model calls. Test concurrent save/export for a consistent revision manifest, GC pin races, cancellation, corruption and size-limit failures.
