import { ConflictException, Injectable } from "@nestjs/common";

export class BackupOperationBusyException extends ConflictException {
  constructor(activeOperation: string) {
    super(`备份 I/O 通道正在被${activeOperation}占用，请稍后重试。`);
  }
}

@Injectable()
export class BackupOperationLockService {
  private holder: { operation: string; token: symbol } | null = null;

  acquire(operation: string): () => void {
    if (this.holder) {
      throw new BackupOperationBusyException(this.holder.operation);
    }

    const token = Symbol(operation);
    this.holder = { operation, token };
    let released = false;

    return () => {
      if (released) return;
      released = true;
      if (this.holder?.token === token) this.holder = null;
    };
  }
}
