import { execFileSync } from 'node:child_process';
import { mkdtempSync,readFileSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe,expect,it } from 'vitest';
const workflow=readFileSync('.github/workflows/fast-verify.yml','utf8');
const block=workflow.split('      - name: Detect same-head full PR verification')[1].split('      - name: Determine Fast Verify scope')[0];
const script=block.split('        run: |\n')[1].split('\n').map(line=>line.replace(/^ {10}/,'')).join('\n');
function run(event: string,count: string,status='ok') {
 const dir=mkdtempSync(join(tmpdir(),'fast-pr-'));
 try {
  writeFileSync(join(dir,'gh'),'#!/bin/bash\nprintf "%s\\n" "$@" > "$ARGS"\nif [ "$MOCK_STATUS" = fail ]; then exit 1; fi\nprintf "%s\\n" "$MOCK_COUNT"\n',{mode:0o755});
  execFileSync('bash',['--noprofile','--norc','-eu','-c',script],{env:{...process.env,BASH_ENV:'',ENV:'',PATH:dir+':'+process.env.PATH,EVENT_NAME:event,MOCK_COUNT:count,MOCK_STATUS:status,GH_REPO:'Premieros/johna-s',OWNER:'Premieros',HEAD_BRANCH:'feature/reports',HEAD_SHA:'abc123',GITHUB_OUTPUT:join(dir,'out'),ARGS:join(dir,'args')}});
  return {output:readFileSync(join(dir,'out'),'utf8'),args:event==='push'&&status==='ok'?readFileSync(join(dir,'args'),'utf8'):''};
 } finally {rmSync(dir,{recursive:true,force:true});}
}
describe('avoid duplicate Fast Verify only under mandatory full PR verification',()=>{
 it('checks the exact pushed SHA and a full-verify target before skipping duplicate jobs',()=>{
  const result=run('push','1');expect(result.output).toContain('full_verify_on_pr=true');
  expect(result.args).toContain('.head.sha == "abc123"');expect(result.args).toContain('.base.ref == "main"');expect(result.args).toContain('head=Premieros:feature/reports');
 });
 it('keeps fast checks for standalone branches, explicit dispatches and API errors',()=>{
  expect(run('push','0').output).toContain('full_verify_on_pr=false');
  expect(run('workflow_dispatch','1').output).toContain('full_verify_on_pr=false');
  expect(run('push','1','fail').output).toContain('full_verify_on_pr=false');
 });
});
