import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ example: 'finance_viewer', description: 'snake_case, 3–40 chars' })
  @IsString() @Length(3, 40)
  @Matches(/^[a-z][a-z0-9_]*$/, { message: 'Role name must be snake_case' })
  name!: string;

  @ApiPropertyOptional({ minLength: 3, maxLength: 200 })
  @IsOptional() @IsString() @Length(3, 200) description?: string;

  @ApiPropertyOptional({ type: [String], description: 'Permission IDs granted to the role' })
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) permissionIds?: string[];
}

export class UpdateRoleDto {
  @ApiPropertyOptional({ minLength: 3, maxLength: 200 })
  @IsOptional() @IsString() @Length(3, 200) description?: string;

  @ApiPropertyOptional({ type: [String], description: 'Replace the granted permission set' })
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) permissionIds?: string[];
}
