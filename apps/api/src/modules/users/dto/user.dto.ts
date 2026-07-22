import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateUserDto {
  @ApiProperty({ example: 'staff@example.com' })
  @IsEmail() email!: string;

  @ApiProperty({ minLength: 10, maxLength: 128 })
  @IsString() @Length(10, 128) password!: string;

  @ApiProperty({ example: ' Moussa Ba', minLength: 2, maxLength: 80 })
  @IsString() @Length(2, 80) fullName!: string;

  @ApiPropertyOptional({ example: '+22212345678' })
  @IsOptional() @IsString() @Matches(/^\+[1-9]\d{7,14}$/) phone?: string;

  @ApiPropertyOptional({ enum: ['USD', 'EUR', 'MRU', 'XOF'] })
  @IsOptional() @IsIn(['USD', 'EUR', 'MRU', 'XOF']) defaultCurrency?: string;

  @ApiPropertyOptional({ type: [String], description: 'Role IDs to assign (defaults to customer)' })
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) roleIds?: string[];
}

export class UpdateUserDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 80 })
  @IsOptional() @IsString() @Length(2, 80) fullName?: string;

  @ApiPropertyOptional({ example: '+22212345678' })
  @IsOptional() @IsString() @Matches(/^\+[1-9]\d{7,14}$/) phone?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() avatarUrl?: string;

  @ApiPropertyOptional({ enum: ['ar', 'en', 'fr'] })
  @IsOptional() @IsIn(['ar', 'en', 'fr']) locale?: string;

  @ApiPropertyOptional({ enum: ['USD', 'EUR', 'MRU', 'XOF'] })
  @IsOptional() @IsIn(['USD', 'EUR', 'MRU', 'XOF']) defaultCurrency?: string;
}

export class AdminUpdateUserDto extends UpdateUserDto {
  @ApiPropertyOptional({ description: 'Enable or disable the account' })
  @IsOptional() @IsBoolean() isActive?: boolean;

  @ApiPropertyOptional({ type: [String], description: 'Replace the role assignments' })
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) roleIds?: string[];
}

export class BlockUserDto {
  @ApiProperty({ description: 'true = block, false = unblock' })
  @IsBoolean() blocked!: boolean;

  @ApiPropertyOptional({ minLength: 3, maxLength: 200 })
  @IsOptional() @IsString() @Length(3, 200) reason?: string;
}

export class QueryUsersDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional() @Type(() => Boolean) @IsBoolean() isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional() @Type(() => Boolean) @IsBoolean() isBlocked?: boolean;

  @ApiPropertyOptional({ description: 'Filter by role name' })
  @IsOptional() @IsString() role?: string;
}
