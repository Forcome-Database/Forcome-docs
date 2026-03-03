from fastapi import Request, HTTPException
from app.config import settings

async def verify_internal_secret(request: Request):
    """验证来自 NestJS 网关的内部通信密钥"""
    secret = request.headers.get("X-Internal-Secret", "")
    if secret != settings.agent_internal_secret:
        raise HTTPException(status_code=401, detail="Invalid internal secret")
