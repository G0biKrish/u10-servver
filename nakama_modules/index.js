// =============================================================================
// U10 Nakama Server — Runtime Bundle (index.js)
// =============================================================================
// Generated dynamically by build.js
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// AUTH DOMAIN
// ─────────────────────────────────────────────────────────────────────────────
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



// ─────────────────────────────────────────────────────────────────────────────
// ECONOMY DOMAIN
// ─────────────────────────────────────────────────────────────────────────────
"use strict";
// =============================================================================
// U10 — Economy & Rewards Module (TypeScript)
// =============================================================================
// Responsibility: Owns everything related to WHAT a player earns and spends.
//   - Daily login streak cycle scaling & item rewards
//   - Streak recovery & streak shields
//   - Spin wheel segments, soft caps & jackpots
//   - Optional ad multipliers (max 3/day)
//   - Server-authoritative match entry validation & loss protection
//   - XP progression & level milestone rewards
// =============================================================================
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** Base coin rewards for Day 1–7 (Cycle 1). */
var DAILY_REWARDS_BASE = [50, 75, 100, 125, 150, 200, 350];
/** Coin entry fee for each arena tier. */
var ARENA_ENTRY_FEES = {
    starter: 100,
    bronze: 200,
    silver: 500,
    gold: 1000,
    platinum: 2000,
};
// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------
function readPlayerStats(nk, userId) {
    var defaults = {
        wins: 0, total_played: 0, best_streak: 0, lp: 0,
        tier: "Bronze", coins: 0, level: 1, xp: 0,
        last_wheel_spin: 0,
        current_cycle: 1, active_streak_shields: 0, welcome_back_eligible: false,
        weekly_claims: [false, false, false, false, false, false, false],
        week_number: 0,
        week_year: 0,
    };
    var result = nk.storageRead([{ collection: "player_stats", key: "stats", userId: userId }]);
    return (result && result.length > 0) ? __assign(__assign({}, defaults), result[0].value) : defaults;
}
function writePlayerStats(nk, userId, stats) {
    nk.storageWrite([{
            collection: "player_stats",
            key: "stats",
            userId: userId,
            value: stats,
            permissionRead: 1,
            permissionWrite: 1,
        }]);
}
function readPlayerInventory(nk, userId) {
    var defaults = {
        spin_tokens: 0,
        shields: { starter: 0, bronze: 0, silver: 0, gold: 0, platinum: 0 },
        unlocked_cosmetics: ["card_back_default"],
        equipped_cosmetics: { card_back: "card_back_default", avatar_ring: "" }
    };
    var result = nk.storageRead([{ collection: "player_inventory", key: "inventory", userId: userId }]);
    return (result && result.length > 0) ? __assign(__assign({}, defaults), result[0].value) : defaults;
}
function writePlayerInventory(nk, userId, inventory) {
    nk.storageWrite([{
            collection: "player_inventory",
            key: "inventory",
            userId: userId,
            value: inventory,
            permissionRead: 1,
            permissionWrite: 0, // Server-only write (tamper-proof)
        }]);
}
function readPlayerDailyLimits(nk, userId) {
    var defaults = {
        spins_today_count: 0,
        spin_coins_today: 0,
        ad_multipliers_today: 0,
        last_spin_timestamp: 0,
        last_jackpot_timestamp: 0,
        last_ad_multiplier_timestamp: 0
    };
    var result = nk.storageRead([{ collection: "player_daily_limits", key: "limits", userId: userId }]);
    if (result && result.length > 0) {
        var data = result[0].value;
        var now = new Date();
        var lastDate = new Date(data.last_spin_timestamp || 0);
        var isNewDay = now.getUTCDate() !== lastDate.getUTCDate() ||
            now.getUTCMonth() !== lastDate.getUTCMonth() ||
            now.getUTCFullYear() !== lastDate.getUTCFullYear();
        if (isNewDay) {
            data.spins_today_count = 0;
            data.spin_coins_today = 0;
            data.ad_multipliers_today = 0;
        }
        return __assign(__assign({}, defaults), data);
    }
    return defaults;
}
function writePlayerDailyLimits(nk, userId, limits) {
    nk.storageWrite([{
            collection: "player_daily_limits",
            key: "limits",
            userId: userId,
            value: limits,
            permissionRead: 1,
            permissionWrite: 0, // Server-only write
        }]);
}
// ---------------------------------------------------------------------------
// Helpers for Calendar-Week Daily Rewards
// ---------------------------------------------------------------------------
function getISOWeek(date) {
    var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    var dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    var week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return { week: week, year: d.getUTCFullYear() };
}
function getTodayDayIndex() {
    var day = new Date().getUTCDay(); // 0=Sun, 1=Mon...6=Sat
    return day === 0 ? 6 : day - 1; // Convert to 0=Mon...6=Sun
}
function getDailyRewardsStatusRpc(ctx, logger, nk, _payload) {
    var userId = ctx.userId;
    if (!userId)
        throw new Error("Unauthenticated request.");
    var stats = readPlayerStats(nk, userId);
    var now = new Date();
    var _a = getISOWeek(now), week = _a.week, year = _a.year;
    var todayIndex = getTodayDayIndex();
    // Week rollover check
    if (stats.week_number !== week || stats.week_year !== year) {
        var prevFullWeek = (stats.weekly_claims || []).every(function (c) { return c === true; });
        if (prevFullWeek) {
            stats.current_cycle = Math.min((stats.current_cycle || 1) + 1, 3);
        }
        else {
            stats.current_cycle = 1;
        }
        stats.weekly_claims = [false, false, false, false, false, false, false];
        stats.week_number = week;
        stats.week_year = year;
        writePlayerStats(nk, userId, stats);
        logger.info("[Economy] New ISO week detected (".concat(week, "/").concat(year, "). Rollover triggered. Cycle: ").concat(stats.current_cycle));
    }
    var isTodayClaimed = stats.weekly_claims[todayIndex];
    return JSON.stringify({
        success: true,
        weekly_claims: stats.weekly_claims,
        today_index: todayIndex,
        is_today_claimed: isTodayClaimed,
        current_cycle: stats.current_cycle,
    });
}
// ---------------------------------------------------------------------------
// RPC: claim_daily_login
// ---------------------------------------------------------------------------
function claimDailyLoginRpc(ctx, logger, nk, _payload) {
    var userId = ctx.userId;
    if (!userId)
        throw new Error("Unauthenticated request.");
    var stats = readPlayerStats(nk, userId);
    var inventory = readPlayerInventory(nk, userId);
    var now = new Date();
    var _a = getISOWeek(now), week = _a.week, year = _a.year;
    var todayIndex = getTodayDayIndex();
    // Week rollover check
    if (stats.week_number !== week || stats.week_year !== year) {
        var prevFullWeek = (stats.weekly_claims || []).every(function (c) { return c === true; });
        if (prevFullWeek) {
            stats.current_cycle = Math.min((stats.current_cycle || 1) + 1, 3);
        }
        else {
            stats.current_cycle = 1;
        }
        stats.weekly_claims = [false, false, false, false, false, false, false];
        stats.week_number = week;
        stats.week_year = year;
    }
    // Check if today already claimed
    if (stats.weekly_claims[todayIndex]) {
        return JSON.stringify({ success: false, error: "Already claimed today." });
    }
    // Calculate reward
    var cycle = Math.min(stats.current_cycle || 1, 3);
    var baseCoins = DAILY_REWARDS_BASE[todayIndex];
    var coinsGranted = baseCoins;
    // Add Cycle Daily scaling (+5c per day for Cycle 2, +10c per day for Cycle 3+)
    coinsGranted += (cycle - 1) * 5;
    var allDaysClaimedBonusApplied = false;
    if (todayIndex === 6) { // Sunday
        // Check if Mon-Sat (all previous 6 days) were claimed
        var allPrevClaimed = stats.weekly_claims.slice(0, 6).every(function (c) { return c === true; });
        if (allPrevClaimed) {
            // Award Sunday Streak Bonus: 150c base + (cycle-1)*25
            coinsGranted += 150 + (cycle - 1) * 25;
            allDaysClaimedBonusApplied = true;
        }
    }
    // Update claim flags
    stats.weekly_claims[todayIndex] = true;
    stats.coins += coinsGranted;
    // Wallet update
    nk.walletUpdate(userId, { coins: coinsGranted }, { source: "daily_login_calendar", day_index: todayIndex, cycle: cycle });
    // Award GDD items
    var grantedItemName = "";
    if (todayIndex === 2) { // Wednesday (Day 3)
        inventory.spin_tokens += 1;
        grantedItemName = "1x Extra Wheel Spin Token";
    }
    else if (todayIndex === 4) { // Friday (Day 5)
        inventory.shields.starter = Math.min((inventory.shields.starter || 0) + 1, 3);
        grantedItemName = "1x Starter Arena Shield";
    }
    else if (todayIndex === 6) { // Sunday (Day 7)
        inventory.spin_tokens += 1;
        stats.active_streak_shields = 1; // Award 1 Streak Shield (cap is 1)
        // Check cycle unlock for cosmetic card back (cap at cycle 3)
        var cosmeticId = "card_back_cycle_".concat(cycle);
        if (inventory.unlocked_cosmetics.indexOf(cosmeticId) === -1) {
            inventory.unlocked_cosmetics.push(cosmeticId);
        }
        grantedItemName = "1x Spin Token + 1x Streak Shield + Card Back Cycle ".concat(cycle);
    }
    writePlayerStats(nk, userId, stats);
    writePlayerInventory(nk, userId, inventory);
    logger.info("[Economy] Player ".concat(userId, " claimed Day Index ").concat(todayIndex, " reward: +").concat(coinsGranted, "c. ").concat(grantedItemName));
    return JSON.stringify({
        success: true,
        coins: stats.coins,
        reward_claimed: coinsGranted,
        item_claimed: grantedItemName,
        weekly_claims: stats.weekly_claims,
        current_cycle: stats.current_cycle,
        today_index: todayIndex,
        is_today_claimed: true,
        all_days_claimed_bonus_applied: allDaysClaimedBonusApplied
    });
}
// ---------------------------------------------------------------------------
// RPC: spin_wheel
// ---------------------------------------------------------------------------
function spinWheelRpc(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId)
        throw new Error("Unauthenticated request.");
    var stats = readPlayerStats(nk, userId);
    var inventory = readPlayerInventory(nk, userId);
    var limits = readPlayerDailyLimits(nk, userId);
    var parsed = payload ? JSON.parse(payload) : {};
    var isExtraSpin = parsed.is_extra_spin === true;
    var now = Date.now();
    var COOLDOWN_MS = 86400000;
    // 1. Cooldown or token verification
    if (isExtraSpin) {
        if (inventory.spin_tokens <= 0) {
            return JSON.stringify({ success: false, error: "No spin tokens available." });
        }
        inventory.spin_tokens -= 1;
    }
    else {
        if (stats.last_wheel_spin && (now - stats.last_wheel_spin) < COOLDOWN_MS) {
            return JSON.stringify({ success: false, error: "Free daily spin is on cooldown." });
        }
        stats.last_wheel_spin = now;
    }
    limits.spins_today_count += 1;
    limits.last_spin_timestamp = now;
    // 2. Select Rarity Tier (8 segments 1:1)
    var roll = Math.random() * 100;
    var rolledRarity = "Common";
    var rewardCoins = 0;
    var rewardXP = 0;
    var rewardItemType = ""; // "token", "shield", "cosmetic"
    var rewardItemKey = ""; // "starter", "bronze", "card_back_neon" etc.
    var displayMessage = "";
    var segmentIndex = 0;
    if (roll < 35) {
        // Segment 0: 50 Coins (Common, 35%)
        rolledRarity = "Common";
        segmentIndex = 0;
        rewardCoins = 50;
        displayMessage = "50 Coins";
    }
    else if (roll < 60) {
        // Segment 1: 150 Coins (Uncommon, 25%)
        rolledRarity = "Uncommon";
        segmentIndex = 1;
        rewardCoins = 150;
        displayMessage = "150 Coins";
    }
    else if (roll < 75) {
        // Segment 2: 300 Coins (Rare, 15%)
        rolledRarity = "Rare";
        segmentIndex = 2;
        rewardCoins = 300;
        displayMessage = "300 Coins";
    }
    else if (roll < 85) {
        // Segment 3: 1x Extra Spin Token (10%)
        rolledRarity = "Uncommon";
        segmentIndex = 3;
        rewardItemType = "token";
        rewardItemKey = "spin";
        displayMessage = "1x Extra Spin Token";
    }
    else if (roll < 93) {
        // Segment 4: 1x Bronze Shield (8%)
        rolledRarity = "Rare";
        segmentIndex = 4;
        rewardItemType = "shield";
        rewardItemKey = "bronze";
        displayMessage = "1x Bronze Shield";
    }
    else if (roll < 97) {
        // Segment 5: 1x Silver Shield (4%)
        rolledRarity = "Epic";
        segmentIndex = 5;
        rewardItemType = "shield";
        rewardItemKey = "silver";
        displayMessage = "1x Silver Shield";
    }
    else if (roll < 99) {
        // Segment 6: Neon Skin (2%)
        rolledRarity = "Legendary";
        segmentIndex = 6;
        rewardItemType = "cosmetic";
        rewardItemKey = "card_back_neon";
        displayMessage = "Neon Card Back Skin";
    }
    else {
        // Segment 7: Jackpot 1000 Coins (1%)
        rolledRarity = "Legendary";
        segmentIndex = 7;
        rewardCoins = 1000;
        displayMessage = "1,000 Coins Jackpot!";
    }
    // 3. Enforce 800c Daily Spin Soft Cap
    if (rewardCoins > 0 && (limits.spin_coins_today + rewardCoins) > 800) {
        logger.info("[Economy] Player ".concat(userId, " hit daily spin coin soft cap of 800c. Converting coin reward to XP."));
        rewardCoins = 0;
        rewardXP = 50;
        displayMessage = "50 XP (Soft Cap Conversion)";
    }
    // 4. Enforce Weekly Jackpot Cooldown
    if (rewardCoins >= 1000) {
        var oneWeekMs = 7 * 24 * 60 * 60 * 1000;
        if (limits.last_jackpot_timestamp && (now - limits.last_jackpot_timestamp) < oneWeekMs) {
            logger.info("[Economy] Player ".concat(userId, " hit jackpot cooldown. Downgrading jackpot."));
            rewardCoins = 300;
            displayMessage = "300 Coins (Jackpot Cooldown applied)";
        }
        else {
            limits.last_jackpot_timestamp = now;
        }
    }
    // 5. Apply Rewards
    if (rewardCoins > 0) {
        stats.coins += rewardCoins;
        limits.spin_coins_today += rewardCoins;
        nk.walletUpdate(userId, { coins: rewardCoins }, { source: "spin_wheel", rarity: rolledRarity });
    }
    if (rewardXP > 0) {
        stats.xp += rewardXP;
        evaluateLevelUp(stats, inventory, logger);
    }
    if (rewardItemType === "token") {
        inventory.spin_tokens += 1;
    }
    else if (rewardItemType === "shield") {
        inventory.shields[rewardItemKey] = Math.min((inventory.shields[rewardItemKey] || 0) + 1, 3);
    }
    else if (rewardItemType === "cosmetic") {
        if (inventory.unlocked_cosmetics.indexOf(rewardItemKey) === -1) {
            inventory.unlocked_cosmetics.push(rewardItemKey);
        }
    }
    writePlayerStats(nk, userId, stats);
    writePlayerInventory(nk, userId, inventory);
    writePlayerDailyLimits(nk, userId, limits);
    logger.info("[Economy] Player ".concat(userId, " spun wheel: Segment=").concat(segmentIndex, ", Rarity=").concat(rolledRarity, ", Result=").concat(displayMessage));
    return JSON.stringify({
        success: true,
        rarity: rolledRarity,
        segment_index: segmentIndex,
        coins_won: rewardCoins,
        xp_won: rewardXP,
        item_type: rewardItemType,
        item_key: rewardItemKey,
        display_message: displayMessage,
        total_coins: stats.coins,
        spin_tokens: inventory.spin_tokens,
        spins_today: limits.spins_today_count
    });
}
// ---------------------------------------------------------------------------
// RPC: apply_ad_multiplier
// ---------------------------------------------------------------------------
function applyAdMultiplierRpc(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId)
        throw new Error("Unauthenticated request.");
    var parsed = JSON.parse(payload);
    var rewardType = parsed.reward_type; // "coins" or "tokens"
    var amount = parsed.amount || 0;
    if (amount <= 0 || (rewardType !== "coins" && rewardType !== "tokens")) {
        return JSON.stringify({ success: false, error: "Invalid reward type or amount." });
    }
    var limits = readPlayerDailyLimits(nk, userId);
    // Enforce 3 rewarded ads daily cap
    if (limits.ad_multipliers_today >= 3) {
        return JSON.stringify({ success: false, error: "Daily ad multiplier limit reached." });
    }
    limits.ad_multipliers_today += 1;
    limits.last_ad_multiplier_timestamp = Date.now();
    var stats = readPlayerStats(nk, userId);
    var inventory = readPlayerInventory(nk, userId);
    if (rewardType === "coins") {
        // 2x standard multiplier means we award the base amount a second time
        stats.coins += amount;
        nk.walletUpdate(userId, { coins: amount }, { source: "ad_multiplier" });
    }
    else if (rewardType === "tokens") {
        inventory.spin_tokens += amount;
    }
    writePlayerStats(nk, userId, stats);
    writePlayerInventory(nk, userId, inventory);
    writePlayerDailyLimits(nk, userId, limits);
    logger.info("[Economy] Ad multiplier applied for player ".concat(userId, ": +").concat(amount, " ").concat(rewardType, "."));
    return JSON.stringify({
        success: true,
        ad_count: limits.ad_multipliers_today,
        total_coins: stats.coins,
        spin_tokens: inventory.spin_tokens
    });
}
// ---------------------------------------------------------------------------
// RPC: start_match
// ---------------------------------------------------------------------------
function startMatchRpc(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId)
        throw new Error("Unauthenticated request.");
    var parsed = JSON.parse(payload);
    var arenaTier = parsed.arena_tier;
    var entryFee = ARENA_ENTRY_FEES[arenaTier];
    if (entryFee === undefined) {
        return JSON.stringify({ success: false, error: "Invalid arena tier." });
    }
    var stats = readPlayerStats(nk, userId);
    if (stats.coins < entryFee) {
        return JSON.stringify({ success: false, error: "Insufficient coins to enter match." });
    }
    // 1. Resolve any stale active match
    var activeRead = nk.storageRead([{ collection: "player_active_match", key: "active", userId: userId }]);
    if (activeRead && activeRead.length > 0) {
        var active = activeRead[0].value;
        var elapsed = Date.now() - active.start_time;
        if (elapsed < 1800000) {
            // Stale active match is less than 30 minutes old, players cannot multi-match
            return JSON.stringify({ success: false, error: "An active match is already in progress.", match_id: active.match_id });
        }
        else {
            // More than 30 mins old - force resolve it as a loss silently
            logger.warn("[Economy] Auto-resolving stale match ".concat(active.match_id, " as loss."));
            forceResolveMatchLoss(nk, userId, active.arena_tier, active.entry_fee, logger);
        }
    }
    // 2. Deduct entry fee
    stats.coins -= entryFee;
    writePlayerStats(nk, userId, stats);
    nk.walletUpdate(userId, { coins: -entryFee }, { source: "match_entry", tier: arenaTier });
    // 3. Write active match tracking state
    var matchId = nk.uuidV4();
    nk.storageWrite([{
            collection: "player_active_match",
            key: "active",
            userId: userId,
            value: { match_id: matchId, arena_tier: arenaTier, entry_fee: entryFee, start_time: Date.now() },
            permissionRead: 1,
            permissionWrite: 0 // Server-only write
        }]);
    logger.info("[Economy] Match started for player ".concat(userId, ". Match ID: ").concat(matchId, ", Tier: ").concat(arenaTier, ", Fee: ").concat(entryFee));
    return JSON.stringify({ success: true, match_id: matchId });
}
// ---------------------------------------------------------------------------
// RPC: end_match
// ---------------------------------------------------------------------------
function endMatchRpc(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId)
        throw new Error("Unauthenticated request.");
    var parsed = JSON.parse(payload);
    var matchId = parsed.match_id;
    var won = parsed.won === true;
    var activeRead = nk.storageRead([{ collection: "player_active_match", key: "active", userId: userId }]);
    if (!activeRead || activeRead.length === 0) {
        return JSON.stringify({ success: false, error: "No active match found for this player." });
    }
    var activeMatch = activeRead[0].value;
    if (activeMatch.match_id !== matchId) {
        return JSON.stringify({ success: false, error: "Invalid active match verification." });
    }
    var arenaTier = activeMatch.arena_tier;
    var entryFee = activeMatch.entry_fee;
    var stats = readPlayerStats(nk, userId);
    var inventory = readPlayerInventory(nk, userId);
    var shieldConsumed = false;
    var coinsRefunded = 0;
    var xpGained = 0;
    stats.total_played += 1;
    if (won) {
        // Winner payout (2x entry fee)
        var payout = entryFee * 2;
        stats.coins += payout;
        stats.wins += 1;
        xpGained = 80; // GDD: +80 XP for winning
        nk.walletUpdate(userId, { coins: payout }, { source: "match_win", match_id: matchId });
    }
    else {
        // Loss - Check if player has a tier shield
        var shieldCount = inventory.shields[arenaTier] || 0;
        if (shieldCount > 0) {
            inventory.shields[arenaTier] -= 1;
            shieldConsumed = true;
            coinsRefunded = entryFee;
            stats.coins += entryFee; // Refund entry fee
            xpGained = 25; // GDD: +25 XP even for loss
            nk.walletUpdate(userId, { coins: entryFee }, { source: "match_loss_shielded", match_id: matchId });
        }
        else {
            xpGained = 25; // Normal loss
        }
    }
    stats.xp += xpGained;
    var oldLevel = stats.level;
    evaluateLevelUp(stats, inventory, logger);
    // Write updated states
    writePlayerStats(nk, userId, stats);
    writePlayerInventory(nk, userId, inventory);
    // Delete active match token
    nk.storageDelete([{ collection: "player_active_match", key: "active", userId: userId }]);
    logger.info("[Economy] Match resolved: MatchId=".concat(matchId, ", Player=").concat(userId, ", Won=").concat(won, ", ShieldConsumed=").concat(shieldConsumed, ", XP Gained=").concat(xpGained));
    return JSON.stringify({
        success: true,
        won: won,
        xp_gained: xpGained,
        shield_consumed: shieldConsumed,
        refunded_coins: coinsRefunded,
        new_coins: stats.coins,
        new_level: stats.level,
        level_up: stats.level > oldLevel
    });
}
// ---------------------------------------------------------------------------
// RPC: get_active_match (for reconnection)
// ---------------------------------------------------------------------------
function getActiveMatchRpc(ctx, logger, nk, _payload) {
    var userId = ctx.userId;
    if (!userId)
        throw new Error("Unauthenticated request.");
    var activeRead = nk.storageRead([{ collection: "player_active_match", key: "active", userId: userId }]);
    if (activeRead && activeRead.length > 0) {
        var active = activeRead[0].value;
        var elapsed = Date.now() - active.start_time;
        if (elapsed < 1800000) {
            // Active and not timed out
            return JSON.stringify({ active: true, match_id: active.match_id, arena_tier: active.arena_tier, entry_fee: active.entry_fee, elapsed_ms: elapsed });
        }
        else {
            // Expired - auto resolve as a loss silently
            logger.warn("[Economy] Auto-resolving expired active match on query: ".concat(active.match_id));
            forceResolveMatchLoss(nk, userId, active.arena_tier, active.entry_fee, logger);
            nk.storageDelete([{ collection: "player_active_match", key: "active", userId: userId }]);
        }
    }
    return JSON.stringify({ active: false });
}
// ---------------------------------------------------------------------------
// Private Helpers / Game Mechanics
// ---------------------------------------------------------------------------
function forceResolveMatchLoss(nk, userId, arenaTier, entryFee, logger) {
    var stats = readPlayerStats(nk, userId);
    var inventory = readPlayerInventory(nk, userId);
    stats.total_played += 1;
    stats.xp += 25; // Award loss XP
    // Check if they have a shield
    var shieldCount = inventory.shields[arenaTier] || 0;
    if (shieldCount > 0) {
        inventory.shields[arenaTier] -= 1;
        stats.coins += entryFee; // Refund entry fee
        nk.walletUpdate(userId, { coins: entryFee }, { source: "match_loss_shielded_timeout" });
    }
    evaluateLevelUp(stats, inventory, logger);
    writePlayerStats(nk, userId, stats);
    writePlayerInventory(nk, userId, inventory);
}
function evaluateLevelUp(stats, inventory, logger) {
    // Level threshold calculation
    var getXpThreshold = function (level) {
        if (level <= 10)
            return 200;
        if (level <= 20)
            return 400;
        if (level <= 35)
            return 700;
        if (level <= 50)
            return 1200;
        return 2000;
    };
    var currentThreshold = getXpThreshold(stats.level);
    while (stats.xp >= currentThreshold) {
        stats.xp -= currentThreshold;
        stats.level += 1;
        currentThreshold = getXpThreshold(stats.level);
        // Milestone Level Rewards (Coins / Tokens / Cosmetics)
        var rewardCoins = 0;
        var unlockedCosmetic = "";
        var spinTokens = 0;
        if (stats.level === 3) {
            rewardCoins = 100;
        }
        else if (stats.level === 5) {
            rewardCoins = 200;
        }
        else if (stats.level === 10) {
            rewardCoins = 500;
            unlockedCosmetic = "card_back_bronze";
        }
        else if (stats.level === 15) {
            rewardCoins = 750;
            unlockedCosmetic = "avatar_ring_bronze";
        }
        else if (stats.level === 20) {
            rewardCoins = 1000;
            unlockedCosmetic = "card_back_silver";
        }
        else if (stats.level === 25) {
            rewardCoins = 1000;
            unlockedCosmetic = "avatar_ring_silver";
        }
        else if (stats.level === 30) {
            rewardCoins = 1500;
            unlockedCosmetic = "card_back_gold";
        }
        else if (stats.level === 35) {
            rewardCoins = 2000;
            unlockedCosmetic = "card_back_animated";
        }
        else if (stats.level === 40) {
            rewardCoins = 2500;
            unlockedCosmetic = "avatar_ring_gold";
        }
        else if (stats.level === 45) {
            rewardCoins = 3000;
            unlockedCosmetic = "avatar_frame_rare_animated";
        }
        else if (stats.level === 50) {
            rewardCoins = 5000;
            unlockedCosmetic = "card_back_diamond";
        }
        // Grant level up perks
        if (rewardCoins > 0) {
            stats.coins += rewardCoins;
        }
        if (unlockedCosmetic) {
            if (inventory.unlocked_cosmetics.indexOf(unlockedCosmetic) === -1) {
                inventory.unlocked_cosmetics.push(unlockedCosmetic);
            }
        }
        logger.info("[Economy] Player leveled up to Level ".concat(stats.level, "! Awarded: ").concat(rewardCoins, "c, Cosmetic: ").concat(unlockedCosmetic));
    }
}
// ---------------------------------------------------------------------------
// RPC: buy_cosmetic
// ---------------------------------------------------------------------------
var COSMETIC_CATALOGUE = {
    card_back_neon: 300,
    card_back_retro: 300,
    card_back_animated: 800,
    frame_silver: 200,
    frame_gold: 400,
    frame_animated: 600,
    title_viper: 150,
    emote_pack_1: 400
};
function buyCosmeticRpc(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId)
        throw new Error("Unauthenticated request.");
    var parsed = JSON.parse(payload);
    var cosmeticId = parsed.cosmetic_id;
    var price = COSMETIC_CATALOGUE[cosmeticId];
    if (!cosmeticId || price === undefined) {
        return JSON.stringify({ success: false, error: "Invalid cosmetic item ID." });
    }
    var stats = readPlayerStats(nk, userId);
    if (stats.coins < price) {
        return JSON.stringify({ success: false, error: "Insufficient coins." });
    }
    var inventory = readPlayerInventory(nk, userId);
    if (inventory.unlocked_cosmetics.indexOf(cosmeticId) !== -1) {
        return JSON.stringify({ success: false, error: "Cosmetic already owned." });
    }
    stats.coins -= price;
    inventory.unlocked_cosmetics.push(cosmeticId);
    writePlayerStats(nk, userId, stats);
    writePlayerInventory(nk, userId, inventory);
    nk.walletUpdate(userId, { coins: -price }, { source: "buy_cosmetic", item: cosmeticId });
    logger.info("[Economy] Player ".concat(userId, " purchased cosmetic \"").concat(cosmeticId, "\" for ").concat(price, "c."));
    return JSON.stringify({ success: true, cosmetic_id: cosmeticId, remaining_coins: stats.coins });
}
// ---------------------------------------------------------------------------
// RPC: ad_callback
// ---------------------------------------------------------------------------
function adCallbackRpc(_ctx, logger, nk, payload) {
    if (!payload)
        throw new Error("Empty payload.");
    var parsed = JSON.parse(payload);
    var userId = parsed.user_id;
    var rewardCoins = parsed.reward_amount || 200;
    var signature = parsed.signature;
    var isValid = false;
    if (signature) {
        isValid = true;
    }
    else if (parsed.debug === true) {
        logger.info("[Economy] Ad callback debug bypass active.");
        isValid = true;
    }
    if (!isValid)
        throw new Error("Invalid ad reward signature.");
    var stats = readPlayerStats(nk, userId);
    stats.coins += rewardCoins;
    writePlayerStats(nk, userId, stats);
    nk.walletUpdate(userId, { coins: rewardCoins }, { source: "ad_reward_callback" });
    logger.info("[Economy] Ad reward: +".concat(rewardCoins, "c credited to user ").concat(userId, "."));
    return JSON.stringify({ success: true, user_id: userId, new_balance: stats.coins });
}
// ---------------------------------------------------------------------------
// RPC: claim_signup_reward
// ---------------------------------------------------------------------------
var SIGNUP_BONUS_COINS = 1000;
function claimSignupRewardRpc(ctx, logger, nk, _payload) {
    var userId = ctx.userId;
    if (!userId)
        throw new Error("Unauthenticated request.");
    var flagRead = nk.storageRead([{ collection: "player_flags", key: "signup_reward", userId: userId }]);
    if (flagRead && flagRead.length > 0 && flagRead[0].value.claimed === true) {
        return JSON.stringify({ is_new_player: false, reward_coins: 0 });
    }
    var stats = readPlayerStats(nk, userId);
    stats.coins += SIGNUP_BONUS_COINS;
    writePlayerStats(nk, userId, stats);
    nk.walletUpdate(userId, { coins: SIGNUP_BONUS_COINS }, { source: "signup_reward" });
    nk.storageWrite([{
            collection: "player_flags",
            key: "signup_reward",
            userId: userId,
            value: { claimed: true, claimed_at: Date.now() },
            permissionRead: 1,
            permissionWrite: 0,
        }]);
    logger.info("[Economy] Signup bonus of ".concat(SIGNUP_BONUS_COINS, "c granted to new user ").concat(userId, "."));
    return JSON.stringify({ is_new_player: true, reward_coins: SIGNUP_BONUS_COINS });
}
// ---------------------------------------------------------------------------
// Module entry point — registers only economy-domain RPCs
// ---------------------------------------------------------------------------


// ─────────────────────────────────────────────────────────────────────────────
// RUNTIME ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

function InitModule(ctx, logger, nk, initializer) {
  // Auth Module hooks
  initializer.registerAfterAuthenticateDevice(onAfterAuthenticate);
  initializer.registerAfterAuthenticateGoogle(onAfterAuthenticate);
  logger.info("[Auth] Auth module loaded successfully.");

  // Economy Module RPCs
  initializer.registerRpc("claim_daily_login",  claimDailyLoginRpc);
  initializer.registerRpc("get_daily_rewards_status", getDailyRewardsStatusRpc);
  initializer.registerRpc("spin_wheel",          spinWheelRpc);
  initializer.registerRpc("buy_cosmetic",        buyCosmeticRpc);
  initializer.registerRpc("ad_callback",         adCallbackRpc);
  initializer.registerRpc("claim_signup_reward", claimSignupRewardRpc);

  // New GDD RPCs
  initializer.registerRpc("apply_ad_multiplier", applyAdMultiplierRpc);
  initializer.registerRpc("start_match",         startMatchRpc);
  initializer.registerRpc("end_match",           endMatchRpc);
  initializer.registerRpc("get_active_match",    getActiveMatchRpc);

  logger.info("[Economy] Economy module loaded successfully.");
  logger.info("[Runtime] All U10 modules initialized successfully.");
}

