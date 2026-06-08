// =============================================================================
// U10 — Private Table Module (TypeScript)
// =============================================================================

function readPlayerStats(nk: nkruntime.Nakama, userId: string): any {
  const defaults = {
    wins: 0, total_played: 0, best_streak: 0, lp: 0,
    tier: "Bronze", coins: 0, level: 1, xp: 0,
    last_wheel_spin: 0,
    current_cycle: 1, active_streak_shields: 0, welcome_back_eligible: false,
    weekly_claims: [false, false, false, false, false, false, false],
    week_number: 0,
    week_year: 0,
    last_first_match_date: 0,
    current_win_streak: 0,
  };
  const result = nk.storageRead([{ collection: "player_stats", key: "stats", userId }]);
  return (result && result.length > 0) ? { ...defaults, ...result[0].value } : defaults;
}

function writePlayerStats(nk: nkruntime.Nakama, userId: string, stats: any): void {
  nk.storageWrite([{
    collection: "player_stats",
    key: "stats",
    userId,
    value: stats,
    permissionRead: 1,
    permissionWrite: 1,
  }]);
}

function readTableConfig(nk: nkruntime.Nakama): any {
  const defaults = {
    public_max_players: 5,
    private_max_players: 5,
    private_create_cost: 100,
    elimination_points: [140, 180, 260, 340],
    code_length: 6
  };
  try {
    const result = nk.storageRead([{
      collection: "system_config",
      key: "arena_list",
      userId: "00000000-0000-0000-0000-000000000000",
    }]);
    if (result && result.length > 0 && result[0].value) {
      const config = result[0].value as any;
      if (config.table_config) {
        return { ...defaults, ...config.table_config };
      }
    }
  } catch (e) {
    // Non-fatal fallback
  }
  return defaults;
}

function generateTableCode(nk: nkruntime.Nakama): string {
  const config = readTableConfig(nk);
  const length = config.code_length || 6;
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  if (length === 8) {
    let code1 = "";
    let code2 = "";
    for (let i = 0; i < 4; i++) {
      code1 += chars.charAt(Math.floor(Math.random() * chars.length));
      code2 += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `${code1}-${code2}`;
  } else {
    let code = "";
    for (let i = 0; i < length; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }
}

function generateUniqueTableCode(nk: nkruntime.Nakama): string {
  let attempts = 0;
  while (attempts < 10) {
    const code = generateTableCode(nk);
    const read = nk.storageRead([{
      collection: "private_tables",
      key: code,
      userId: "00000000-0000-0000-0000-000000000000",
    }]);
    if (!read || read.length === 0) {
      return code;
    }
    attempts++;
  }
  throw new Error("Failed to generate unique table code after 10 attempts.");
}

// ---------------------------------------------------------------------------
// Helper: Cleanup Inactive Tables
// ---------------------------------------------------------------------------
function cleanupInactiveTables(nk: nkruntime.Nakama, logger: nkruntime.Logger): void {
  try {
    const oneHourAgo = Date.now() - 3600000; // 1 hour in ms
    let cursor: string | null = null;
    let deleteCount = 0;

    do {
      const result = nk.storageList(null, "private_tables", 100, cursor);
      const objects = result.objects || [];
      if (objects.length === 0) {
        break;
      }

      const toDelete: any[] = [];
      for (const obj of objects) {
        const table = obj.value as any;
        if (table && table.created_at && table.created_at < oneHourAgo) {
          toDelete.push({
            collection: "private_tables",
            key: obj.key,
            userId: "00000000-0000-0000-0000-000000000000"
          });
        }
      }

      if (toDelete.length > 0) {
        nk.storageDelete(toDelete);
        deleteCount += toDelete.length;
      }

      cursor = result.cursor || null;
    } while (cursor);

    if (deleteCount > 0) {
      logger.info(`[PrivateTable] Cleaned up ${deleteCount} inactive private tables older than 1 hour.`);
    }
  } catch (e) {
    logger.error(`[PrivateTable] Error during inactive tables cleanup: ${e}`);
  }
}

// ---------------------------------------------------------------------------
// RPC: get_table_config
// ---------------------------------------------------------------------------
function getTableConfigRpc(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  _payload: string
): string {
  if (!ctx.userId) {
    throw new Error("Unauthenticated");
  }
  const config = readTableConfig(nk);
  return JSON.stringify({ success: true, table_config: config });
}

// ---------------------------------------------------------------------------
// RPC: create_private_table
// ---------------------------------------------------------------------------
function createPrivateTableRpc(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  cleanupInactiveTables(nk, logger);

  const userId = ctx.userId;
  if (!userId) {
    throw new Error("Unauthenticated");
  }

  let request: any = {};
  try {
    request = JSON.parse(payload || "{}");
  } catch (e) {
    throw new Error("Invalid JSON payload");
  }

  const arenaTier = request.arena_tier || "practice";
  const eliminationPoints = request.elimination_points || 180;
  const partyId = request.party_id;

  if (!partyId) {
    throw new Error("Missing party_id");
  }

  const config = readTableConfig(nk);
  const stats = readPlayerStats(nk, userId);

  // Determine effective creation cost
  let cost = config.private_create_cost !== undefined ? config.private_create_cost : 100;
  if (stats.level >= 500) {
    cost = 0;
  }

  if (stats.coins < cost) {
    throw new Error("Insufficient coins to create a private table.");
  }

  const code = generateUniqueTableCode(nk);

  if (cost > 0) {
    stats.coins -= cost;
    writePlayerStats(nk, userId, stats);
    nk.walletUpdate(userId, { coins: -cost }, { source: "private_table_creation", code });
    logger.info(`[PrivateTable] Player ${userId} paid ${cost} coins to create table ${code}`);
  } else {
    logger.info(`[PrivateTable] Player ${userId} (level ${stats.level}) created table ${code} for free`);
  }

  const tableRecord = {
    code: code,
    party_id: partyId,
    host_id: userId,
    arena_tier: arenaTier,
    elimination_points: eliminationPoints,
    max_players: config.private_max_players || 5,
    created_at: Date.now(),
    status: "waiting"
  };

  nk.storageWrite([{
    collection: "private_tables",
    key: code,
    userId: "00000000-0000-0000-0000-000000000000",
    value: tableRecord,
    permissionRead: 2,
    permissionWrite: 0,
  }]);

  return JSON.stringify({ success: true, code: code, cost_paid: cost, table: tableRecord });
}

// ---------------------------------------------------------------------------
// RPC: join_private_table
// ---------------------------------------------------------------------------
function joinPrivateTableRpc(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  cleanupInactiveTables(nk, logger);

  const userId = ctx.userId;
  if (!userId) {
    throw new Error("Unauthenticated");
  }

  let request: any = {};
  try {
    request = JSON.parse(payload || "{}");
  } catch (e) {
    throw new Error("Invalid JSON payload");
  }

  const code = (request.code || "").toUpperCase().trim();
  if (!code) {
    throw new Error("Missing code");
  }

  const result = nk.storageRead([{
    collection: "private_tables",
    key: code,
    userId: "00000000-0000-0000-0000-000000000000",
  }]);

  if (!result || result.length === 0) {
    return JSON.stringify({ success: false, error: "Table not found." });
  }

  const table = result[0].value as any;
  if (table.status !== "waiting") {
    return JSON.stringify({ success: false, error: "Table game is already in progress or cancelled." });
  }

  return JSON.stringify({
    success: true,
    party_id: table.party_id,
    arena_tier: table.arena_tier,
    elimination_points: table.elimination_points
  });
}

// ---------------------------------------------------------------------------
// RPC: cancel_private_table
// ---------------------------------------------------------------------------
function cancelPrivateTableRpc(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  const userId = ctx.userId;
  if (!userId) {
    throw new Error("Unauthenticated");
  }

  let request: any = {};
  try {
    request = JSON.parse(payload || "{}");
  } catch (e) {
    throw new Error("Invalid JSON payload");
  }

  const code = (request.code || "").toUpperCase().trim();
  if (!code) {
    throw new Error("Missing code");
  }

  const result = nk.storageRead([{
    collection: "private_tables",
    key: code,
    userId: "00000000-0000-0000-0000-000000000000",
  }]);

  if (!result || result.length === 0) {
    return JSON.stringify({ success: false, error: "Table not found." });
  }

  const table = result[0].value as any;
  if (table.host_id !== userId) {
    return JSON.stringify({ success: false, error: "Only the host can cancel the table." });
  }

  nk.storageDelete([{
    collection: "private_tables",
    key: code,
    userId: "00000000-0000-0000-0000-000000000000"
  }]);

  logger.info(`[PrivateTable] Table ${code} cancelled by host ${userId}`);
  return JSON.stringify({ success: true });
}

// ---------------------------------------------------------------------------
// RPC: get_player_profiles
// ---------------------------------------------------------------------------
function getPlayerProfilesRpc(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  if (!ctx.userId) {
    throw new Error("Unauthenticated");
  }

  let request: { user_ids?: string[] };
  try {
    request = JSON.parse(payload || "{}");
  } catch (_e) {
    throw new Error("Invalid JSON payload");
  }

  const userIds = request.user_ids || [];
  if (userIds.length === 0) {
    return JSON.stringify({ success: true, profiles: {} });
  }

  const profiles: Record<string, any> = {};

  try {
    const users = nk.usersGetId(userIds);
    
    // Batch read storage objects for all stats
    const readObjects = userIds.map(uid => ({
      collection: "player_stats",
      key: "stats",
      userId: uid
    }));
    
    const statsResults = nk.storageRead(readObjects);
    const statsMap: Record<string, any> = {};
    for (const res of statsResults) {
      statsMap[res.userId] = res.value;
    }

    for (const u of users) {
      const stats = statsMap[u.userId] || {};
      profiles[u.userId] = {
        user_id: u.userId,
        username: u.username,
        display_name: u.displayName || u.username,
        avatar_url: u.avatarUrl || "",
        level: stats.level || 1,
        tier: stats.tier || "Bronze"
      };
    }
  } catch (e) {
    logger.error(`[PrivateTable] Error fetching player profiles: ${(e as Error).message}`);
    return JSON.stringify({ success: false, error: (e as Error).message });
  }

  return JSON.stringify({ success: true, profiles });
}

