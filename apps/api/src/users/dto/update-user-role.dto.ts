import { IsString, MinLength } from 'class-validator';

export class UpdateUserRoleDto {
  @IsString()
  @MinLength(1)
  roleCode!: string;
}
