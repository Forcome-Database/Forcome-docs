import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DingTalkApiService } from './dingtalk-api.service';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { AuthAccountRepo } from '@docmost/db/repos/auth/auth-account.repo';
import { AuthProviderRepo } from '@docmost/db/repos/auth/auth-provider.repo';
import { TokenService } from '../../core/auth/services/token.service';
import { GroupUserRepo } from '@docmost/db/repos/group/group-user.repo';
import { GroupRepo } from '@docmost/db/repos/group/group.repo';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { InjectKysely } from 'nestjs-kysely';
import { executeTx } from '@docmost/db/utils';
import { User } from '@docmost/db/types/entity.types';
import { UserRole } from '../../common/helpers/types/permission';
import { nanoIdGen } from '../../common/helpers';
import { EnvironmentService } from '../../integrations/environment/environment.service';

@Injectable()
export class DingTalkService {
  private readonly logger = new Logger(DingTalkService.name);

  constructor(
    private dingTalkApiService: DingTalkApiService,
    private userRepo: UserRepo,
    private authAccountRepo: AuthAccountRepo,
    private authProviderRepo: AuthProviderRepo,
    private tokenService: TokenService,
    private groupUserRepo: GroupUserRepo,
    private groupRepo: GroupRepo,
    private environmentService: EnvironmentService,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  async handleOAuthCallback(
    authCode: string,
    workspaceId: string,
  ): Promise<{ user: User; authToken: string }> {
    const tokenResult =
      await this.dingTalkApiService.getUserAccessToken(authCode);

    const userInfo = await this.dingTalkApiService.getUserInfoByToken(
      tokenResult.accessToken,
    );

    if (!userInfo.unionId) {
      throw new BadRequestException('Failed to get DingTalk unionId');
    }

    const user = await this.findOrCreateUser(
      {
        unionId: userInfo.unionId,
        name: userInfo.nick,
        avatarUrl: userInfo.avatarUrl,
        email: userInfo.email,
        mobile: userInfo.mobile,
      },
      workspaceId,
    );

    const authToken = await this.tokenService.generateAccessToken(user);
    return { user, authToken };
  }

  async handleH5Login(
    code: string,
    workspaceId: string,
  ): Promise<{ user: User; authToken: string }> {
    const h5UserInfo = await this.dingTalkApiService.getUserInfoByCode(code);

    if (!h5UserInfo.unionid) {
      throw new BadRequestException('Failed to get DingTalk unionId from H5');
    }

    let userDetail;
    try {
      userDetail = await this.dingTalkApiService.getUserDetail(
        h5UserInfo.userid,
      );
    } catch (err: any) {
      this.logger.warn(
        `Failed to get user detail for ${h5UserInfo.userid}: ${err?.message}`,
      );
    }

    const user = await this.findOrCreateUser(
      {
        unionId: h5UserInfo.unionid,
        name: userDetail?.name || h5UserInfo.name || h5UserInfo.userid,
        avatarUrl: userDetail?.avatar,
        email: userDetail?.email,
        mobile: userDetail?.mobile,
      },
      workspaceId,
    );

    const authToken = await this.tokenService.generateAccessToken(user);
    return { user, authToken };
  }

  private async findOrCreateUser(
    info: {
      unionId: string;
      name: string;
      avatarUrl?: string;
      email?: string;
      mobile?: string;
    },
    workspaceId: string,
  ): Promise<User> {
    await this.ensureProvider(workspaceId);

    const provider = await this.authProviderRepo.findByType(
      'dingtalk',
      workspaceId,
    );
    if (!provider) {
      throw new BadRequestException('DingTalk SSO provider not configured');
    }

    const existingAccount = await this.authAccountRepo.findByProviderUserId(
      info.unionId,
      provider.id,
      workspaceId,
    );

    if (existingAccount) {
      const user = await this.userRepo.findById(
        existingAccount.userId,
        workspaceId,
      );
      if (!user || user.deletedAt || user.deactivatedAt) {
        throw new BadRequestException('User account is disabled');
      }

      await this.userRepo.updateUser(
        {
          lastLoginAt: new Date(),
          ...(info.name && { name: info.name }),
          ...(info.avatarUrl && { avatarUrl: info.avatarUrl }),
        },
        user.id,
        workspaceId,
      );

      return { ...user, lastLoginAt: new Date() };
    }

    if (!provider.allowSignup) {
      throw new BadRequestException(
        'DingTalk signup is disabled for this workspace',
      );
    }

    return executeTx(this.db, async (trx) => {
      const email =
        info.email || `${info.unionId.substring(0, 16)}@dingtalk.local`;

      const existingUser = await this.userRepo.findByEmail(
        email,
        workspaceId,
      );
      if (existingUser) {
        await this.authAccountRepo.insertAuthAccount(
          {
            userId: existingUser.id,
            providerUserId: info.unionId,
            authProviderId: provider.id,
            workspaceId,
          },
          trx,
        );
        await this.userRepo.updateLastLogin(existingUser.id, workspaceId);
        return existingUser;
      }

      const randomPassword = nanoIdGen(32);
      const newUser = await this.userRepo.insertUser(
        {
          email,
          name: info.name,
          password: randomPassword,
          avatarUrl: info.avatarUrl || '',
          role: UserRole.MEMBER,
          workspaceId,
          hasGeneratedPassword: true,
          lastLoginAt: new Date(),
        },
        trx,
      );

      await this.authAccountRepo.insertAuthAccount(
        {
          userId: newUser.id,
          providerUserId: info.unionId,
          authProviderId: provider.id,
          workspaceId,
        },
        trx,
      );

      let defaultGroup = await this.groupRepo.getDefaultGroup(
        workspaceId,
        trx,
      );
      if (!defaultGroup) {
        defaultGroup = await this.groupRepo.createDefaultGroup(workspaceId, {
          userId: newUser.id,
          trx,
        });
      }
      await this.groupUserRepo.insertGroupUser(
        { userId: newUser.id, groupId: defaultGroup.id },
        trx,
      );

      this.logger.log(
        `Created new user ${newUser.id} from DingTalk unionId ${info.unionId}`,
      );

      return newUser;
    });
  }

  async handleUserLeave(
    userIds: string[],
    workspaceId: string,
  ): Promise<void> {
    for (const dingtalkUserId of userIds) {
      try {
        let unionId: string;
        try {
          const detail =
            await this.dingTalkApiService.getUserDetail(dingtalkUserId);
          unionId = detail.unionid;
        } catch {
          this.logger.warn(
            `Cannot get unionId for departed user ${dingtalkUserId}, skipping`,
          );
          continue;
        }

        const provider = await this.authProviderRepo.findByType(
          'dingtalk',
          workspaceId,
        );
        if (!provider) continue;

        const account = await this.authAccountRepo.findByProviderUserId(
          unionId,
          provider.id,
          workspaceId,
        );
        if (!account) continue;

        await this.userRepo.updateUser(
          { deactivatedAt: new Date() },
          account.userId,
          workspaceId,
        );

        this.logger.log(
          `Deactivated user ${account.userId} due to DingTalk departure`,
        );
      } catch (err: any) {
        this.logger.error(
          `Failed to handle departure for ${dingtalkUserId}: ${err?.message}`,
        );
      }
    }
  }

  private async ensureProvider(workspaceId: string): Promise<void> {
    const existing = await this.authProviderRepo.findByType(
      'dingtalk',
      workspaceId,
    );
    if (existing) return;

    const corpId = this.environmentService.getDingtalkCorpId();
    const appKey = this.environmentService.getDingtalkAppKey();
    const appSecret = this.environmentService.getDingtalkAppSecret();
    const agentId = this.environmentService.getDingtalkAgentId();

    if (!corpId || !appKey || !appSecret) {
      this.logger.warn(
        'DingTalk env vars not configured, skipping provider auto-creation',
      );
      return;
    }

    await this.authProviderRepo.upsertDingtalkProvider(workspaceId, {
      corpId,
      appKey,
      appSecret,
      agentId,
    });

    this.logger.log(
      `Auto-created DingTalk auth provider for workspace ${workspaceId}`,
    );
  }
}
