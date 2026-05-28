declare namespace nkruntime {
  interface Context {
    userId: string;
    username?: string;
    vars?: Record<string, string>;
  }
  interface Logger {
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
  }
  interface Nakama {
    storageRead(objects: any[]): any[];
    storageWrite(objects: any[]): void;
    storageDelete(objects: any[]): void;
    walletUpdate(userId: string, changes: any, metadata?: any, rollbackUserWallet?: boolean): void;
    uuidV4(): string;
    accountUpdateId(userId: string, username?: string | null, displayName?: string | null, timezone?: string | null, location?: string | null, langTag?: string | null, avatarUrl?: string | null, metadata?: any): void;
  }
  interface Initializer {
    registerRpc(id: string, fn: Function): void;
    registerAfterAuthenticateDevice(fn: Function): void;
    registerAfterAuthenticateGoogle(fn: Function): void;
  }
  interface Session {
    created: boolean;
  }
}
