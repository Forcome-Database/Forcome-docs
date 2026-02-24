import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { MfaService } from './services/mfa.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import {
  MfaEnableDto,
  MfaDisableDto,
  MfaSetupDto,
  MfaVerifyDto,
  MfaGenerateBackupCodesDto,
} from './dto/mfa.dto';
import { TokenService } from '../../core/auth/services/token.service';
import { JwtType } from '../../core/auth/dto/jwt-payload';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { FastifyReply, FastifyRequest } from 'fastify';

@Controller('mfa')
export class MfaController {
  constructor(
    private readonly mfaService: MfaService,
    private readonly tokenService: TokenService,
    private readonly environmentService: EnvironmentService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('status')
  async getStatus(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.mfaService.getStatus(user.id, workspace.id);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('setup')
  async setup(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() _dto: MfaSetupDto,
  ) {
    return this.mfaService.setup(user.id, workspace.id);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('enable')
  async enable(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: MfaEnableDto,
  ) {
    return this.mfaService.enable(user.id, workspace.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('disable')
  async disable(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: MfaDisableDto,
  ) {
    return this.mfaService.disable(user.id, workspace.id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('verify')
  async verify(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
    @Body() dto: MfaVerifyDto,
  ) {
    const mfaToken = req.cookies?.mfa_token;
    if (!mfaToken) {
      throw new Error('MFA token is required');
    }

    const payload = await this.tokenService.verifyJwt(
      mfaToken,
      JwtType.MFA_TOKEN,
    );

    const workspaceId = (req.raw as any).workspaceId || payload.workspaceId;

    const authToken = await this.mfaService.verify(
      payload.sub,
      workspaceId,
      dto.code,
    );

    res.setCookie('authToken', authToken, {
      httpOnly: true,
      path: '/',
      expires: this.environmentService.getCookieExpiresIn(),
      secure: this.environmentService.isHttps(),
    });

    res.clearCookie('mfa_token', { path: '/' });
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('generate-backup-codes')
  async generateBackupCodes(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() _dto: MfaGenerateBackupCodesDto,
  ) {
    return this.mfaService.generateBackupCodes(user.id, workspace.id);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('validate-access')
  async validateAccess(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.mfaService.validateAccess(user.id, workspace.id);
  }
}
