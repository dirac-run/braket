#!/usr/bin/env python3
"""Optional full mismatch report using the standalone classify-batch binary."""
import argparse
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("binary", type=Path)
parser.add_argument("--output", type=Path)
args = parser.parse_args()
fixture_root = Path(__file__).resolve().parent.parent / "tests" / "fixtures"
cases = []
for name in ("benchmark", "regression", "canonical", "variation"):
    for line in (fixture_root / (name + ".tsv")).read_text().splitlines():
        if line.startswith("#") or not line:
            continue
        expected, source = line.split("\t") if "\t" in line else (line, "")
        cases.append((name, int(expected), source))
result = subprocess.run([str(args.binary.resolve())], input="".join(c[2] + "\n" for c in cases), text=True, capture_output=True, check=True)
decisions = result.stdout.splitlines()
if len(decisions) != len(cases):
    raise RuntimeError(f"expected {len(cases)} results, got {len(decisions)}")
mismatches = []
groups = {}
for (name, expected, source), raw in zip(cases, decisions):
    actual = int(raw)
    group = groups.setdefault(name, {"total": 0, "mismatches": 0})
    group["total"] += 1
    if actual != expected:
        group["mismatches"] += 1
        mismatches.append({"group": name, "source": bytes.fromhex(source).decode("utf8"), "expected": expected, "actual": actual})
report = {"total": len(cases), "passed": len(cases) - len(mismatches), "groups": groups, "mismatches": mismatches}
if args.output:
    args.output.write_text(json.dumps(report, ensure_ascii=True, indent=2) + "\n")
print(json.dumps({k: v for k, v in report.items() if k != "mismatches"}, indent=2))
for mismatch in mismatches[:10]:
    print(json.dumps(mismatch, ensure_ascii=True))
raise SystemExit(bool(mismatches))
