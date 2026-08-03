import { IsString, MaxLength } from "class-validator";

export class RestoreBackupDto {
  @IsString()
  @MaxLength(220)
  confirmation!: string;
}
