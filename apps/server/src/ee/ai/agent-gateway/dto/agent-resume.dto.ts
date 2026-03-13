import { IsString, IsObject } from 'class-validator';
import type { AgentResumeValue } from '../agent-gateway.types';

export class AgentResumeDto {
  @IsString()
  threadId: string;

  @IsObject()
  resumeValue: AgentResumeValue;
}
