import { IsIn } from 'class-validator';
import { UserStatus } from '../../auth/auth.types';

export class UpdateUserStatusDto {
  @IsIn(['active', 'disabled'])
  status!: UserStatus;
}
