import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { DingTalkService } from './dingtalk.service';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { AuthProviderRepo } from '@docmost/db/repos/auth/auth-provider.repo';
import { Public } from '../../common/decorators/public.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { DingTalkCallbackDto, DingTalkH5LoginDto } from './dto/dingtalk.dto';

@Controller('auth/dingtalk')
export class DingTalkController {
  private readonly logger = new Logger(DingTalkController.name);

  constructor(
    private dingTalkService: DingTalkService,
    private environmentService: EnvironmentService,
    private authProviderRepo: AuthProviderRepo,
  ) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('config')
  async getConfig(@AuthWorkspace() workspace: Workspace) {
    const provider = await this.authProviderRepo.findByType(
      'dingtalk',
      workspace.id,
    );

    if (provider) {
      const settings = provider.settings as any;
      return {
        enabled: true,
        corpId:
          settings?.corpId || this.environmentService.getDingtalkCorpId(),
        appKey:
          settings?.appKey || this.environmentService.getDingtalkAppKey(),
        agentId:
          settings?.agentId || this.environmentService.getDingtalkAgentId(),
      };
    }

    const corpId = this.environmentService.getDingtalkCorpId();
    const appKey = this.environmentService.getDingtalkAppKey();
    if (corpId && appKey) {
      return {
        enabled: true,
        corpId,
        appKey,
        agentId: this.environmentService.getDingtalkAgentId(),
      };
    }

    return { enabled: false };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('callback')
  async handleCallback(
    @Body() dto: DingTalkCallbackDto,
    @AuthWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const { user, authToken } = await this.dingTalkService.handleOAuthCallback(
      dto.authCode,
      workspace.id,
    );

    this.setAuthCookie(res, authToken);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        role: user.role,
      },
    };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('h5-login')
  async handleH5Login(
    @Body() dto: DingTalkH5LoginDto,
    @AuthWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const { user, authToken } = await this.dingTalkService.handleH5Login(
      dto.code,
      workspace.id,
    );

    this.setAuthCookie(res, authToken);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        role: user.role,
      },
    };
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('user-info')
  async getUserInfo(@AuthUser() user: User) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      role: user.role,
    };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('event')
  async handleEvent(
    @Body() body: any,
    @AuthWorkspace() workspace: Workspace,
  ) {
    if (body?.EventType === 'check_url') {
      return { msg_signature: '', timeStamp: '', nonce: '', encrypt: '' };
    }

    if (body?.EventType === 'user_leave_org' && body?.UserId) {
      const userIds = Array.isArray(body.UserId)
        ? body.UserId
        : [body.UserId];
      await this.dingTalkService.handleUserLeave(userIds, workspace.id);
    }

    return { success: true };
  }

  private setAuthCookie(res: FastifyReply, token: string) {
    const cookieOpts: any = {
      httpOnly: true,
      path: '/',
      expires: this.environmentService.getCookieExpiresIn(),
      secure: this.environmentService.isHttps(),
      sameSite: 'lax',
    };
    const domain = this.environmentService.getCookieDomain();
    if (domain) {
      cookieOpts.domain = domain;
    }
    res.setCookie('authToken', token, cookieOpts);
  }
}
