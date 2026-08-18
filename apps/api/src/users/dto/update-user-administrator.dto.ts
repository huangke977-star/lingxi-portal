import { IsBoolean } from "class-validator";

export class UpdateUserAdministratorDto {
  @IsBoolean()
  isAdministrator!: boolean;
}
