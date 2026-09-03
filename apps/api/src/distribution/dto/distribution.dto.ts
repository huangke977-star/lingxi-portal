import { IsBoolean } from "class-validator";

export class UpdateSubscriptionEmailPreferenceDto {
  @IsBoolean()
  enabled!: boolean;
}
