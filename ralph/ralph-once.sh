set -e

pending=$(jq -c '[.[] | select(.passes == false)]' plans/prd.json)
recent=$(tail -n 50 progress.txt 2>/dev/null || echo "")

# Step 1: cheap planning call — pick the next feature
feature=$(claude --permission-mode acceptEdits -p \
  "PENDING PRD FEATURES (JSON): $pending

Pick the single highest-priority feature to implement next. Return ONLY the raw JSON object for that one feature, no commentary.")

echo "Selected feature: $feature"
echo "--------------------------------"

# Step 2: implement only that one feature
claude --permission-mode acceptEdits -p \
  "FEATURE TO IMPLEMENT (JSON):
$feature

RECENT PROGRESS:
$recent

1. Implement this feature using the /tdd skill.
2. Check that types check via npm run typecheck and that the tests pass via npm run test.
   If the feature is UI-facing and unit tests are insufficient to verify it, use the Playwright MCP browser tools to test it at http://localhost:5173 — otherwise skip it.
3. Update plans/prd.json: set passes:true for the completed feature.
4. Append your progress to progress.txt. Be extremely concise, sacrifice grammar if needed.
5. Make a git commit of that feature.
ONLY WORK ON THIS SINGLE FEATURE.
If, while implementing the feature, you notice the PRD is complete, output <promise>COMPLETE</promise>."
