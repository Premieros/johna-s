import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/deploy.yml','utf8');
const verify = readFileSync('.github/workflows/verify-main.yml','utf8');

describe('GitHub Pages requires verified exact-HEAD main build',()=>{
  it('has no direct push/manual publishing route that bypasses Verify main',()=>{
    expect(workflow).toMatch(/workflow_run:\s*\n\s*workflows:\s*\[["']Verify main["']\]/);
    expect(workflow).toMatch(/types:\s*\[completed\]/);
    expect(workflow).toMatch(/branches:\s*\[main, master\]/);
    expect(workflow).not.toMatch(/^\s+push:\s*$/m);
    expect(workflow).not.toMatch(/^\s+workflow_dispatch:\s*$/m);
    expect(verify).toMatch(/name:\s*Verify main/);
    for(const name of ['verify','db','browser-smoke','pages-continuity']){
      expect(verify).toMatch(new RegExp('^  '+name+':','m'));
    }
  });
  it('denies failed, PR-derived and non-main workflow runs',()=>{
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(workflow).toContain("github.event.workflow_run.event == 'push'");
    expect(workflow).toContain('github.event.workflow_run.head_repository.full_name == github.repository');
    expect(workflow).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(workflow).toContain("github.event.workflow_run.head_branch == 'master'");
  });
  it('builds and deploys the same verified SHA and rejects stale commits at publication',()=>{
    expect(workflow.match(/ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/g)).toHaveLength(3);
    expect(workflow.match(/git ls-remote origin/g)).toHaveLength(2);
    expect(workflow.match(/test -n "\$actual" && test "\$actual" = "\$VERIFIED_SHA"/g)).toHaveLength(2);
    expect(workflow).toMatch(/deploy:\s*\n\s*needs:\s*\[build, production-parity\]/);
    expect(workflow).toContain('actions/deploy-pages@v4');
    expect(workflow).toContain('node scripts/db/check-production-parity.js');
  });
});
