import { IsArray, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

export class CreateRoleDto {
  @IsString() @Length(3, 40)
  @Matches(/^[a-z][a-z0-9_]*$/, { message: 'Role name must be snake_case' })
  name!: string;

  @IsOptional() @IsString() @Length(3, 200) description?: string;
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) permissionIds?: string[];
}

export class UpdateRoleDto {
  @IsOptional() @IsString() @Length(3, 200) description?: string;
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) permissionIds?: string[];
}
