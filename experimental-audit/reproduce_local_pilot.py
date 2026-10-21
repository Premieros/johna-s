import sys,tempfile,uuid,json,threading,types
from pathlib import Path
from unittest.mock import patch,Mock
if len(sys.argv)!=2: raise SystemExit('Usage: python reproduce_local_pilot.py PATH_TO_EXTRACTED_PILOT_APP')
sys.path.insert(0,str(Path(sys.argv[1]).resolve()))
from core import Store
import server
out={}
def setup(root):
 s=Store(root);s.setup({'login':'admin','password':'Audit-password-123','name':'مدير','branch':'اختبار معزول'});tok,_=s.login({'login':'admin','password':'Audit-password-123'});return s,s.session(tok)
def mutate(s,u,a,d):return s.mutate(u,a,d,str(uuid.uuid4()))
with tempfile.TemporaryDirectory() as tmp:
 s,u=setup(tmp)
 oldsetting=s.setting;once=[False]
 def setting(c,key):
  result=oldsetting(c,key)
  if key=='branch' and not once[0]:
   once[0]=True;mutate(s,u,'order/create',{'table_id':1})
  return result
 with patch.object(s,'setting',setting): stale=s.snapshot(u)
 fresh=s.snapshot(u)
 out['snapshot_revision_race']={'returned_orders':len(stale['orders']),'actual_orders':len(fresh['orders']),'returned_revision':stale['revision'],'actual_revision':fresh['revision'],'same_revision_but_different_data':stale['revision']==fresh['revision'] and stale['orders']!=fresh['orders']}
with tempfile.TemporaryDirectory() as tmp:
 s,u=setup(tmp);mutate(s,u,'settings/save',{'branch':'اختبار','printing':True,'routes':{'cashier':'FAKE-NOT-A-PRINTER','kitchen':'FAKE-2'}})
 mutate(s,u,'print/test',{'station':'cashier'})
 original=Path.write_text
 def fail_spool(path,*a,**kw):
  if path.parent.name=='spool':raise OSError('Synthetic local disk write failure')
  return original(path,*a,**kw)
 stop=threading.Event();wake=Mock();wake.wait.side_effect=lambda *_:stop.set()
 with patch.object(server,'os',types.SimpleNamespace(name='nt')),patch.object(server,'STOP',stop),patch.object(s,'print_wake',wake),patch.object(Path,'write_text',fail_spool),patch.object(server.subprocess,'run') as run:
  server.print_loop(s)
  run_count=run.call_count
 job=s.snapshot(u)['print_jobs'][0]
 out['spool_write_failure']={'status':job['status'],'error':job['error'],'physical_print_calls':run_count,'manual_retry_supported':job['status'] in ('failed','unknown','submitted','preview')}
with tempfile.TemporaryDirectory() as tmp:
 s,u=setup(tmp);mutate(s,u,'settings/save',{'branch':'اختبار','printing':True,'routes':{'cashier':'FAKE-1','kitchen':'FAKE-2'}})
 mutate(s,u,'print/test',{'station':'kitchen'})
 for _ in range(3):mutate(s,u,'print/test',{'station':'cashier'})
 stop=threading.Event();calls=[]
 def fake_run(args,**kw):
  file=Path(args[-1]);p=json.loads(file.read_text(encoding='utf-8-sig'));calls.append(p['printer'])
  if len(calls)==3:stop.set()
  return types.SimpleNamespace(returncode=0)
 with patch.object(server,'os',types.SimpleNamespace(name='nt')),patch.object(server,'STOP',stop),patch.object(server.subprocess,'run',fake_run):server.print_loop(s)
 out['station_priority']={'first_three_processed':calls,'kitchen_remaining':sum(j['station']=='kitchen' and j['status']=='pending' for j in s.snapshot(u)['print_jobs']),'oldest_kitchen_was_bypassed':calls==['FAKE-1']*3}
with tempfile.TemporaryDirectory() as tmp:
 s,u=setup(tmp)
 for n in range(2):
  m=str(uuid.uuid4());mutate(s,u,'material/save',{'id':m,'name':'خامة '+str(n),'unit':'كجم','price':.01})
  p=str(uuid.uuid4());mutate(s,u,'product/save',{'id':p,'name':'منتج '+str(n),'category':'اختبار','station':'kitchen','price':1})
  mutate(s,u,'recipe/save',{'product_id':p,'components':[{'material_id':m,'qty':.5}]})
  oid=mutate(s,u,'order/create',{})['order_id'];mutate(s,u,'order/add',{'order_id':oid,'version':1,'product_id':p});mutate(s,u,'order/send',{'order_id':oid,'version':2});mutate(s,u,'order/checkout',{'order_id':oid,'version':3})
 r=s.report(u,'2026-01-01T00:00:00Z','2027-01-01T00:00:00Z')
 out['report_rounding']={'total_cost_cents':r['cost'],'sum_product_cost_cents':sum(p['cost'] for p in r['products']),'sum_material_cost_cents':sum(m['cost'] for m in r['materials'])}
print(json.dumps(out,ensure_ascii=False,indent=2))
