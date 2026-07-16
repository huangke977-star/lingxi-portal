import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import {
  PORTAL_CATEGORY_KINDS,
  PORTAL_RECORD_STATUSES,
  PORTAL_VISIBILITIES,
  PortalCategoryKind,
  PortalRecordStatus,
  PortalVisibility,
} from "../portal.types";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;
const optionalTrim = ({ value }: { value: unknown }) => {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim();
  return normalized || null;
};

export class PortalListQueryDto {
  @Transform(({ value }) => {
    if (value === undefined || value === "") {
      return undefined;
    }
    return (Array.isArray(value) ? value : String(value).split(","))
      .map((item) => String(item).trim())
      .filter(Boolean);
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PORTAL_CATEGORY_KINDS.length)
  @IsIn(PORTAL_CATEGORY_KINDS, { each: true })
  kinds?: PortalCategoryKind[];
}

export class CreatePortalCategoryDto {
  @IsIn(PORTAL_CATEGORY_KINDS)
  kind!: PortalCategoryKind;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(255)
  description = "";

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(-100000)
  @Max(100000)
  sortOrder = 0;

  @IsIn(PORTAL_RECORD_STATUSES)
  status: PortalRecordStatus = "active";
}

export class UpdatePortalCategoryDto {
  @IsOptional()
  @IsIn(PORTAL_CATEGORY_KINDS)
  kind?: PortalCategoryKind;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @Transform(({ value }) => (value === undefined ? value : Number(value)))
  @IsOptional()
  @IsInt()
  @Min(-100000)
  @Max(100000)
  sortOrder?: number;

  @IsOptional()
  @IsIn(PORTAL_RECORD_STATUSES)
  status?: PortalRecordStatus;
}

export class CreatePortalEntryDto {
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  categoryId!: number;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(300)
  description = "";

  @Transform(optionalTrim)
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @Matches(/^(?:https?:\/\/|\/)/, {
    message: "url must be an HTTP(S) URL or an absolute site path.",
  })
  url?: string | null;

  @Transform(optionalTrim)
  @IsOptional()
  @IsString()
  @MaxLength(512)
  @Matches(/^(?:https?:\/\/|\/)/, {
    message: "iconPath must be an HTTP(S) URL or an absolute site path.",
  })
  iconPath?: string | null;

  @IsBoolean()
  openInNewTab = true;

  @IsIn(PORTAL_VISIBILITIES)
  visibility: PortalVisibility = "public";

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(-100000)
  @Max(100000)
  sortOrder = 0;

  @IsIn(PORTAL_RECORD_STATUSES)
  status: PortalRecordStatus = "active";

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  roleCodes?: string[];
}

export class UpdatePortalEntryDto {
  @Transform(({ value }) => (value === undefined ? value : Number(value)))
  @IsOptional()
  @IsInt()
  @Min(1)
  categoryId?: number;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @Transform(optionalTrim)
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @Matches(/^(?:https?:\/\/|\/)/, {
    message: "url must be an HTTP(S) URL or an absolute site path.",
  })
  url?: string | null;

  @Transform(optionalTrim)
  @IsOptional()
  @IsString()
  @MaxLength(512)
  @Matches(/^(?:https?:\/\/|\/)/, {
    message: "iconPath must be an HTTP(S) URL or an absolute site path.",
  })
  iconPath?: string | null;

  @IsOptional()
  @IsBoolean()
  openInNewTab?: boolean;

  @IsOptional()
  @IsIn(PORTAL_VISIBILITIES)
  visibility?: PortalVisibility;

  @Transform(({ value }) => (value === undefined ? value : Number(value)))
  @IsOptional()
  @IsInt()
  @Min(-100000)
  @Max(100000)
  sortOrder?: number;

  @IsOptional()
  @IsIn(PORTAL_RECORD_STATUSES)
  status?: PortalRecordStatus;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  roleCodes?: string[];
}
