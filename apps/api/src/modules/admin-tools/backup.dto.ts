import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { MIN_PASSPHRASE_LENGTH } from './backup-crypto';

/** The passphrase an encrypted download is locked with. Never stored, never logged. */
export class EncryptedBackupDto {
  @IsString() @MinLength(MIN_PASSPHRASE_LENGTH) @MaxLength(1024)
  passphrase!: string;
}

/** The text fields that come with a file to verify (multipart). */
export class VerifyBackupDto {
  @IsOptional() @IsString() @MaxLength(1024)
  passphrase?: string;
}

export class ConnectDriveQueryDto {
  /** The dashboard page to come back to; only a trusted dashboard origin is honoured. */
  @IsOptional() @IsString() @MaxLength(500)
  returnTo?: string;
}

export class BackupScheduleDto {
  @IsOptional() @IsBoolean() daily?: boolean;
  @IsOptional() @IsBoolean() weekly?: boolean;
  /** Hour of the day, UTC (Mauritania is UTC all year). */
  @IsOptional() @IsInt() @Min(0) @Max(23) hourUtc?: number;
  /** Day of the weekly copy: 0 Sunday … 6 Saturday. */
  @IsOptional() @IsInt() @Min(0) @Max(6) weekday?: number;
  /** Copies of each kind kept in the Drive; older ones go to its trash. */
  @IsOptional() @IsInt() @Min(1) @Max(60) keep?: number;
}

export class BackupRunsQueryDto {
  @IsOptional() @IsInt() @Min(1) @Max(100) limit?: number;
}
