import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { DirectoryService } from './directory.service';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import {
  CreateDirectoryDto,
  DirectoryIdDto,
  DirectoryListDto,
  UpdateDirectoryDto,
} from './dto/directory.dto';

@UseGuards(JwtAuthGuard)
@Controller('directories')
export class DirectoryController {
  constructor(
    private readonly directoryService: DirectoryService,
    private readonly spaceAbility: SpaceAbilityFactory,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('list')
  async list(
    @Body() dto: DirectoryListDto,
    @Body() pagination: PaginationOptions,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = await this.spaceAbility.createForUser(user, dto.spaceId);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }
    return this.directoryService.getDirectoriesInSpace(
      dto.spaceId,
      workspace.id,
      pagination,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('info')
  async info(
    @Body() dto: DirectoryIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const directory = await this.directoryService.getDirectoryById(
      dto.directoryId,
      workspace.id,
    );
    if (!directory) throw new NotFoundException('Directory not found');

    const ability = await this.spaceAbility.createForUser(
      user,
      directory.spaceId,
    );
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }
    return directory;
  }

  @HttpCode(HttpStatus.OK)
  @Post('create')
  async create(
    @Body() dto: CreateDirectoryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = await this.spaceAbility.createForUser(user, dto.spaceId);
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }
    return this.directoryService.createDirectory(dto, user, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async update(
    @Body() dto: UpdateDirectoryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const directory = await this.directoryService.getDirectoryById(
      dto.directoryId,
      workspace.id,
    );
    if (!directory) throw new NotFoundException('Directory not found');

    const ability = await this.spaceAbility.createForUser(
      user,
      directory.spaceId,
    );
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }
    return this.directoryService.updateDirectory(dto, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('delete')
  async delete(
    @Body() dto: DirectoryIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const directory = await this.directoryService.getDirectoryById(
      dto.directoryId,
      workspace.id,
    );
    if (!directory) throw new NotFoundException('Directory not found');

    const ability = await this.spaceAbility.createForUser(
      user,
      directory.spaceId,
    );
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }
    await this.directoryService.deleteDirectory(dto.directoryId, workspace.id);
  }
}
