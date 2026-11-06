import importlib.util, unittest
from unittest.mock import patch
from types import SimpleNamespace
from pathlib import Path
spec=importlib.util.spec_from_file_location('collector',Path(__file__).parents[1]/'scripts/usage-feed/push_usage.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Costs(unittest.TestCase):
 def test_sanitizes_cost_data(self):
  import json
  row={'provider':'codex','updatedAt':'2026-11-06T16:00:00Z','projects':[{'path':'secret'}], 'accountEmail':'private','sessionCostUSD':0,'daily':[{'date':'2026-11-06','totalCost':0,'totalTokens':0,'modelBreakdowns':['private']}]}
  with patch.object(m.subprocess,'run',return_value=SimpleNamespace(stdout=json.dumps([row]))):
   out=m.fetch_costs();self.assertEqual(out['codex']['todayCostUSD'],0);self.assertEqual(out['codex']['daily'][0],{'date':'2026-11-06','costUSD':0,'tokens':0});self.assertNotIn('secret',json.dumps(out));self.assertNotIn('private',json.dumps(out))
 def test_failed_scan_does_not_publish_zero(self):
  with patch.object(m.subprocess,'run',return_value=SimpleNamespace(stdout='[{"provider":"claude","error":"failed"}]')):self.assertEqual(m.fetch_costs(),{})
if __name__=='__main__':unittest.main()
