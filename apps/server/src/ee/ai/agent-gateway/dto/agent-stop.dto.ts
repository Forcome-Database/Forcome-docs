import { IsOptional, IsString } from 'class-validator';

export class AgentStopDto {
  @IsString()
  taskId: string;

  @IsOptional()
  @IsString()
  sessionId?: string;
}
