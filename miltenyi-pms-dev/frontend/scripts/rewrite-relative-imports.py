"""rewrite-relative-imports.py

One-shot script that converts every relative import in `frontend/src/`
into the `@/` path alias. Run from the frontend folder:

    python scripts/rewrite-relative-imports.py

After running, the working tree will have every `from "./foo"` or
`from "../bar/baz"` rewritten to `from "@/<src-relative-path>"`.

The script handles three import shapes:
    static          : import X from "./foo";          export { X } from "./foo";
    side-effect     : import "./foo.css";
    dynamic import  : import("./foo")

Package imports (`@vitejs/...`, `lucide-react`, etc.) are untouched —
the regex only matches specifiers that start with `./` or `../`.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path, PurePosixPath


FRONTEND_ROOT = Path(__file__).resolve().parent.parent
SRC_ROOT = FRONTEND_ROOT / "src"


# `from "./foo"` / `from '../bar'`
RE_FROM = re.compile(
    r"""(\bfrom\s+)(["'])(\.\.?/[^"']+)\2""",
    re.MULTILINE,
)
# `import "./foo.css"` (side-effect)
RE_SIDE = re.compile(
    r"""(^\s*import\s+)(["'])(\.\.?/[^"']+)\2""",
    re.MULTILINE,
)
# `import("./foo")` (dynamic)
RE_DYN = re.compile(
    r"""(\bimport\s*\(\s*)(["'])(\.\.?/[^"']+)\2""",
    re.MULTILINE,
)


def to_alias(file_path: Path, specifier: str) -> str | None:
    """Resolve `specifier` against `file_path`'s directory and convert
    to `@/<src-relative>`. Returns None if the resolved path falls
    outside src/ (which shouldn't happen for src files, but stay safe).
    """
    file_dir = file_path.parent.resolve()
    target = (file_dir / specifier).resolve()

    try:
        rel = target.relative_to(SRC_ROOT.resolve())
    except ValueError:
        return None

    # Use POSIX separators in the import path, regardless of platform.
    return f"@/{PurePosixPath(*rel.parts).as_posix()}"


def rewrite_file(file_path: Path) -> tuple[int, str]:
    text = file_path.read_text(encoding="utf-8")
    changes = 0

    def replacer(match: re.Match[str]) -> str:
        nonlocal changes
        prefix, quote, spec = match.group(1), match.group(2), match.group(3)
        alias = to_alias(file_path, spec)
        if alias is None:
            return match.group(0)
        changes += 1
        return f"{prefix}{quote}{alias}{quote}"

    new = RE_FROM.sub(replacer, text)
    new = RE_SIDE.sub(replacer, new)
    new = RE_DYN.sub(replacer, new)
    return changes, new


def main() -> int:
    if not SRC_ROOT.is_dir():
        print(f"src directory not found: {SRC_ROOT}", file=sys.stderr)
        return 1

    edited = 0
    total_imports = 0
    for path in sorted(SRC_ROOT.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix not in (".ts", ".tsx"):
            continue
        changes, new_text = rewrite_file(path)
        if changes:
            path.write_text(new_text, encoding="utf-8", newline="\n")
            edited += 1
            total_imports += changes

    print(f"Rewrote {total_imports} imports across {edited} files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
