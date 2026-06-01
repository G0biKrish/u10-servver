// =============================================================================
// U10 — Friends & Social Module (TypeScript)
// =============================================================================
// Responsibility: Owns social-graph RPCs that supplement Nakama's native
//   friend API (add/list/delete friends are handled natively by Nakama SDK).
//
//   - searchUserByUsernameRpc: Look up a player by their 8-digit username.
//     Returns a safe public profile (id, username, display_name, avatar_url)
//     so the client can then call the native add_friends API with the user ID.
// =============================================================================

// ---------------------------------------------------------------------------
// RPC: search_user_by_username
// ---------------------------------------------------------------------------

/**
 * Search for a player by their exact 8-digit numeric username (Challenger ID).
 *
 * Payload: { "username": "12345678" }
 * Returns: {
 *   "found": true,
 *   "user": {
 *     "id":           "<nakama-user-id>",
 *     "username":     "12345678",
 *     "display_name": "ShadowHunter_X",
 *     "avatar_url":   "https://...",
 *     "level":        42
 *   }
 * }
 * or { "found": false }
 */
function searchUserByUsernameRpc(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  if (!ctx.userId) {
    throw new Error("Unauthenticated");
  }

  let request: { username?: string };
  try {
    request = JSON.parse(payload || "{}");
  } catch (_e) {
    throw new Error("Invalid JSON payload");
  }

  const username = (request.username || "").trim();
  if (!username) {
    throw new Error("Missing required field: username");
  }

  // Nakama's getUsersByUsername returns an array of account objects.
  let users: nkruntime.User[];
  try {
    users = nk.usersGetUsername([username]);
  } catch (e) {
    logger.error(`[Friends] Error searching for username "${username}": ${(e as Error).message}`);
    return JSON.stringify({ found: false });
  }

  if (!users || users.length === 0) {
    return JSON.stringify({ found: false });
  }

  const u = users[0];

  // Don't allow a user to find themselves via search
  if (u.userId === ctx.userId) {
    return JSON.stringify({ found: false, self: true });
  }

  // Read the user's player_stats to get their level
  let level = 1;
  try {
    const statsResult = nk.storageRead([{
      collection: "player_stats",
      key: "stats",
      userId: u.userId,
    }]);
    if (statsResult && statsResult.length > 0) {
      const stats = statsResult[0].value as any;
      level = stats.level || 1;
    }
  } catch (_e) {
    // Non-fatal: return level 1 as default
  }

  logger.info(`[Friends] User ${ctx.userId} found player: ${u.username} (${u.userId})`);

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

// ---------------------------------------------------------------------------
// Module entry point
// ---------------------------------------------------------------------------

function InitModule(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  initializer: nkruntime.Initializer
): void {
  initializer.registerRpc("search_user_by_username", searchUserByUsernameRpc);
  logger.info("[Friends] Friends module loaded successfully.");
}
