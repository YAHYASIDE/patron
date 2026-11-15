import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export const TICKET_STATUSES = ['OPEN', 'ANSWERED', 'CLOSED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateTicketDto {
  @ApiPropertyOptional({ description: 'One of my orders' })
  @IsOptional() @IsUUID() orderId?: string;

  @ApiProperty({ minLength: 3, maxLength: 80 })
  @Transform(trim) @IsString() @Length(3, 80) subject!: string;

  @ApiProperty({ minLength: 5, maxLength: 1000 })
  @Transform(trim) @IsString() @Length(5, 1000) message!: string;
}

export class AdminTicketsQueryDto {
  @ApiPropertyOptional({ enum: TICKET_STATUSES })
  @IsOptional() @IsIn(TICKET_STATUSES) status?: TicketStatus;
}

export class UpdateTicketDto {
  @ApiPropertyOptional({ maxLength: 1000, description: 'Sets the ticket ANSWERED and notifies the customer' })
  @IsOptional() @Transform(trim) @IsString() @Length(1, 1000) reply?: string;

  @ApiPropertyOptional({ enum: TICKET_STATUSES })
  @IsOptional() @IsIn(TICKET_STATUSES) status?: TicketStatus;
}
