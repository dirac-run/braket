#!/usr/bin/env python3
"""Compare the built public APIs against the shipped fixtures; execute no inputs."""
import hashlib
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent.parent
ts_data = (root / "typescript/data/classifier.bin").read_bytes()
rust_data = (root / "rust/data/classifier.bin").read_bytes()
if ts_data != rust_data:
    raise SystemExit("TypeScript and Rust packed data differ")

fixtures = root / "rust/tests/fixtures"
metadata = json.loads((fixtures / "metadata.json").read_text())
if hashlib.sha256(ts_data).hexdigest() != metadata["dataSha256"]:
    raise SystemExit("Fixture data fingerprint differs from the shipped data")

cases = []
for name in ("benchmark", "regression", "canonical", "variation", "utility"):
    group = []
    for line in (fixtures / ("utility-compatibility.tsv" if name == "utility" else f"{name}.tsv")).read_text().splitlines():
        if line and not line.startswith("#"):
            expected, encoded = line.split("\t") if "\t" in line else (line, "")
            group.append((int(expected), encoded, bytes.fromhex(encoded).decode("utf-8")))
    if len(group) != metadata[name]:
        raise SystemExit(f"Fixture count differs for {name}")
    cases.extend(group)
if len(cases) != metadata["total"]:
    raise SystemExit("Total fixture count differs")

node_program = """
import {classify} from './typescript/dist/index.js';
let input = '';
for await (const chunk of process.stdin) input += chunk;
process.stdout.write(JSON.stringify(JSON.parse(input).map(classify)));
"""
ts_results = json.loads(subprocess.run(
    ["node", "--input-type=module", "-e", node_program], cwd=root,
    input=json.dumps([case[2] for case in cases]), text=True,
    capture_output=True, check=True, timeout=120,
).stdout)
rust_results = [int(line) for line in subprocess.run(
    [str(root / "rust/target/release/classify-batch")],
    input="".join(case[1] + "\n" for case in cases), text=True,
    capture_output=True, check=True, timeout=120,
).stdout.splitlines()]
if len(ts_results) != len(cases) or len(rust_results) != len(cases):
    raise SystemExit("Classifier output count differs")
mismatches = [(command, expected, ts, rust)
              for (expected, _, command), ts, rust in zip(cases, ts_results, rust_results)
              if ts != expected or rust != expected]
for command, expected, ts, rust in mismatches[:10]:
    print(json.dumps({"command": command, "expected": expected, "typescript": ts, "rust": rust}))
print(json.dumps({"cases": len(cases), "mismatches": len(mismatches),
                  "dataSha256": metadata["dataSha256"]}))
raise SystemExit(bool(mismatches))
