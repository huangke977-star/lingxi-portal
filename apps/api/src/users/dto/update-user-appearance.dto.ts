import { IsHexColor, IsIn, IsInt, Max, Min } from 'class-validator';

const THEME_IDS = ['sakura-mist', 'cloud-blue', 'night-purple', 'custom'] as const;

export class UpdateUserAppearanceDto {
  @IsIn(THEME_IDS)
  themeId!: string;

  @IsHexColor()
  customAccent!: string;

  @IsHexColor()
  customSurface!: string;

  @IsHexColor()
  customForeground!: string;

  @IsHexColor()
  customMuted!: string;

  @IsInt()
  @Min(38)
  @Max(76)
  cardAlpha!: number;

  @IsInt()
  @Min(0)
  @Max(36)
  glassBlur!: number;

  @IsHexColor()
  glassTint!: string;

  @IsInt()
  @Min(0)
  @Max(100)
  glassTintAlpha!: number;
}
