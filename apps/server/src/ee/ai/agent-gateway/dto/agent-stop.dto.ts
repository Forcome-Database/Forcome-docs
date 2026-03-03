import { IsString } from 'class-validator';

export class AgentStopDto {
  @IsString()
  taskId: string;
}
