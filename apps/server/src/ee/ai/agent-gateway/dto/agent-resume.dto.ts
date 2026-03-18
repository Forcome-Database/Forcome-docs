import { IsString, IsObject } from 'class-validator';
import type { AgentResumeValue } from '../agent-gateway.types';

export class AgentResumeDto {
  @IsString()
  sessionId: string;

  @IsObject()
  resumeValue: AgentResumeValue;
}
