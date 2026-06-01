// =============================================================================
// U10 — Friends & Social Module (JavaScript)
// =============================================================================
// Compiled equivalent of friends.ts for Nakama runtime.
// =============================================================================

// ---------------------------------------------------------------------------
// RPC: search_user_by_username
// ---------------------------------------------------------------------------

function searchUserByUsernameRpc(ctx, logger, nk, payload) {
  if (!ctx.userId) {
    throw new Error("Unauthenticated");
  }

  var request;
  try {
    request = JSON.parse(payload || "{}");
  } catch (_e) {
    throw new Error("Invalid JSON payload");
  }

  var username = (request.username || "").trim();
  if (!username) {
    throw new Error("Missing required field: username");
  }

  // Nakama's usersGetUsername returns an array of user objects.
  var users;
  try {
    users = nk.usersGetUsername([username]);
  } catch (e) {
    logger.error('[Friends] Error searching for username "' + username + '": ' + e.message);
    return JSON.stringify({ found: false });
  }

  if (!users || users.length === 0) {
    return JSON.stringify({ found: false });
  }

  var u = users[0];

  // Don't allow a user to find themselves via search
  if (u.userId === ctx.userId) {
    return JSON.stringify({ found: false, self: true });
  }

  // Read the user's player_stats to get their level
  var level = 1;
  try {
    var statsResult = nk.storageRead([{
      collection: "player_stats",
      key: "stats",
      userId: u.userId,
    }]);
    if (statsResult && statsResult.length > 0) {
      var stats = statsResult[0].value;
      level = stats.level || 1;
    }
  } catch (_e) {
    // Non-fatal: return level 1 as default
  }

  logger.info("[Friends] User " + ctx.userId + " found player: " + u.username + " (" + u.userId + ")");

  return JSON.stringify({
    found: true,
    user: {
      id: u.userId,
      username: u.username,
      display_name: u.displayName || u.username,
      avatar_url: u.avatarUrl || "",
      level: level,
    },
  });
}

function InitModule(ctx, logger, nk, initializer) {
  initializer.registerRpc("search_user_by_username", searchUserByUsernameRpc);
  logger.info("[Friends] Friends module loaded successfully.");
}
