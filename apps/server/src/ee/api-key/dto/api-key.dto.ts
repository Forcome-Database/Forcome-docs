import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateApiKeyDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  expiresAt?: string;
}

export class UpdateApiKeyDto {
  @IsNotEmpty()
  @IsUUID()
  apiKeyId: string;

  @IsNotEmpty()
  @IsString()
  name: string;
}

export class RevokeApiKeyDto {
  @IsNotEmpty()
  @IsUUID()
  apiKeyId: string;
}
