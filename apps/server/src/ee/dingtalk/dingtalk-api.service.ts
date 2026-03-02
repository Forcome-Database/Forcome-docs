import { Injectable, Logger } from '@nestjs/common';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import {
  DingTalkCorpTokenResult,
  DingTalkH5UserInfo,
  DingTalkTokenResult,
  DingTalkUserDetail,
  DingTalkUserInfo,
} from './types/dingtalk.types';
import { RedisService } from '@nestjs-labs/nestjs-ioredis';
import type { Redis } from 'ioredis';

const DINGTALK_API = 'https://api.dingtalk.com';
const DINGTALK_OAPI = 'https://oapi.dingtalk.com';

@Injectable()
export class DingTalkApiService {
  private readonly logger = new Logger(DingTalkApiService.name);
  private readonly redis: Redis;

  constructor(
    private environmentService: EnvironmentService,
    private readonly redisService: RedisService,
  ) {
    this.redis = this.redisService.getOrThrow();
  }

  async getCorpAccessToken(): Promise<string> {
    const cacheKey = 'dingtalk:corp_access_token';
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;

    const appKey = this.environmentService.getDingtalkAppKey();
    const appSecret = this.environmentService.getDingtalkAppSecret();

    const res = await fetch(`${DINGTALK_API}/v1.0/oauth2/accessToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appKey, appSecret }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      this.logger.error(`Failed to get corp access token: ${errBody}`);
      throw new Error('Failed to get DingTalk corp access token');
    }

    const data: DingTalkCorpTokenResult = await res.json();
    const ttl = Math.max(data.expireIn - 300, 60);
    await this.redis.set(cacheKey, data.accessToken, 'EX', ttl);
    return data.accessToken;
  }

  async getUserAccessToken(authCode: string): Promise<DingTalkTokenResult> {
    const appKey = this.environmentService.getDingtalkAppKey();
    const appSecret = this.environmentService.getDingtalkAppSecret();

    const res = await fetch(`${DINGTALK_API}/v1.0/oauth2/userAccessToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: appKey,
        clientSecret: appSecret,
        code: authCode,
        grantType: 'authorization_code',
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      this.logger.error(`Failed to get user access token: ${errBody}`);
      throw new Error('DingTalk OAuth2 token exchange failed');
    }

    return res.json();
  }

  async getUserInfoByToken(userAccessToken: string): Promise<DingTalkUserInfo> {
    const res = await fetch(`${DINGTALK_API}/v1.0/contact/users/me`, {
      method: 'GET',
      headers: { 'x-acs-dingtalk-access-token': userAccessToken },
    });

    if (!res.ok) {
      const errBody = await res.text();
      this.logger.error(`Failed to get user info: ${errBody}`);
      throw new Error('Failed to get DingTalk user info');
    }

    return res.json();
  }

  async getUserInfoByCode(code: string): Promise<DingTalkH5UserInfo> {
    const corpToken = await this.getCorpAccessToken();

    const res = await fetch(
      `${DINGTALK_OAPI}/topapi/v2/user/getuserinfo?access_token=${corpToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      },
    );

    if (!res.ok) {
      const errBody = await res.text();
      this.logger.error(`Failed to get H5 user info: ${errBody}`);
      throw new Error('DingTalk H5 login failed');
    }

    const data = await res.json();
    if (data.errcode !== 0) {
      this.logger.error(`DingTalk H5 error: ${data.errmsg}`);
      throw new Error(`DingTalk H5 error: ${data.errmsg}`);
    }

    return data.result;
  }

  async getUserDetail(userid: string): Promise<DingTalkUserDetail> {
    const corpToken = await this.getCorpAccessToken();

    const res = await fetch(
      `${DINGTALK_OAPI}/topapi/v2/user/get?access_token=${corpToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userid }),
      },
    );

    if (!res.ok) {
      const errBody = await res.text();
      this.logger.error(`Failed to get user detail: ${errBody}`);
      throw new Error('Failed to get DingTalk user detail');
    }

    const data = await res.json();
    if (data.errcode !== 0) {
      this.logger.error(`DingTalk user detail error: ${data.errmsg}`);
      throw new Error(`DingTalk user detail error: ${data.errmsg}`);
    }

    return data.result;
  }
}
