import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateUserDto {
  @IsEmail() email!: string;
  @IsString() @Length(10, 128) password!: string;
  @IsString() @Length(2, 80) fullName!: string;
  @IsOptional() @IsString() @Matches(/^\+[1-9]\d{7,14}$/) phone?: string;
  @IsOptional() @IsIn(['USD', 'EUR', 'MRU', 'XOF']) defaultCurrency?: string;
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) roleIds?: string[];
}

export class UpdateUserDto {
  @IsOptional() @IsString() @Length(2, 80) fullName?: string;
  @IsOptional() @IsString() @Matches(/^\+[1-9]\d{7,14}$/) phone?: string;
  @IsOptional() @IsString() avatarUrl?: string;
  @IsOptional() @IsIn(['ar', 'en', 'fr']) locale?: string;
  @IsOptional() @IsIn(['USD', 'EUR', 'MRU', 'XOF']) defaultCurrency?: string;
}

export class AdminUpdateUserDto extends UpdateUserDto {
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) roleIds?: string[];
}

export class BlockUserDto {
  @IsBoolean() blocked!: boolean;
  @IsOptional() @IsString() @Length(3, 200) reason?: string;
}

export class QueryUsersDto extends PaginationDto {
  @IsOptional() @Type(() => Boolean) @IsBoolean() isActive?: boolean;
  @IsOptional() @Type(() => Boolean) @IsBoolean() isBlocked?: boolean;
  @IsOptional() @IsString() role?: string;
}
