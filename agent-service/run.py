"""Startup script for Docmost Agent Service.

Sets WindowsSelectorEventLoopPolicy BEFORE uvicorn creates its event loop,
which is required for psycopg async to work on Windows.
"""
import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import os
import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=int(os.environ.get("AGENT_PORT", "8100")),
        reload=True,
    )
