export const expectedProject = 'azzdesuowpdcoflmyezn';
const approval = 'owner-approved-johnas-read-indexes-20261014';

export function validateTarget(rawUrl, env = process.env, apply = false) {
  const url = new URL(rawUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('PostgreSQL connection required');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (local) {
    if (env.CI !== 'true' || env.GITHUB_ACTIONS !== 'true' || !/^\/qa_read_indexes_[a-f0-9]{32}$/.test(url.pathname)) {
      throw new Error('Owned disposable CI database required');
    }
    return 'owned-local-ci';
  }
  const direct = url.hostname === `db.${expectedProject}.supabase.co`
    && decodeURIComponent(url.username) === 'postgres' && (!url.port || url.port === '5432');
  const pooler = url.hostname === 'aws-0-eu-west-1.pooler.supabase.com'
    && decodeURIComponent(url.username) === `postgres.${expectedProject}` && url.port === '5432';
  if (url.pathname !== '/postgres') throw new Error('Unexpected production database name');
  if (!direct && !pooler) throw new Error('Unexpected database host or pooler identity/mode');
  if (env.SUPABASE_PROJECT_REF !== expectedProject) throw new Error('Project identity confirmation required');
  if (apply && env.JOHNAS_READ_INDEX_PRODUCTION_APPROVAL !== approval) throw new Error('Separate owner SQL approval required');
  if (url.searchParams.get('sslmode') !== 'verify-full') throw new Error('Verified TLS required');
  return 'johnas-production';
}

