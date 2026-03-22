## Project anchor

The canonical starting point for any session on this app is:
  apps/tag-registry/Docs/HANDOFF.md

Read that file first. It contains the tech stack, monorepo
structure, how to run the servers, links to all spec documents,
test suite summary, current state, and known gotchas.

---

## Session Discipline

### After every task
If the implementation diverges from, extends, or contradicts any
spec document (Functional Spec, API Spec, Bootstrap, Test Spec),
record the delta in `apps/tag-registry/Docs/spec_delta.md` using
this format:

### <short title>
**Date:** YYYY-MM-DD
**Spec:** <document name and section>
**Delta:** <what the code does that differs from the spec>
**Action:** <what needs to be updated, or "no action" if spec should
             be updated to match>

The spec documents to check after every task are:
- tag_registry_spec_v1_xx.md (Functional Spec)
- tag_registry_api_spec_v1_xx.md (API Spec)
- tag_registry_bootstrap_v1_xx.md (Bootstrap)
- tag_registry_test_spec_v1_x.md (Test Spec)

### At the end of every session
Append a session summary entry to
`apps/tag-registry/Docs/session_log.md` using this format:

## <YYYY-MM-DD> — <one-line session title>

**Changes made:**
- <bullet per logical change>

**Spec deltas added:** <yes — see spec_delta.md | no>
**Tests affected:** <summary or "none">
**Docs that may need updating:** <list or "none">
**Deferred / follow-up:** <anything not completed>

This is a mandatory step. Do not consider a session complete
until the session_log.md entry has been written.
