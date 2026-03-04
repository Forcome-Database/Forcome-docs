import { IsString, IsObject } from 'class-validator';

export class AgentResumeDto {
  @IsString()
  threadId: string;

  @IsObject()
  resumeValue: Record<string, any>;
}
