# Tag Registry — Spec Delta

**Purpose:** Divergences between tag-registry implementation and its spec documents.
Read once at session start. Add entries when implementation diverges from spec.

---

**Last cleared:** 2026-10-17. Propagated entries live in their target docs; earlier propagation notes are in git history.

- 2026-10-18 — `shared/tagDefs.ts` exports `moduleRelativeTagName(meta): string | null` (levels below the first `type: 'module'` level with `In_Tag_Name` true; null if no module level); the Tag Defs export now calls it instead of an inline `meta.slice(1)` (output unchanged, 1279 tags checked) and the HMI's handshake TAG_LIST uses it too. Not in `tag_registry_bootstrap.md` §3 or `tag_registry_spec.md` §12.1.
