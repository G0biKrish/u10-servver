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
    storageList(userId: string | null, collection: string, limit: number, cursor?: string | null): any;
    walletUpdate(userId: string, changes: any, metadata?: any, rollbackUserWallet?: boolean): void;
    uuidV4(): string;
    accountUpdateId(userId: string, username?: string | null, displayName?: string | null, timezone?: string | null, location?: string | null, langTag?: string | null, avatarUrl?: string | null, metadata?: any): void;
    matchmakerAdd(userId: string, query: string, minCount: number, maxCount: number, stringProperties?: any, numericProperties?: any, countMultiple?: number): string;
    matchmakerRemove(userId: string, ticket: string): void;
    usersGetUsername(usernames: string[]): any[];
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
