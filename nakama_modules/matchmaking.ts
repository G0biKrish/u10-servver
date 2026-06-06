// =============================================================================
// U10 — Server-Authoritative Matchmaking Module (TypeScript)
// =============================================================================

function getPlayerTier(level: number): number {
  return Math.floor((level - 1) / 10) + 1;
}

function getArenaEntryFee(arenaId: string): number {
  const fees: { [key: string]: number } = {
    "practice": 0,
    "starter": 50,
    "bronze": 250,
    "silver": 500,
    "gold": 1000,
    "platinum": 2000
  };
  return fees[arenaId] !== undefined ? fees[arenaId] : 0;
}

// 1. Join Matchmaking Queue (Tamper-Proof)
function joinMatchmakingQueueRpc(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const userId = ctx.userId;
  if (!userId) {
    throw new Error("Unauthorized");
  }

  let request: any = {};
  try {
    request = JSON.parse(payload || "{}");
  } catch (e) {
    throw new Error("Invalid JSON payload");
  }

  const arenaId = request.arena_id || "wooden";

  // Authoritative database read for coins and level
  const statsList = nk.storageRead([{ collection: "player_stats", key: "stats", userId }]);
  if (!statsList || statsList.length === 0) {
    throw new Error("Player stats not found.");
  }

  const stats = statsList[0].value;
  const level = stats.level || 1;
  const coins = stats.coins || 0;
  const myTier = getPlayerTier(level);

  // Validate coins for entry fee
  const entryFee = getArenaEntryFee(arenaId);
  if (coins < entryFee) {
    throw new Error("Insufficient coins to enter arena.");
  }

  const query = `+properties.tier:${myTier} +properties.arena_id:${arenaId}`;
  const stringProperties = { "arena_id": arenaId };
  const numericProperties = { "tier": myTier };

  // Securely add the presence to the matchmaker
  const ticket = nk.matchmakerAdd(userId, query, 5, 5, stringProperties, numericProperties);
  logger.info("[Matchmaking] Player %s joined matchmaking ticket %s with Tier %d", userId, ticket, myTier);

  return JSON.stringify({ ticket: ticket, success: true });
}

// 2. Escalate Matchmaking Range
function escalateMatchmakingRpc(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const userId = ctx.userId;
  if (!userId) {
    throw new Error("Unauthorized");
  }

  let request: any = {};
  try {
    request = JSON.parse(payload || "{}");
  } catch (e) {
    throw new Error("Invalid JSON payload");
  }

  const oldTicket = request.ticket_id;
  const escalationStep = request.step || 2;
  const arenaId = request.arena_id || "wooden";

  if (!oldTicket) {
    throw new Error("Missing old ticket_id.");
  }

  // Remove old ticket
  try {
    nk.matchmakerRemove(userId, oldTicket);
  } catch (e) {
    logger.warn("[Matchmaking] Could not remove old ticket: %s", oldTicket);
  }

  const statsList = nk.storageRead([{ collection: "player_stats", key: "stats", userId }]);
  if (!statsList || statsList.length === 0) {
    throw new Error("Player stats not found.");
  }

  const stats = statsList[0].value;
  const level = stats.level || 1;
  const myTier = getPlayerTier(level);

  let query = "";
  if (escalationStep === 2) {
    // Expand to own tier and next higher tier (+1)
    query = `+properties.tier:>=${myTier} +properties.tier:<=${myTier + 1} +properties.arena_id:${arenaId}`;
  } else {
    // Open query (match any tier, prioritizing proximity)
    query = `+properties.arena_id:${arenaId}`;
  }

  const stringProperties = { "arena_id": arenaId };
  const numericProperties = { "tier": myTier };

  const newTicket = nk.matchmakerAdd(userId, query, 5, 5, stringProperties, numericProperties);
  logger.info("[Matchmaking] Escalated player %s to ticket %s with step %d", userId, newTicket, escalationStep);

  return JSON.stringify({ ticket: newTicket, success: true });
}

// 3. Cancel Matchmaking
function cancelMatchmakingRpc(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const userId = ctx.userId;
  if (!userId) {
    throw new Error("Unauthorized");
  }

  let request: any = {};
  try {
    request = JSON.parse(payload || "{}");
  } catch (e) {
    throw new Error("Invalid JSON payload");
  }

  const ticketId = request.ticket_id;
  if (!ticketId) {
    throw new Error("Missing ticket_id");
  }

  try {
    nk.matchmakerRemove(userId, ticketId);
    logger.info("[Matchmaking] Player %s cancelled ticket %s", userId, ticketId);
  } catch (e) {
    logger.warn("[Matchmaking] Failed to remove ticket: %s", e.message);
  }

  return JSON.stringify({ success: true });
}
