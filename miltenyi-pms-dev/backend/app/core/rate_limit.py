"""Shared slowapi Limiter used by unauthenticated auth endpoints.

Lives outside `main.py` so route modules can import the limiter without
creating a circular dependency back into the app factory.

The default key function (`get_remote_address`) reads `request.client.host`,
which is the immediate TCP peer. In production the app sits behind a
reverse proxy (Render / nginx), so the immediate peer is the proxy and
all traffic would share one bucket. Uvicorn must therefore be launched
with `--proxy-headers` (Render's default for web services); that flag
makes Starlette substitute the leftmost `X-Forwarded-For` value into
`request.client.host`, restoring per-client keying. If a deployment runs
without `--proxy-headers`, these limits will collapse to a single global
counter — verify before relying on them.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
