import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

export function docsOnly(files) {
  // Only prose and repository metadata that nothing builds or tests can skip compilation.
  // LICENSE (package check), .editorconfig (formatter), and .gitattributes (line endings)
  // are read by the build jobs, so they are not on this list.
  return (
    files.length > 0 &&
    files.every((path) =>
      /^(?:[^/]+\.md|docs\/.*\.md|NOTICE|\.github\/(?:CODEOWNERS|dependabot\.yml))$/.test(path),
    )
  );
}

export function needsRustFloor(files) {
  // What the crates compile or embed, plus the workflow that defines the floor build.
  return files.some((path) =>
    /^(?:grammar(?:\.js$|\/)|src\/|queries\/|Cargo\.|bindings\/rust\/|snowflake-handlers\/|\.github\/workflows\/verify\.yml$)/.test(
      path,
    ),
  );
}

export function needsPython(files) {
  // What the Python package compiles, ships, or tests against.
  return files.some((path) =>
    /^(?:bindings\/python\/|pyproject\.toml$|setup\.py$|src\/|queries\/|test\/fixtures\/external_access\.sql$|\.github\/workflows\/verify\.yml$)/.test(
      path,
    ),
  );
}

export function needsScannerFuzz(files) {
  return files.some((path) => /^(?:src\/scanner\.c|\.github\/workflows\/verify\.yml)$/.test(path));
}

export function handlersChangelogDated(cargoToml, changelog) {
  const version = cargoToml.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  assert(version, 'snowflake-handlers/Cargo.toml has no version');
  const heading = changelog.split(/\r?\n/).find((line) => line.startsWith(`## [${version}]`));
  assert(heading, `snowflake-handlers/CHANGELOG.md has no section for ${version}`);
  assert(
    !/Unreleased\s*$/.test(heading),
    `snowflake-handlers/CHANGELOG.md still says Unreleased for ${version}; date it before the release`,
  );
}

export function needsWindowsBinding(files) {
  return files.some((path) =>
    /^(?:bindings\/node\/|binding\.gyp$|package(?:-lock)?\.json$|\.github\/workflows\/verify\.yml$)/.test(
      path,
    ),
  );
}

/** @param {(command: string, args: string[], options: object) => any} [run] */
export function changedPaths(base, head, run = execFileSync) {
  return run('git', ['diff', '--no-renames', '--name-only', '-z', `${base}...${head}`], {
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
}

// A pure title/body edit carries no new commit, so the head SHA is
// unchanged from whatever run last built it — but only when that prior
// run actually succeeded. Skipping on the strength of "no code diff"
// alone lets an edit made after a failed or still-in-flight build for
// this exact SHA post a green result that overwrites it. A base-branch
// retarget always needs a full run regardless of `priorVerified`.
export function canSkipEditedBuild(event, priorVerified) {
  return event.action === 'edited' && !event.changes?.base && priorVerified;
}

/**
 * @param {string} cargoToml
 * @param {string} packageJson
 * @param {string} treeSitterJson
 * @param {string} pyproject
 */
export function versionsAgree(cargoToml, packageJson, treeSitterJson, pyproject) {
  const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  const npmVersion = JSON.parse(packageJson).version;
  const treeSitterVersion = JSON.parse(treeSitterJson).metadata?.version;
  assert.equal(
    npmVersion,
    cargoVersion,
    `package.json version "${npmVersion}" must match Cargo.toml version "${cargoVersion}"`,
  );
  assert.equal(
    treeSitterVersion,
    cargoVersion,
    `tree-sitter.json metadata.version "${treeSitterVersion}" must match Cargo.toml version "${cargoVersion}"`,
  );
  const pythonVersion = pyproject.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  assert.equal(
    pythonVersion,
    cargoVersion,
    `pyproject.toml version "${pythonVersion}" must match Cargo.toml version "${cargoVersion}"`,
  );
}

export function verifyResults(needs, event, draft) {
  assert(!draft, 'Draft pull requests require a full verification run');
  for (const [job, value] of Object.entries(needs)) {
    let expected = 'success';
    if (job === 'pr-title' && event !== 'pull_request') expected = 'skipped';
    if (
      ['verify', 'consumer-pin', 'node-binding', 'python-binding'].includes(job) &&
      needs.changes?.outputs?.build === 'false'
    )
      expected = 'skipped';
    if (job === 'consumer-pin' && needs.changes?.outputs?.rust === 'false') expected = 'skipped';
    if (job === 'python-binding' && needs.changes?.outputs?.python === 'false')
      expected = 'skipped';
    assert.equal(value.result, expected, `${job} must finish as ${expected}`);
  }
}

if (process.argv[2] === 'changes') {
  const event = JSON.parse(
    readFileSync(/** @type {string} */ (process.env.GITHUB_EVENT_PATH), 'utf8'),
  );
  let build = true;
  let rust = true;
  let scanner = false;
  let python = true;
  let windows = process.env.GITHUB_REF === 'refs/heads/main';
  if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
    if (canSkipEditedBuild(event, process.env.PRIOR_VERIFIED === 'true')) {
      build = false;
      rust = false;
      windows = false;
      python = false;
    } else {
      const { base, head } = event.pull_request;
      const files = changedPaths(base.sha, head.sha);
      build = !docsOnly(files);
      rust = needsRustFloor(files);
      scanner = needsScannerFuzz(files);
      windows = needsWindowsBinding(files);
      python = needsPython(files);
    }
  }
  appendFileSync(
    /** @type {string} */ (process.env.GITHUB_OUTPUT),
    `build=${build}\nrust=${rust}\nscanner=${scanner}\nwindows=${windows}\npython=${python}\n`,
  );
} else if (process.argv[2] === 'verify') {
  verifyResults(
    JSON.parse(/** @type {string} */ (process.env.JOB_RESULTS)),
    process.env.GITHUB_EVENT_NAME,
    process.env.IS_DRAFT === 'true',
  );
} else if (process.argv[2] === 'versions') {
  versionsAgree(
    readFileSync('Cargo.toml', 'utf8'),
    readFileSync('package.json', 'utf8'),
    readFileSync('tree-sitter.json', 'utf8'),
    readFileSync('pyproject.toml', 'utf8'),
  );
  console.log('package.json, tree-sitter.json, and pyproject.toml versions match Cargo.toml');
} else if (process.argv[2] === 'handlers-changelog') {
  handlersChangelogDated(
    readFileSync('snowflake-handlers/Cargo.toml', 'utf8'),
    readFileSync('snowflake-handlers/CHANGELOG.md', 'utf8'),
  );
  console.log('The snowflake-handlers changelog section is dated');
}
