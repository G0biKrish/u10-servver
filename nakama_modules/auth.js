// =============================================================================
// U10 — Auth Lifecycle & User Provisioning Module
// =============================================================================
// Responsibility: Owns everything related to WHO a user is.
//   - Hooks into post-authentication events (device + Google)
//   - Generates a unique 8-digit numeric username for new accounts
//   - Initializes the player profile storage record
//
// This module intentionally contains ZERO coin / economy logic.
// Coin grants are the responsibility of economy.js (claim_signup_reward RPC).
// =============================================================================

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Inclusive lower bound for the 8-digit numeric username range. */
var USERNAME_MIN = 10000000;

/** Inclusive upper bound for the 8-digit numeric username range. */
var USERNAME_MAX = 99999999;

/** Maximum collision-retry attempts before giving up on username assignment. */
var USERNAME_RETRY_LIMIT = 10;

/**
 * Default player profile written to Nakama Storage on first registration.
 *
 * NOTE: coins intentionally starts at 0.
 * The first-time 1000c bonus is credited by the Economy module's
 * claim_signup_reward RPC when the client calls it after login.
 * This keeps the coin ledger entirely inside the Economy domain.
 */
var DEFAULT_PLAYER_STATS = {
  wins: 0,
  total_played: 0,
  best_streak: 0,
  lp: 0,
  tier: "Bronze",
  coins: 0,
  level: 1,
  xp: 0,
  login_streak: 0,
  last_login_claim: 0,
  current_cycle: 1,
  active_streak_shields: 0,
  welcome_back_eligible: false
};

var DEFAULT_PLAYER_INVENTORY = {
  spin_tokens: 0,
  shields: { starter: 0, bronze: 0, silver: 0, gold: 0, platinum: 0 },
  unlocked_cosmetics: ["card_back_default"],
  equipped_cosmetics: { card_back: "card_back_default", avatar_ring: "" }
};

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Attempts to assign a unique 8-digit numeric username to a newly created
 * user. Retries up to USERNAME_RETRY_LIMIT times on collision.
 * Throws if no unique username can be found within the retry limit.
 */
function generateUniqueUsername(nk, logger, userId) {
  for (var attempt = 0; attempt < USERNAME_RETRY_LIMIT; attempt++) {
    var candidate = String(
      Math.floor(USERNAME_MIN + Math.random() * (USERNAME_MAX - USERNAME_MIN + 1))
    );
    try {
      nk.accountUpdateId(userId, candidate, null, null, null, null, null, null);
      logger.info("[Auth] Assigned username " + candidate + " to user " + userId + ".");
      return candidate;
    } catch (_e) {
      logger.warn(
        "[Auth] Username " + candidate + " collision — retrying (" + (attempt + 1) + "/" + USERNAME_RETRY_LIMIT + ")."
      );
    }
  }
  throw new Error(
    "[Auth] Failed to assign unique username to " + userId + " after " + USERNAME_RETRY_LIMIT + " attempts."
  );
}

/**
 * Writes the default player profile record to Nakama Storage.
 * Called once per user at the moment of first registration.
 *
 * Permission model:
 *   permissionRead  = 1 → Public read  (friends, leaderboards can see stats)
 *   permissionWrite = 1 → Owner write  (client can update non-critical fields)
 */
function initializePlayerProfile(nk, logger, userId) {
  nk.storageWrite([
    {
      collection: "player_stats",
      key: "stats",
      userId: userId,
      value: DEFAULT_PLAYER_STATS,
      permissionRead: 1,
      permissionWrite: 1
    },
    {
      collection: "player_inventory",
      key: "inventory",
      userId: userId,
      value: DEFAULT_PLAYER_INVENTORY,
      permissionRead: 1,
      permissionWrite: 0 // Server-only write (tamper-proof)
    }
  ]);
  logger.info("[Auth] Player profile and inventory initialized for user " + userId + ".");
}

// ---------------------------------------------------------------------------
// After-authenticate hook (runs only on brand-new account creation)
// ---------------------------------------------------------------------------

/**
 * Fires after a successful authentication for BOTH device and Google auth.
 * Only executes provisioning logic when out.created === true (new accounts).
 * Existing accounts silently pass through without any action.
 */
function onAfterAuthenticate(ctx, logger, nk, out, _request) {
  // Guard: only provision brand-new registrations
  if (!out.created) return;

  var userId = ctx.userId;
  logger.info("[Auth] New user registered: " + userId + ". Starting provisioning...");

  // 1. Assign a unique 8-digit username
  try {
    generateUniqueUsername(nk, logger, userId);
  } catch (e) {
    // Non-fatal: user keeps the Nakama auto-generated username as fallback.
    // Account is still fully functional.
    logger.error("[Auth] Username assignment error for " + userId + ": " + e.message);
  }

  // 2. Create the player profile storage record
  try {
    initializePlayerProfile(nk, logger, userId);
  } catch (e) {
    // Non-fatal: EconomyManager on the client will handle missing records gracefully.
    logger.error("[Auth] Profile initialization error for " + userId + ": " + e.message);
  }

  logger.info("[Auth] Provisioning complete for user " + userId + ".");
}

// ---------------------------------------------------------------------------
// Module initializer — called by index.js entry point
// ---------------------------------------------------------------------------

function InitModule(ctx, logger, nk, initializer) {
  initializer.registerAfterAuthenticateDevice(onAfterAuthenticate);
  initializer.registerAfterAuthenticateGoogle(onAfterAuthenticate);

  logger.info("[Auth] Auth module loaded successfully.");
}
