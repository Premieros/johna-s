import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const yaml = readFileSync('.github/actions/preserve-pages-assets/action.yml', 'utf8');
const source = yaml.split('        script: |\n')[1].split('\n    - name:')[0];
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const locate = new AsyncFunction('github', 'context', 'core', source);
const run = (id: number, conclusion = 'success', status = 'completed') => ({ id, conclusion, status, path: '.github/workflows/deploy.yml', head_branch: process.env.DEPLOYMENT_BRANCH });
function setup(pages: ReturnType<typeof run>[][], artifacts = [{ name: 'github-pages', expired: false }]) {
  const listWorkflowRunsForRepo = vi.fn(async ({ page }: { page: number }) => ({ data: { workflow_runs: pages[page - 1] ?? [] } }));
  const listWorkflowRunArtifacts = vi.fn(async () => ({ data: { artifacts } }));
  const setOutput = vi.fn();
  const execute = () => locate({ rest: { actions: { listWorkflowRunsForRepo, listWorkflowRunArtifacts } } },
    { repo: { owner: 'Premieros', repo: 'johna-s' }, runId: 999 }, { setOutput, info: vi.fn() });
  return { execute, listWorkflowRunsForRepo, listWorkflowRunArtifacts, setOutput };
}
describe('actual Pages artifact locator', () => {
  it('selects the latest completed success without the stale status index', async () => {
    const t = setup([[run(999), run(998, 'failure'), run(997, '', 'in_progress'), { ...run(994), path: '.github/workflows/verify-main.yml' }, { ...run(993), head_branch: 'other' }, run(996), run(900)]]);
    await t.execute();
    expect(t.listWorkflowRunsForRepo.mock.calls[0][0]).not.toHaveProperty('status');
    expect(t.listWorkflowRunsForRepo.mock.calls[0][0]).not.toHaveProperty('branch');
    expect(t.listWorkflowRunArtifacts).toHaveBeenCalledWith({ owner: 'Premieros', repo: 'johna-s', run_id: 996 });
    expect(t.setOutput).toHaveBeenCalledWith('run_id', '996');
  });
  it('walks full pages and never skips a successful deployment with a missing artifact', async () => {
    const t = setup([Array.from({ length: 100 }, (_, i) => run(800 - i, 'failure')), [run(650), run(640)]], []);
    await expect(t.execute()).rejects.toThrow('stop deployment to preserve active sessions');
    expect(t.listWorkflowRunsForRepo).toHaveBeenCalledTimes(2);
    expect(t.listWorkflowRunArtifacts).toHaveBeenCalledTimes(1);
    expect(t.setOutput).not.toHaveBeenCalled();
  });
  it('rejects expired archives instead of publishing without retained assets', async () => {
    const t = setup([[run(996)]], [{ name: 'github-pages', expired: true }]);
    await expect(t.execute()).rejects.toThrow('Previous deployed Pages artifact is unavailable');
  });
  it('allows a genuinely first deployment only after exhausting history', async () => {
    const t = setup([[run(998, 'failure')]]);
    await t.execute();
    expect(t.setOutput).toHaveBeenCalledWith('found', 'false');
    expect(t.listWorkflowRunArtifacts).not.toHaveBeenCalled();
  });
  it('fails closed when the bounded history search cannot find a previous success', async () => {
    const t = setup(Array.from({ length: 10 }, () => Array.from({ length: 100 }, (_, i) => run(i, 'failure'))));
    await expect(t.execute()).rejects.toThrow('search limit reached');
    expect(t.setOutput).not.toHaveBeenCalled();
  });
});
