"""
seed_data — shared reference data consumed by multiple seed scripts.

Both `seed.py` (full dev seed) and `miltenyi-test-seed.py` (minimal
stakeholder demo seed) read from this package so the Miltenyi GCC
career-path content lives in one place. Edits to function names,
career-level labels, designation titles, or role-expectation prose
should happen here — both seeds pick the change up automatically on
their next run.
"""
