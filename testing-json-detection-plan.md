# Plan: testing.json-Based Test Detection

## Top-Level Overview

Replace the `testSourceFiles` VS Code setting and the global `.vscode/testing.json` / `VSCODE.FILE/TESTING.JSON` config hierarchy with a new model where a **`testing.json` file in the same directory as the tests** is the sole authority for both **discovering** and **filtering** tests.

- **Local files**: VS Code file watchers watch for `testing.json` files across all workspace folders. When one is found (or changes), the `testSuites.include`/`exclude` glob patterns inside it drive which files in that directory are surfaced as test items. **If no `testing.json` exists in a directory, no tests are detected from it (strict opt-in model).**
- **QSYS members**: On connection, for all libraries in the full library list, a single SQL query finds source files that contain a `TESTING.JSON` member. The `testSuites.include`/`exclude` patterns inside it (member-name glob patterns, not file paths) drive which members from that source file are surfaced as test items.
- The `testSourceFiles` setting is fully removed from `package.json`, `src/configuration.ts`, `src/extension.ts`, and `src/manager.ts`.
- The global config fallback (`GLOBAL_CONFIG_DIRECTORY`/`GLOBAL_CONFIG_SOURCE_FILE`) is removed from `api/config.ts`.
- The `testing.json` schema (`schemas/testing.json`) gains a `testSuites` block.
- The `cli` tool's `--source-files` option is **removed entirely**; the CLI discovers tests the same way as the extension.
- Documentation in `docs/writing.mdx` and `docs/configuring.mdx` must be updated.

### Confirmed Design Decisions
| Question | Decision |
|---|---|
| Local: no `testing.json` in directory? | **Strict** — no tests detected from that directory |
| QSYS: scope of discovery? | **All source files across all libraries in the library list** via a single SQL query for `TESTING.JSON` members |
| CLI `--source-files`? | **Removed** — discovery is fully driven by `TESTING.JSON` |
| `testing.json` change reaction? | **Live sync** — immediately remove stale and add newly matching test items |

---

## Sub-Tasks

---

### Sub-Task 1 — Add `testSuites` to the `TestingConfig` type and JSON schema

**Intent**  
Extend the data model so `testing.json` can carry include/exclude patterns that control which files or members in its directory/source-file are detected as tests. This is the foundation every other sub-task depends on.

**Expected Outcomes**
- `TestingConfig` in `api/types.ts` has an optional `testSuites` field.
- `schemas/testing.json` validates and auto-completes the new `testSuites` block.
- Default snippet in `schemas/testing.json` includes the `testSuites` block (with separate local and QSYS defaults documented via description).
- Existing fields are untouched.

**Todo List**
1. In `api/types.ts`, add `testSuites?: TestSuitesConfig` to `TestingConfig` and define the interface:
   ```ts
   export interface TestSuitesConfig {
       include: string[];
       exclude: string[];
   }
   ```
2. Add the `testSuites` property to `schemas/testing.json` with:
   - `include`: array of strings (glob patterns for local, member-name patterns for QSYS)
   - `exclude`: array of strings
   - Descriptions noting the local vs QSYS defaults
3. Update the `defaultSnippets` in `schemas/testing.json` to include a `testSuites` block using the local defaults.

**Relevant Context**
- [`TestingConfig`](api/types.ts:152) — the config interface to extend
- [`schemas/testing.json`](schemas/testing.json) — the JSON schema for IntelliSense and validation
- Local default patterns: `**/*.TEST.RPGLE`, `**/*.TEST.SQLRPGLE`, `**/*.TEST.CBLLE`, `**/*.TEST.SQLCBLLE`
- QSYS default patterns: `T*.RPGLE`, `T*.SQLRPGLE`, `T*.CBLLE`, `T*.SQLCBLLE`

**Status**: `[ ] pending`

---

### Sub-Task 2 — Remove `testSourceFiles` from configuration

**Intent**  
Eliminate the `testSourceFiles` VS Code setting entirely since source-file scope is now encoded in each `testing.json`.

**Expected Outcomes**
- `"IBM i Testing.testSourceFiles"` property removed from `package.json`.
- `Section.testSourceFiles` enum value removed from `src/configuration.ts`.
- `defaultConfigurations[Section.testSourceFiles]` removed from `src/configuration.ts`.
- The `event.affectsConfiguration(... Section.testSourceFiles)` handler removed from `src/extension.ts`.
- All call sites in `src/manager.ts` that read `Section.testSourceFiles` removed.

**Todo List**
1. Remove `"IBM i Testing.testSourceFiles"` from `contributes.configuration.properties` in `package.json`.
2. Remove `testSourceFiles = 'testSourceFiles'` from the `Section` enum in `src/configuration.ts`.
3. Remove the `[Section.testSourceFiles]: ['QTESTSRC']` entry from `defaultConfigurations` in `src/configuration.ts`.
4. Remove the `ValueType` union member `string[]` if it becomes unused (or keep if still needed elsewhere).
5. Remove the `if (event.affectsConfiguration(...Section.testSourceFiles))` block from `src/extension.ts`.
6. Remove both usages of `Configuration.getOrFallback<string[]>(Section.testSourceFiles)` from `src/manager.ts` (lines 135 and 403).

**Relevant Context**
- [`package.json`](package.json:62-73) — setting declaration
- [`src/configuration.ts`](src/configuration.ts:24) — `Section` enum and defaults
- [`src/extension.ts`](src/extension.ts:41-45) — config change handler
- [`src/manager.ts`](src/manager.ts:135) and [`src/manager.ts`](src/manager.ts:403) — two consumers

**Status**: `[ ] pending`

---

### Sub-Task 3 — Remove global config fallback from `api/config.ts`

**Intent**  
Drop the two-level hierarchy (directory config + global `.vscode` / `VSCODE.FILE` fallback). A `testing.json` now only applies to the directory or source file it sits in — no global inheritance.

**Expected Outcomes**
- `LocalConfigHandler.getConfig()` reads only the `testing.json` in the **immediate directory** of the test file — no longer walks up to `.vscode/testing.json`.
- `IfsConfigHandler.getConfig()` reads only the `testing.json` in the **immediate IFS directory** of the test file — no longer walks up to `.vscode/testing.json` on the IFS root.
- `QsysConfigHandler.getConfig()` reads only the `TESTING.JSON` member in the **same source file** as the test — no longer checks `VSCODE.FILE/TESTING.JSON`.
- `lodash.merge` global+directory merge logic removed from all three handlers.
- Constants `GLOBAL_CONFIG_DIRECTORY` and `GLOBAL_CONFIG_SOURCE_FILE` removed.
- The recursive `findConfig` helper in `LocalConfigHandler` and `IfsConfigHandler` is simplified to only look in the **immediate parent directory** (no recursion).

**Todo List**
1. Remove `GLOBAL_CONFIG_DIRECTORY` and `GLOBAL_CONFIG_SOURCE_FILE` constants from `api/config.ts`.
2. In `LocalConfigHandler.getConfig()`: remove the global config read, remove the `lodash.merge`, return the directory-level config directly.
3. Simplify `LocalConfigHandler.findConfig()` to check only the direct parent of `localPath` (remove recursion / the `workspaceFolderPath` boundary walk).
4. In `IfsConfigHandler.getConfig()`: same treatment as Local.
5. Simplify `IfsConfigHandler.findConfig()` identically.
6. In `QsysConfigHandler.getConfig()`: remove the global `VSCODE.FILE` config read, remove the `lodash.merge`, return the source-file-level config directly.
7. If `lodash` / `lodash.merge` is only used in `api/config.ts`, remove the import and dependency.

**Relevant Context**
- [`api/config.ts`](api/config.ts) — all three config handlers
- `GLOBAL_CONFIG_DIRECTORY = '.vscode'` / `GLOBAL_CONFIG_SOURCE_FILE = 'VSCODE'` at top of file
- `lodash.merge({}, globalConfig, directoryConfig)` pattern in each handler

**Status**: `[ ] pending`

---

### Sub-Task 4 — Rework local test detection in `src/manager.ts` to be `testing.json`-driven

**Intent**  
Replace the current approach of scanning for test files by suffix pattern across the whole workspace with a two-step approach:
1. Find all `testing.json` files in workspace folders.
2. For each `testing.json`, resolve its `testSuites.include`/`exclude` patterns **relative to the directory containing that `testing.json`** to discover which test files belong to it.

This is the core behavioural change for local files.

**Expected Outcomes**
- `getWorkspaceTestPatterns()` in `src/manager.ts` is replaced or repurposed to return patterns for `**/testing.json` files instead of test file suffixes.
- `loadInitialTests()` iterates found `testing.json` files, reads their `testSuites` config (using defaults when absent), applies `include`/`exclude` globs scoped to that directory, and loads matching test files.
- `loadFileOrMember()` for `uri.scheme === 'file'` no longer filters by suffix alone; it also requires that the file matches the `include`/`exclude` of the nearest `testing.json`.
- Test items are still grouped under workspace → directory → file in the test explorer (existing hierarchy unchanged).
- `startWatchingWorkspace()` is split into two watcher concerns (see Sub-Task 5).

**Todo List**
1. Add a helper `readLocalTestingJson(dirUri: Uri): Promise<TestingConfig | undefined>` that reads and parses the `testing.json` in a given directory, returning `undefined` if it does not exist.
2. Add a helper `getLocalDefaultTestSuites(): TestSuitesConfig` that returns the default `include`/`exclude` for local files.
3. Rewrite `loadInitialTests()` local section:
   - Use `workspace.findFiles('**/testing.json')` per workspace folder.
   - For each found `testing.json`, read its `testSuites` (or use defaults).
   - Build a `RelativePattern` scoped to the `testing.json`'s directory from the `include` globs, then call `workspace.findFiles()` for each include pattern, subtract excluded ones.
   - Call `loadFileOrMember(uri, false)` for each matched test file.
4. In `loadFileOrMember()`, remove the suffix-only guard for local files. Instead verify the file's directory has a `testing.json` (or one up the tree within the workspace) and that the file matches its patterns.
5. Update the QSYS section of `loadInitialTests()` — see Sub-Task 6.

**Relevant Context**
- [`src/manager.ts`](src/manager.ts:98-167) — `loadInitialTests()` and `getWorkspaceTestPatterns()`
- [`src/manager.ts`](src/manager.ts:381-422) — `loadFileOrMember()`
- VS Code API: `workspace.findFiles(include, exclude)`, `RelativePattern`
- `micromatch` or VS Code's built-in glob support for evaluating `exclude` patterns

**Status**: `[ ] pending`

---

### Sub-Task 5 — Rework local file watchers to track `testing.json` and its patterns

**Intent**  
The current watcher (`startWatchingWorkspace`) watches for test files by suffix. Under the new model, watchers must:
1. Watch for `testing.json` file creation/change/deletion — reacting by adding or removing the set of test items belonging to that directory.
2. Watch for test file creation/change/deletion **within directories that already have a `testing.json`** — these watchers are created dynamically from the `include` patterns of each `testing.json` and are torn down when the `testing.json` changes or is deleted.

**Expected Outcomes**
- A single `**/testing.json` watcher handles the lifecycle of per-directory test-file watchers.
- On `testing.json` created: read patterns, create per-pattern file watchers for that directory, load existing matching test files.
- On `testing.json` changed: dispose old per-directory watchers, re-read patterns, re-create watchers, reload test items for the directory (remove stale ones, add new ones).
- On `testing.json` deleted: dispose per-directory watchers, remove all test items from that directory.
- Per-pattern watchers (scoped to the `testing.json`'s directory) fire `loadFileOrMember` on create/change and `deleteTestItem` on delete — same as today.
- All watchers are pushed to `context.subscriptions` or a local disposable map so they are cleaned up on disconnect/deactivate.

**Todo List**
1. Introduce a `Map<string, Disposable[]>` (keyed by `testing.json` directory URI string) to track the per-directory file watchers.
2. Rewrite `startWatchingWorkspace()`:
   - Create one `workspace.createFileSystemWatcher('**/testing.json')` per workspace folder.
   - `onDidCreate` for `testing.json`: call a new `onTestingJsonAdded(uri)` helper.
   - `onDidChange` for `testing.json`: call a new `onTestingJsonChanged(uri)` helper.
   - `onDidDelete` for `testing.json`: call a new `onTestingJsonDeleted(uri)` helper.
3. Implement `onTestingJsonAdded(uri)`:
   - Read `testSuites` config (or defaults).
   - Create `FileSystemWatcher` instances from the `include` patterns, scoped to the directory.
   - Store disposables in the map.
   - Scan and load existing matching files.
4. Implement `onTestingJsonChanged(uri)`:
   - Dispose old watchers for that directory.
   - Remove test items for files in that directory that no longer match the new patterns.
   - Re-run `onTestingJsonAdded(uri)` logic.
5. Implement `onTestingJsonDeleted(uri)`:
   - Dispose watchers for that directory.
   - Remove all test items whose parent directory matches the deleted `testing.json`'s directory.
6. On manager teardown (disconnect), dispose all entries in the watcher map.

**Relevant Context**
- [`src/manager.ts`](src/manager.ts:169-187) — current `startWatchingWorkspace()`
- [`src/manager.ts`](src/manager.ts:327-362) — `deleteTestItem()` (reusable as-is)
- VS Code API: `workspace.createFileSystemWatcher(RelativePattern)`, `Disposable`

**Status**: `[ ] pending`

---

### Sub-Task 6 — Rework QSYS member detection to be `testing.json`-driven

**Intent**
Replace the `testSourceFiles` setting with a QSYS-native equivalent: a `TESTING.JSON` member present inside a source file signals that the source file contains tests. The `testSuites.include`/`exclude` patterns inside it (member-name glob patterns like `T*.RPGLE`) control which members are detected. Scope is identical to today — all libraries in the library list — but a single SQL query replaces the configured source-file list as the discovery gate.

**Expected Outcomes**
- `loadInitialTests()` QSYS section no longer reads `Configuration.getOrFallback(Section.testSourceFiles)`.
- For each library in the library list, the extension queries for source files that contain a member named `TESTING` with extension `JSON`.
- For each such source file, the `TESTING.JSON` member is read and its `testSuites.include`/`exclude` patterns are applied (with QSYS defaults when `testSuites` is absent) to filter which members from that source file are loaded.
- `loadFileOrMember()` member path validation no longer checks against a configured `testSourceFiles` list; instead it checks if the source file has a `TESTING.JSON` member (or the member matches the patterns of an already-loaded `testing.json` for that source file).
- `ApiUtils.getMemberList()` is reused directly to find `TESTING.JSON` members; no new SQL query helper is needed.

**Todo List**
1. Add `getDefaultQsysTestSuites(): TestSuitesConfig` helper (in `api/types.ts` or `api/apiUtils.ts`) returning the QSYS default patterns (`T*.RPGLE`, `T*.SQLRPGLE`, `T*.CBLLE`, `T*.SQLCBLLE`).
2. In `src/manager.ts` `loadInitialTests()` QSYS section:
   - Collect all libraries across all workspace folders (same as today).
   - Call `ApiUtils.getMemberList(connection, libraries, ['*'], ['JSON'])` (or a wildcard source-file variant) to find all `TESTING.JSON` members across all source files in the library list — this returns `(library, sourceFile)` pairs that have a `TESTING` member of type `JSON`.
   - For each `(library, sourceFile)` result, read the `TESTING.JSON` member content via `QsysConfigHandler` and extract `testSuites` (use QSYS defaults if absent).
   - Call `getMemberList()` again for that specific `(library, sourceFile)` to retrieve all members, then apply member-name glob matching (`minimatch` or equivalent) against the `include`/`exclude` patterns to produce the final test member list.
3. Update `QsysTestBucketBuilder` in `cli/src/testBucketBuilder.ts`: remove the `testSourceFiles: string[]` constructor parameter; instead use the same `getMemberList`-based `TESTING.JSON` discovery internally.
4. Remove the `--source-files` / `--sf` option from `cli/src/index.ts` entirely; remove the corresponding `Options.sourceFiles` field and `SOURCE_FILES` default constant.
5. Update `loadFileOrMember()` for `uri.scheme === 'member'`: remove the `testSourceFiles` guard; the source file will only be known to the extension if it was discovered via a `TESTING.JSON` member in the initial load.

**Relevant Context**
- [`src/manager.ts`](src/manager.ts:119-149) — QSYS section of `loadInitialTests()`
- [`src/manager.ts`](src/manager.ts:402-409) — `testSourceFiles` guard in `loadFileOrMember()`
- [`api/apiUtils.ts`](api/apiUtils.ts:164) — `getMemberList()` — reused to find `TESTING.JSON` members by passing `['JSON']` as the extension filter
- [`cli/src/testBucketBuilder.ts`](cli/src/testBucketBuilder.ts:221-293) — `QsysTestBucketBuilder`
- [`cli/src/index.ts`](cli/src/index.ts:95) — `--source-files` CLI option

**Status**: `[ ] pending`

---

## Implementation Notes

- Sub-Tasks 1 and 2 have no dependencies on each other and can be done in any order, but both should be done before Sub-Tasks 3–6.
- Sub-Task 3 (remove global config) must be done before Sub-Tasks 4 and 6 since those sub-tasks rely on the simplified single-level `getConfig()` behaviour.
- Sub-Tasks 4 and 5 (local watcher rework) are closely coupled and should be done together in one agent session.
- Sub-Task 6 (QSYS detection) is independent of Sub-Tasks 4/5 and can be done in parallel after Sub-Tasks 1–3 are complete.
- Pattern matching for `include`/`exclude` in the QSYS case: since member names are not file paths, `micromatch` or a simple `minimatch` call should work against the plain member name (e.g. `TEMPDET.RPGLE`).
- Pattern matching for `exclude` in the local case: VS Code's `workspace.findFiles(include, exclude)` already handles this natively when scoped to a `RelativePattern`.
