import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { MfaRepo } from '../mfa.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { TokenService } from '../../../core/auth/services/token.service';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { LoginDto } from '../../../core/auth/dto/login.dto';
import { Workspace } from '@docmost/db/types/entity.types';
import { FastifyReply } from 'fastify';
import { MfaEnableDto, MfaDisableDto } from '../dto/mfa.dto';
import { TOTP, Secret } from 'otpauth';
import * as crypto from 'crypto';
import * as QRCode from 'qrcode';
import { comparePasswordHash } from '../../../common/helpers';

@Injectable()
export class MfaService {
  constructor(
    private readonly mfaRepo: MfaRepo,
    private readonly userRepo: UserRepo,
    private readonly tokenService: TokenService,
    private readonly environmentService: EnvironmentService,
  ) {}

  async checkMfaRequirements(
    loginInput: LoginDto,
    workspace: Workspace,
    res: FastifyReply,
  ): Promise<{
    userHasMfa: boolean;
    requiresMfaSetup: boolean;
    isMfaEnforced: boolean;
    authToken?: string;
  } | null> {
    try {
      const user = await this.userRepo.findByEmail(
        loginInput.email,
        workspace.id,
        { includePassword: true },
      );

      if (!user || user.deletedAt) {
        return null;
      }

      const isPasswordMatch = await comparePasswordHash(
        loginInput.password,
        user.password,
      );

      if (!isPasswordMatch) {
        return null;
      }

      user.lastLoginAt = new Date();
      await this.userRepo.updateLastLogin(user.id, workspace.id);

      const mfaRecord = await this.mfaRepo.findByUserId(user.id, workspace.id);
      const userHasMfa = mfaRecord?.isEnabled || false;
      const isMfaEnforced = workspace.enforceMfa || false;

      if (userHasMfa) {
        const mfaToken = await this.tokenService.generateMfaToken(
          user,
          workspace.id,
        );
        res.setCookie('mfa_token', mfaToken, {
          httpOnly: true,
          path: '/',
          expires: new Date(Date.now() + 5 * 60 * 1000),
          secure: this.environmentService.isHttps(),
        });
        return { userHasMfa: true, requiresMfaSetup: false, isMfaEnforced };
      }

      if (isMfaEnforced && !userHasMfa) {
        const mfaToken = await this.tokenService.generateMfaToken(
          user,
          workspace.id,
        );
        res.setCookie('mfa_token', mfaToken, {
          httpOnly: true,
          path: '/',
          expires: new Date(Date.now() + 5 * 60 * 1000),
          secure: this.environmentService.isHttps(),
        });
        return { userHasMfa: false, requiresMfaSetup: true, isMfaEnforced: true };
      }

      const authToken = await this.tokenService.generateAccessToken(user);
      return { userHasMfa: false, requiresMfaSetup: false, isMfaEnforced: false, authToken };
    } catch {
      return null;
    }
  }

  async getStatus(userId: string, workspaceId: string) {
    const mfaRecord = await this.mfaRepo.findByUserId(userId, workspaceId);

    return {
      isEnabled: mfaRecord?.isEnabled || false,
      method: mfaRecord?.method || null,
      backupCodesCount: mfaRecord?.backupCodes?.length || 0,
    };
  }

  async setup(userId: string, workspaceId: string) {
    const user = await this.userRepo.findById(userId, workspaceId);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const secret = new Secret();
    const totp = new TOTP({
      issuer: 'Docmost',
      label: user.email,
      secret,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });

    const otpauthUrl = totp.toString();
    const qrCode = await QRCode.toDataURL(otpauthUrl);

    return {
      method: 'totp',
      qrCode,
      secret: secret.base32,
      manualKey: secret.base32,
    };
  }

  async enable(userId: string, workspaceId: string, dto: MfaEnableDto) {
    const secret = Secret.fromBase32(dto.secret);
    const totp = new TOTP({
      issuer: 'Docmost',
      label: '',
      secret,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });

    const delta = totp.validate({ token: dto.verificationCode, window: 1 });
    if (delta === null) {
      throw new BadRequestException('Invalid verification code');
    }

    const backupCodes = this.generateBackupCodesArray();

    const existing = await this.mfaRepo.findByUserId(userId, workspaceId);
    if (existing) {
      await this.mfaRepo.update(userId, workspaceId, {
        secret: dto.secret,
        method: 'totp',
        isEnabled: true,
        backupCodes,
      });
    } else {
      await this.mfaRepo.insert({
        userId,
        workspaceId,
        secret: dto.secret,
        method: 'totp',
        isEnabled: true,
        backupCodes,
      });
    }

    return { success: true, backupCodes };
  }

  async disable(userId: string, workspaceId: string, dto?: MfaDisableDto) {
    if (dto?.confirmPassword) {
      const user = await this.userRepo.findById(userId, workspaceId, {
        includePassword: true,
      });
      if (!user) {
        throw new BadRequestException('User not found');
      }
      const isPasswordMatch = await comparePasswordHash(
        dto.confirmPassword,
        user.password,
      );
      if (!isPasswordMatch) {
        throw new BadRequestException('Invalid password');
      }
    }

    await this.mfaRepo.delete(userId, workspaceId);
    return { success: true };
  }

  async verify(
    userId: string,
    workspaceId: string,
    code: string,
  ): Promise<string> {
    const mfaRecord = await this.mfaRepo.findByUserId(userId, workspaceId);
    if (!mfaRecord || !mfaRecord.isEnabled) {
      throw new UnauthorizedException('MFA is not enabled');
    }

    const secret = Secret.fromBase32(mfaRecord.secret);
    const totp = new TOTP({
      issuer: 'Docmost',
      label: '',
      secret,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });

    const delta = totp.validate({ token: code, window: 1 });

    if (delta !== null) {
      const user = await this.userRepo.findById(userId, workspaceId);
      return this.tokenService.generateAccessToken(user);
    }

    // Try backup codes
    if (mfaRecord.backupCodes?.length > 0) {
      const codeIndex = mfaRecord.backupCodes.indexOf(code);
      if (codeIndex !== -1) {
        const updatedCodes = [...mfaRecord.backupCodes];
        updatedCodes.splice(codeIndex, 1);
        await this.mfaRepo.update(userId, workspaceId, {
          backupCodes: updatedCodes,
        });

        const user = await this.userRepo.findById(userId, workspaceId);
        return this.tokenService.generateAccessToken(user);
      }
    }

    throw new UnauthorizedException('Invalid verification code');
  }

  async generateBackupCodes(userId: string, workspaceId: string) {
    const mfaRecord = await this.mfaRepo.findByUserId(userId, workspaceId);
    if (!mfaRecord || !mfaRecord.isEnabled) {
      throw new BadRequestException('MFA is not enabled');
    }

    const backupCodes = this.generateBackupCodesArray();
    await this.mfaRepo.update(userId, workspaceId, { backupCodes });

    return { backupCodes };
  }

  async validateAccess(userId: string, workspaceId: string) {
    const mfaRecord = await this.mfaRepo.findByUserId(userId, workspaceId);

    return {
      valid: true,
      userHasMfa: mfaRecord?.isEnabled || false,
      isMfaEnforced: false,
      requiresMfaSetup: false,
    };
  }

  private generateBackupCodesArray(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < 8; i++) {
      const code = crypto.randomBytes(4).toString('hex');
      codes.push(code);
    }
    return codes;
  }
}
