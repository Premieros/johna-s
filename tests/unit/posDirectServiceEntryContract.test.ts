import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { APP_ROUTES } from '@/core/navigation/routes';

const routesSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/app/routes.tsx'),
  'utf8',
);
const workspaceSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/features/pos/pages/PosWorkspacePage.tsx'),
  'utf8',
);

describe('POS direct delivery / drive-thru entry contract', () => {
  it('keeps stable centralized entry routes', () => {
    expect(APP_ROUTES.delivery).toBe('/delivery');
    expect(APP_ROUTES.driveThru).toBe('/drive-thru');
  });

  it('routes both entries into the canonical POS workspace with an initial wizard step', () => {
    expect(routesSource).toContain('path={APP_ROUTES.delivery}');
    expect(routesSource).toContain("state={{ startStep: 'delivery' }}");
    expect(routesSource).toContain('path={APP_ROUTES.driveThru}');
    expect(routesSource).toContain("state={{ startStep: 'car' }}");
    expect(routesSource).toContain('to={APP_ROUTES.pos}');
  });

  it('consumes the routed start step without introducing a second POS flow', () => {
    expect(workspaceSource).toContain('startStep?: StartStep | null;');
    expect(workspaceSource).toContain('initState.startStep ?? null');
    expect(workspaceSource).toContain('else if (initState.startStep)');
    expect(workspaceSource).toContain('setStartStep(initState.startStep)');
  });
});
