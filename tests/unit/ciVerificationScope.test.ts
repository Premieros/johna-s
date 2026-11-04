import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function scope(code: string) {
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    "import {classifyPaths,verifyPlan} from './scripts/ci/verification-scope.mjs';\n" + code], { encoding: 'utf8' }));
}
describe('CI verification scope and preserved coverage', () => {
  it('runs all gates for runtime, migration, test, workflow, dependency and unknown changes', () => {
    const paths = ['src/x.ts', 'supabase/migrations/x.sql', 'tests/unit/x.test.ts', 'vitest.config.ts', 'tests/config/node-test-files.json', '.github/workflows/verify-main.yml', 'package-lock.json', 'AGENTS.md', 'unknown.txt'];
    expect(scope(`console.log(JSON.stringify(${JSON.stringify(paths)}.map(p=>classifyPaths([p]))))`)).toEqual(paths.map(() => true));
  });
  it('skips runtime work only for a nonempty pure-doc change on push or PR', () => {
    expect(scope("console.log(JSON.stringify([classifyPaths(['docs/PLAN.md']),classifyPaths(['README.md'],'pull_request'),classifyPaths([]),classifyPaths(['docs/PLAN.md'],'workflow_dispatch'),classifyPaths(['docs/PLAN.md','src/a.ts'])]))")).toEqual([false, false, true, true, true]);
  });
  it('rejects mismatched SHA, malformed artifacts and false doc claims before publication', () => {
    expect(scope(`const sha='a'.repeat(40);const good={version:1,sha,event:'push',runtime:false,paths:['docs/a.md']};
      const values=[good,{...good,sha:'b'.repeat(40)},{...good,version:2},{...good,runtime:'false'},{...good,paths:['src/a.ts']},{...good,event:'workflow_dispatch'}];
      console.log(JSON.stringify(values.map(p=>{try{return verifyPlan(p,sha)}catch{return 'rejected'}})));`)).toEqual([false, 'rejected', 'rejected', 'rejected', 'rejected', 'rejected']);
  });
  it('retains a complete, non-overlapping test partition and native worklog fail-fast check', () => {
    const files = JSON.parse(readFileSync('tests/config/node-test-files.json', 'utf8')) as string[];
    const all = readdirSync('tests/unit', { recursive: true }).map(String).filter(p => /\.test\.(ts|tsx)$/.test(p)).map(p => `tests/unit/${p}`);
    expect(new Set(files).size).toBe(files.length);
    expect(files.length).toBeGreaterThan(200);
    for (const file of files) expect(all).toContain(file);
    expect(execFileSync(process.execPath, ['scripts/ci/verify-worklog.mjs'], { encoding: 'utf8' })).toContain('Worklog verified:');
  });
  it('runs both browser shards and keeps failure isolation, scope proof and deployment guards', () => {
    const workflow = readFileSync('.github/workflows/verify-main.yml', 'utf8');
    expect(workflow).toContain('shard: [1, 2]');
    expect(workflow).toContain('fail-fast: false');
    expect(workflow).toContain('--shard=${{ matrix.shard }}/2');
    expect(workflow).toContain('name: verify-playwright-report-${{ matrix.shard }}');
    expect(workflow).not.toContain('run: npx vitest run tests/unit/activeWorklogGateContract.test.ts');
    for (const job of ['verify', 'db', 'pages-continuity', 'browser-shards']) expect(workflow.split(`  ${job}:`)[1]).toContain("if: needs.scope.outputs.runtime == 'true'");
    expect(workflow).toContain('needs: [scope, browser-shards]');
    expect(workflow).toContain('SHARD_RESULT: ${{ needs.browser-shards.result }}');
    expect(workflow).toContain('run: test "$SHARD_RESULT" = success');
    const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8');
    expect(deploy).toContain('run-id: ${{ github.event.workflow_run.id }}');
    expect(deploy).toContain('VERIFIED_SHA: ${{ github.event.workflow_run.head_sha }}');
    expect(deploy).toContain('verification-scope.mjs verify');
    expect(deploy).toContain("if: needs.build.outputs.runtime == 'true'");
  });
});


it('classifies the whole pushed range, including code followed by a documentation-only commit', () => {
  const script = resolve('scripts/ci/verification-scope.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'ci-scope-range-'));
  const git = (...args: string[]) => execFileSync('git', args, {cwd: dir, encoding: 'utf8'}).trim();
  const commit = () => {git('add', '.'); git('-c','user.name=CI','-c','user.email=ci@example.invalid','commit','-qm','fixture'); return git('rev-parse','HEAD');};
  try {
    git('init','-q'); writeFileSync(join(dir,'README.md'),'base'); const base = commit();
    mkdirSync(join(dir,'src')); writeFileSync(join(dir,'src/a.ts'),'export const a=1'); const code = commit();
    mkdirSync(join(dir,'docs')); writeFileSync(join(dir,'docs/a.md'),'note'); commit();
    const run = (from: string, event='push') => JSON.parse(execFileSync(process.execPath, [script,'plan',join(dir,'scope.json')], {cwd:dir, encoding:'utf8', env:{...process.env, GITHUB_OUTPUT:'', CI_SCOPE_BASE:from, GITHUB_EVENT_NAME:event}}));
    expect(run(base)).toMatchObject({runtime:true,paths:['docs/a.md','src/a.ts']});
    expect(run(code)).toMatchObject({runtime:false,paths:['docs/a.md']});
    expect(run(code,'workflow_dispatch').runtime).toBe(true);
    expect(run('0'.repeat(40)).runtime).toBe(true);
    const beforeRename = git('rev-parse','HEAD');
    git('mv','src/a.ts','docs/moved.md'); commit();
    expect(run(beforeRename)).toMatchObject({runtime:true,paths:['docs/moved.md','src/a.ts']});
  } finally {rmSync(dir,{recursive:true,force:true});}
});
