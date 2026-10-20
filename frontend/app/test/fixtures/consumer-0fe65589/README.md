# The consumer deployed at 0fe65589

The frontend contracts and status registry as they were at commit `0fe65589`,
the last frontend deployed before Midgard f4cf28ca1 support. A deployed bundle
cannot change, so `test/consumer-compatibility.test.ts` decodes new responses
with these files to show what an old bundle does with them.

Extracted with:

```bash
git show 0fe65589:frontend/contracts/src/<file>.ts > contracts/<file>.ts
git show 0fe65589:frontend/app/src/lib/status-registry.ts > status-registry.ts
```

Do not edit them.
