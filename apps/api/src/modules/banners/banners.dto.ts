import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min, ValidateIf } from 'class-validator';

export const BANNER_TONES = ['teal', 'gold', 'ink', 'rose'] as const;
export const BANNER_LINKS = ['product', 'offers', 'url'] as const;

export class BannerDto {
  @IsString() @Length(2, 80) titleAr!: string;
  @IsOptional() @IsString() @Length(0, 140) subtitleAr?: string | null;
  /** An https image link, or empty for a text-only banner. */
  @IsOptional() @IsString() @Matches(/^(https:\/\/\S+)?$/, { message: 'imageUrl must be an https link' }) imageUrl?: string | null;
  @IsOptional() @IsIn(BANNER_TONES) tone?: (typeof BANNER_TONES)[number];
  @IsOptional() @IsIn([...BANNER_LINKS, null, '']) linkType?: (typeof BANNER_LINKS)[number] | '' | null;
  /** A product id or SKU, or a store path ("/products?s=games") / https link. */
  @ValidateIf((o: BannerDto) => o.linkType === 'product' || o.linkType === 'url')
  @IsString() @Length(1, 300) linkValue?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsDateString() startsAt?: string | null;
  @IsOptional() @IsDateString() endsAt?: string | null;
}
