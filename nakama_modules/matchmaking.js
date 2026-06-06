// =============================================================================
// U10 — Server-Authoritative Matchmaking Module (JavaScript)
// =============================================================================

function getPlayerTier(level) {
  return Math.floor((level - 1) / 10) + 1;
}

function getArenaEntryFee(arenaId) {
  var fees = {
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
function joinMatchmakingQueueRpc(ctx, logger, nk, payload) {
  var userId = ctx.userId;
  if (!userId) {
    throw new Error("Unauthorized");
  }

  var request = {};
  try {
    request = JSON.parse(payload || "{}");
  } catch (e) {
    throw new Error("Invalid JSON payload");
  }

  var arenaId = request.arena_id || "wooden";

  // Authoritative database read for coins and level
  var statsList = nk.storageRead([{ collection: "player_stats", key: "stats", userId: userId }]);
  if (!statsList || statsList.length === 0) {
    throw new Error("Player stats not found.");
  }

  var stats = statsList[0].value;
  var level = stats.level || 1;
  var coins = stats.coins || 0;
  var myTier = getPlayerTier(level);

  // Validate coins for entry fee
  var entryFee = getArenaEntryFee(arenaId);
  if (coins < entryFee) {
    throw new Error("Insufficient coins to enter arena.");
  }

  var query = "+properties.tier:" + myTier + " +properties.arena_id:" + arenaId;
  var stringProperties = { "arena_id": arenaId };
  var numericProperties = { "tier": myTier };

  // Securely add the presence to the matchmaker
  var ticket = nk.matchmakerAdd(userId, query, 5, 5, stringProperties, numericProperties);
  logger.info("[Matchmaking] Player " + userId + " joined matchmaking ticket " + ticket + " with Tier " + myTier);

  return JSON.stringify({ ticket: ticket, success: true });
}

// 2. Escalate Matchmaking Range
function escalateMatchmakingRpc(ctx, logger, nk, payload) {
  var userId = ctx.userId;
  if (!userId) {
    throw new Error("Unauthorized");
  }

  var request = {};
  try {
    request = JSON.parse(payload || "{}");
  } catch (e) {
    throw new Error("Invalid JSON payload");
  }

  var oldTicket = request.ticket_id;
  var escalationStep = request.step || 2;
  var arenaId = request.arena_id || "wooden";

  if (!oldTicket) {
    throw new Error("Missing old ticket_id.");
  }

  // Remove old ticket
  try {
    nk.matchmakerRemove(userId, oldTicket);
  } catch (e) {
    logger.warn("[Matchmaking] Could not remove old ticket: " + oldTicket);
  }

  var statsList = nk.storageRead([{ collection: "player_stats", key: "stats", userId: userId }]);
  if (!statsList || statsList.length === 0) {
    throw new Error("Player stats not found.");
  }

  var stats = statsList[0].value;
  var level = stats.level || 1;
  var myTier = getPlayerTier(level);

  var query = "";
  if (escalationStep === 2) {
    // Expand to own tier and next higher tier (+1)
    query = "+properties.tier:>=" + myTier + " +properties.tier:<=" + (myTier + 1) + " +properties.arena_id:" + arenaId;
  } else {
    // Open query (match any tier, prioritizing proximity)
    query = "+properties.arena_id:" + arenaId;
  }

  var stringProperties = { "arena_id": arenaId };
  var numericProperties = { "tier": myTier };

  var newTicket = nk.matchmakerAdd(userId, query, 5, 5, stringProperties, numericProperties);
  logger.info("[Matchmaking] Escalated player " + userId + " to ticket " + newTicket + " with step " + escalationStep);

  return JSON.stringify({ ticket: newTicket, success: true });
}

// 3. Cancel Matchmaking
function cancelMatchmakingRpc(ctx, logger, nk, payload) {
  var userId = ctx.userId;
  if (!userId) {
    throw new Error("Unauthorized");
  }

  var request = {};
  try {
    request = JSON.parse(payload || "{}");
  } catch (e) {
    throw new Error("Invalid JSON payload");
  }

  var ticketId = request.ticket_id;
  if (!ticketId) {
    throw new Error("Missing ticket_id");
  }

  try {
    nk.matchmakerRemove(userId, ticketId);
    logger.info("[Matchmaking] Player " + userId + " cancelled ticket " + ticketId);
  } catch (e) {
    logger.warn("[Matchmaking] Failed to remove ticket: " + e.message);
  }

  return JSON.stringify({ success: true });
}
