// Run in a publish job before `npm publish`. A published version is never
// republished, so a tarball without its prebuilt addons has to fail first.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

const platforms = ['linux-x64', 'win32-x64'];

export function missingPrebuilds(packOutput) {
  const result = JSON.parse(packOutput);
  const packages = Array.isArray(result) ? result : Object.values(result);
  assert.equal(packages.length, 1, 'Expected one npm package');
  const paths = packages[0].files.map(({ path }) => path.replaceAll('\\', '/'));
  return platforms.filter(
    (platform) =>
      !paths.some((path) => path.startsWith(`prebuilds/${platform}/`) && path.endsWith('.node')),
  );
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    encoding: 'utf8',
  });
  const missing = missingPrebuilds(output);
  assert.deepEqual(missing, [], `The npm tarball has no prebuilt addon for ${missing.join(', ')}`);
  console.log(`The npm tarball has prebuilt addons for ${platforms.join(' and ')}`);
}
