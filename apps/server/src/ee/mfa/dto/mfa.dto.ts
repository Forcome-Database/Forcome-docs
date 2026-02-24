import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class MfaSetupDto {
  @IsOptional()
  @IsString()
  method?: string;
}

export class MfaEnableDto {
  @IsNotEmpty()
  @IsString()
  secret: string;

  @IsNotEmpty()
  @IsString()
  verificationCode: string;
}

export class MfaDisableDto {
  @IsOptional()
  @IsString()
  confirmPassword?: string;
}

export class MfaVerifyDto {
  @IsNotEmpty()
  @IsString()
  code: string;
}

export class MfaGenerateBackupCodesDto {
  @IsOptional()
  @IsString()
  confirmPassword?: string;
}
