import { IsIn } from "class-validator";

export class UpdateUserLocaleDto {
  @IsIn(["zh-CN", "en-US"])
  locale!: "zh-CN" | "en-US";
}
