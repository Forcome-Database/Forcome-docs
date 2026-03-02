import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class DingTalkCallbackDto {
  @IsNotEmpty()
  @IsString()
  authCode: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  redirectUrl?: string;
}

export class DingTalkH5LoginDto {
  @IsNotEmpty()
  @IsString()
  code: string;
}
