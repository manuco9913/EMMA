set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <iterations>"
  exit 1
fi

for ((i=1; i<=$1; i++)); do
  echo "Iteration $i"
  echo "--------------------------------"
  result=$(claude --permission-mode acceptEdits -p "@plans/prd.json @progress.txt \
1. Find the highest-priority feature to work on and work only on that feature. \
This should be the one YOU decide has the highest priority - not necessarily the first in the list. \
2. Before writing any code, invoke the /code-convention-big-features skill. \
3. Implement the feature using the /tdd skill. \
4. Check that the types check via npm run typecheck and that the tests pass via npm run test. \
If the feature is UI-facing and unit tests are insufficient to verify it, use the Playwright MCP browser tools to test it at http://localhost:5173 — otherwise skip it. \
5. Update the PRD with the work that was done. \
6. Append your progress to the progress.txt file. Be extremely concise, sacrifice grammar if needed. \
7. Make a git commit of that feature. \
ONLY WORK ON A SINGLE FEATURE. \
If, while implementing the feature, you notice the PRD is complete, output <promise>COMPLETE</promise>.")

  echo "$result"

  if [[ "$result" == *"<promise>COMPLETE</promise>"* ]]; then
    echo "PRD complete, exiting."
    exit 0
  fi
done