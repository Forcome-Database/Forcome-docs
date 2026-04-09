import { Extension, onAuthenticatePayload } from '@hocuspocus/server';
import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { TokenService } from '../../core/auth/services/token.service';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { ResourceAbilityFactory } from '../../core/casl/abilities/resource-ability.factory';
import { getPageId } from '../collaboration.util';
import { JwtCollabPayload, JwtType } from '../../core/auth/dto/jwt-payload';

@Injectable()
export class AuthenticationExtension implements Extension {
  private readonly logger = new Logger(AuthenticationExtension.name);

  constructor(
    private tokenService: TokenService,
    private userRepo: UserRepo,
    private pageRepo: PageRepo,
    private readonly resourceAbility: ResourceAbilityFactory,
  ) {}

  async onAuthenticate(data: onAuthenticatePayload) {
    const { documentName, token } = data;
    const pageId = getPageId(documentName);

    let jwtPayload: JwtCollabPayload;

    try {
      jwtPayload = await this.tokenService.verifyJwt(token, JwtType.COLLAB);
    } catch (error) {
      throw new UnauthorizedException('Invalid collab token');
    }

    const userId = jwtPayload.sub;
    const workspaceId = jwtPayload.workspaceId;

    const user = await this.userRepo.findById(userId, workspaceId);

    if (!user) {
      throw new UnauthorizedException();
    }

    if (user.deactivatedAt || user.deletedAt) {
      throw new UnauthorizedException();
    }

    const page = await this.pageRepo.findById(pageId);
    if (!page) {
      this.logger.warn(`Page not found: ${pageId}`);
      throw new NotFoundException('Page not found');
    }

    let effectiveRole: string;
    try {
      effectiveRole = await this.resourceAbility.resolveRole(
        user,
        'page',
        pageId,
        { directoryId: page.directoryId ?? undefined, spaceId: page.spaceId },
      );
    } catch (err) {
      if (err instanceof NotFoundException) {
        this.logger.warn(`User not authorized to access page: ${pageId}`);
        throw new UnauthorizedException('Access denied');
      }
      throw err;
    }

    if (effectiveRole === 'none') {
      this.logger.warn(`User explicitly denied access to page: ${pageId}`);
      throw new UnauthorizedException('Access denied');
    }

    if (effectiveRole === 'reader') {
      data.connectionConfig.readOnly = true;
      this.logger.debug(`User granted readonly access to page: ${pageId}`);
    }

    this.logger.debug(`Authenticated user ${user.id} on page ${pageId}`);

    return {
      user,
    };
  }
}
