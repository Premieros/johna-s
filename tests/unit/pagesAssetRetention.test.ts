import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
describe('Pages asset continuity across deployments', () => {
  it('preserves current HTML and validates retention, collisions, paths, links and size limits', () => {
    const result = execFileSync('python3', ['scripts/ci/test-retain-pages-assets.py'], { encoding: 'utf8', stdio: 'pipe' });
    expect(result).toContain('current HTML unchanged');
  });
  it('downloads only the last successful deployment artifact before publishing the new build', () => {
    const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8');
    const workflow = readFileSync('.github/actions/preserve-pages-assets/action.yml', 'utf8');
    const verify = readFileSync('.github/workflows/verify-main.yml', 'utf8');
    expect(workflow).toContain("workflow_id: 'deploy.yml'");
    expect(workflow).toContain("run.conclusion === 'success'");
    expect(workflow).not.toContain("status: 'success'");
    expect(workflow).toContain("artifact.name === 'github-pages' && !artifact.expired");
    expect(deploy).toContain('actions: read');
    expect(deploy).toContain('retention-days: 30');
    expect(verify).toContain('Verify retention against the actual previous deployed artifact');
    expect(deploy.indexOf('./.github/actions/preserve-pages-assets')).toBeLessThan(deploy.indexOf('actions/upload-pages-artifact'));
    expect(workflow).toContain('stop deployment to preserve active sessions');
  });
});
