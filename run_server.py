#!/usr/bin/env python3
"""Run Side Note backend (API + website on one port)."""

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "backend.app:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
