import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporaryRoot = realpathSync(tmpdir());
const output = mkdtempSync(join(temporaryRoot, 'finapp-finance-tests-'));
let status = 1;
try {
  const compile = spawnSync(process.execPath, [
    resolve(root, 'node_modules/typescript/bin/tsc'),
    '--target', 'ES2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--strict', '--skipLibCheck', '--rootDir', resolve(root, 'src'), '--outDir', output,
    resolve(root, 'src/lib/money.ts'), resolve(root, 'src/lib/finance.ts'), resolve(root, 'src/lib/authLoadGuard.ts'),
    resolve(root, 'src/lib/planning.ts'),
    resolve(root, 'src/lib/flexiblePlanning.ts'),
    resolve(root, 'src/lib/recurringInsights.ts'),
    resolve(root, 'src/lib/bankConnection.ts'),
    resolve(root, 'src/lib/priorImport.ts'),
    resolve(root, 'src/lib/priorBridge.ts'),
    resolve(root, 'src/lib/priorBankConnection.ts'),
    resolve(root, 'src/mockData.ts'),
    resolve(root, 'src/services/priorLocalService.ts'),
  ], { cwd: root, stdio: 'inherit' });
  if (compile.error) throw compile.error;
  if (compile.status === 0) {
    const run = spawnSync(process.execPath, ['--test', resolve(root, 'tests/finance.test.mjs'), resolve(root, 'tests/auth.test.mjs'), resolve(root, 'tests/planning.test.mjs'), resolve(root, 'tests/flexible-planning.test.mjs'), resolve(root, 'tests/recurring-insights.test.mjs'),resolve(root,'tests/merchants.test.mjs'), resolve(root, 'tests/bank-connection.test.mjs'), resolve(root, 'tests/prior-import.test.mjs'), resolve(root, 'tests/prior-connection.test.mjs'), resolve(root, 'tests/categories.test.mjs')], {
      cwd: root, stdio: 'inherit', env: { ...process.env, FINAPP_TEST_OUTPUT: output, TZ: 'Europe/Minsk' },
    });
    if (run.error) throw run.error;
    status = run.status ?? 1;
  } else status = compile.status ?? 1;
} finally {
  const resolvedOutput = realpathSync(output);
  if (dirname(resolvedOutput) !== temporaryRoot || !basename(resolvedOutput).startsWith('finapp-finance-tests-')) {
    throw new Error('Refusing cleanup outside the dedicated temporary test directory.');
  }
  rmSync(resolvedOutput, { recursive: true, force: true });
}
process.exitCode = status;
