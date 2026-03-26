from fastapi import Request, HTTPException
import hmac
from app.config import settings


async def verify_internal_secret(request: Request):
    """验证来自 NestJS 网关的内部通信密钥"""
    configured_secret = settings.agent_internal_secret
    if not configured_secret:
        raise HTTPException(status_code=401, detail="Unauthorized")
    secret = request.headers.get("X-Internal-Secret")
    if not secret or not hmac.compare_digest(secret, configured_secret):
        raise HTTPException(status_code=401, detail="Unauthorized")
