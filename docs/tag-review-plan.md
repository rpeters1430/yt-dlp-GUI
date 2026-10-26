# Selective music tag review

User-approved scope: Picard/Mp3tag-style per-field Keep/Replace/Clear, preservation defaults for existing genre and identifiers, and album-wide review with explicit track mapping.

Implementation: store catalog candidates and safe default actions in immutable previews; validate submitted choices against that saved preview; write only selected fields; rebuild paired number/total fields with kept siblings; retain existing hash guards, temporary-file verification and backups. Reject old previews. Reuse the single-file API for bounded album review with explicit unique mapping, sequential saves and per-file outcomes.

Validation: real audio across six containers; preserve/replace/clear and numeric sibling regressions; authenticated route tests; client interactions for single/album review; server/client suites, lints and production build. Album writes are individually atomic, not an all-or-nothing transaction.
