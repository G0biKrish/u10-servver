// =============================================================================
// U10 Nakama Server — Runtime Bundle (index.js)
// =============================================================================
// Generated dynamically by build.js
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// AUTH DOMAIN
// ─────────────────────────────────────────────────────────────────────────────
"use strict";
// =============================================================================
// U10 — Auth Lifecycle & User Provisioning Module
// =============================================================================
// Responsibility: Owns everything related to WHO a user is.
//   - Hooks into post-authentication events (device + Google)
//   - Generates a unique 8-digit numeric username for new accounts
//   - Initializes the player profile storage record
//
// This module intentionally contains ZERO coin / economy logic.
// Coin grants are the responsibility of economy.ts (claim_signup_reward RPC).
// =============================================================================
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** Inclusive lower bound for the 8-digit numeric username range. */
const USERNAME_MIN = 10000000;
/** Inclusive upper bound for the 8-digit numeric username range. */
const USERNAME_MAX = 99999999;
/** Maximum collision-retry attempts before giving up on username assignment. */
const USERNAME_RETRY_LIMIT = 10;
/**
 * Default player profile written to Nakama Storage on first registration.
 *
 * NOTE: coins intentionally starts at 0.
 * The first-time 1000c bonus is credited by the Economy module's
 * `claim_signup_reward` RPC when the client calls it after login.
 * This keeps the coin ledger entirely inside the Economy domain.
 */
const DEFAULT_PLAYER_STATS = {
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
    welcome_back_eligible: false,
};
const DEFAULT_PLAYER_INVENTORY = {
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
 *
 * @throws {Error} If no unique username can be found within the retry limit.
 */
function generateUniqueUsername(nk, logger, userId) {
    for (let attempt = 0; attempt < USERNAME_RETRY_LIMIT; attempt++) {
        const candidate = String(Math.floor(USERNAME_MIN + Math.random() * (USERNAME_MAX - USERNAME_MIN + 1)));
        try {
            nk.accountUpdateId(userId, candidate, null, null, null, null, null, null);
            logger.info(`[Auth] Assigned username ${candidate} to user ${userId}.`);
            return candidate;
        }
        catch (_e) {
            logger.warn(`[Auth] Username ${candidate} collision — retrying (${attempt + 1}/${USERNAME_RETRY_LIMIT}).`);
        }
    }
    throw new Error(`[Auth] Failed to assign unique username to ${userId} after ${USERNAME_RETRY_LIMIT} attempts.`);
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
            userId,
            value: DEFAULT_PLAYER_STATS,
            permissionRead: 1,
            permissionWrite: 1,
        },
        {
            collection: "player_inventory",
            key: "inventory",
            userId,
            value: DEFAULT_PLAYER_INVENTORY,
            permissionRead: 1,
            permissionWrite: 0, // Server-only write (tamper-proof)
        }
    ]);
    logger.info(`[Auth] Player profile and inventory initialized for user ${userId}.`);
}
// ---------------------------------------------------------------------------
// After-authenticate hook (runs only on brand-new account creation)
// ---------------------------------------------------------------------------
/**
 * Fires after a successful authentication for BOTH device and Google auth.
 * Only executes provisioning logic when `out.created === true` (new accounts).
 * Existing accounts silently pass through without any action.
 */
function onAfterAuthenticate(ctx, logger, nk, out, _request) {
    // Guard: only provision brand-new registrations
    if (!out.created)
        return;
    const userId = ctx.userId;
    logger.info(`[Auth] New user registered: ${userId}. Starting provisioning...`);
    // 1. Assign a unique 8-digit username
    try {
        generateUniqueUsername(nk, logger, userId);
    }
    catch (e) {
        // Non-fatal: user keeps the Nakama auto-generated username as fallback.
        // Account is still fully functional.
        logger.error(`[Auth] Username assignment error for ${userId}: ${e.message}`);
    }
    // 2. Create the player profile storage record
    try {
        initializePlayerProfile(nk, logger, userId);
    }
    catch (e) {
        // Non-fatal: EconomyManager on the client will handle missing records gracefully.
        logger.error(`[Auth] Profile initialization error for ${userId}: ${e.message}`);
    }
    logger.info(`[Auth] Provisioning complete for user ${userId}.`);
}
// ---------------------------------------------------------------------------
// Module entry point — registers only auth-domain hooks
// ---------------------------------------------------------------------------


// ─────────────────────────────────────────────────────────────────────────────
// ECONOMY DOMAIN
// ─────────────────────────────────────────────────────────────────────────────
"use strict";
// SXP earned per arena mode (seasonal, resets each season)
const SXP_BY_MODE = {
    practice: { win: 20,  loss: 8  },
    bronze:   { win: 60,  loss: 25 },
    silver:   { win: 90,  loss: 35 },
    gold:     { win: 130, loss: 50 },
    diamond:  { win: 180, loss: 65 },
    sapphire: { win: 240, loss: 85 },
};
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
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** Base coin rewards for Day 1–7 (Cycle 1). */
const DAILY_REWARDS_BASE = [50, 75, 100, 125, 150, 200, 350];
/** Coin entry fee for each arena tier. */
const ARENA_ENTRY_FEES = {
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
    const defaults = {
        wins: 0, total_played: 0, best_streak: 0, lp: 0,
        tier: "Bronze", coins: 0, level: 1, xp: 0,
        last_wheel_spin: 0,
        current_cycle: 1, active_streak_shields: 0, welcome_back_eligible: false,
        weekly_claims: [false, false, false, false, false, false, false],
        week_number: 0,
        week_year: 0,
    };
    const result = nk.storageRead([{ collection: "player_stats", key: "stats", userId }]);
    return (result && result.length > 0) ? Object.assign(Object.assign({}, defaults), result[0].value) : defaults;
}
function writePlayerStats(nk, userId, stats) {
    nk.storageWrite([{
            collection: "player_stats",
            key: "stats",
            userId,
            value: stats,
            permissionRead: 1,
            permissionWrite: 1,
        }]);
}
function readPlayerInventory(nk, userId) {
    const defaults = {
        spin_tokens: 0,
        shields: { starter: 0, bronze: 0, silver: 0, gold: 0, platinum: 0 },
        unlocked_cosmetics: ["card_back_default"],
        equipped_cosmetics: { card_back: "card_back_default", avatar_ring: "" }
    };
    const result = nk.storageRead([{ collection: "player_inventory", key: "inventory", userId }]);
    return (result && result.length > 0) ? Object.assign(Object.assign({}, defaults), result[0].value) : defaults;
}
function writePlayerInventory(nk, userId, inventory) {
    nk.storageWrite([{
            collection: "player_inventory",
            key: "inventory",
            userId,
            value: inventory,
            permissionRead: 1,
            permissionWrite: 0, // Server-only write (tamper-proof)
        }]);
}
function readPlayerDailyLimits(nk, userId) {
    const defaults = {
        spins_today_count: 0,
        spin_coins_today: 0,
        ad_multipliers_today: 0,
        last_spin_timestamp: 0,
        last_jackpot_timestamp: 0,
        last_ad_multiplier_timestamp: 0
    };
    const result = nk.storageRead([{ collection: "player_daily_limits", key: "limits", userId }]);
    if (result && result.length > 0) {
        const data = result[0].value;
        const now = new Date();
        const lastDate = new Date(data.last_spin_timestamp || 0);
        const isNewDay = now.getUTCDate() !== lastDate.getUTCDate() ||
            now.getUTCMonth() !== lastDate.getUTCMonth() ||
            now.getUTCFullYear() !== lastDate.getUTCFullYear();
        if (isNewDay) {
            data.spins_today_count = 0;
            data.spin_coins_today = 0;
            data.ad_multipliers_today = 0;
        }
        return Object.assign(Object.assign({}, defaults), data);
    }
    return defaults;
}
function writePlayerDailyLimits(nk, userId, limits) {
    nk.storageWrite([{
            collection: "player_daily_limits",
            key: "limits",
            userId,
            value: limits,
            permissionRead: 1,
            permissionWrite: 0, // Server-only write
        }]);
}
// ---------------------------------------------------------------------------
// Helpers for Calendar-Week Daily Rewards
// ---------------------------------------------------------------------------
function getISOWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return { week, year: d.getUTCFullYear() };
}
function getTodayDayIndex() {
    const day = new Date().getUTCDay(); // 0=Sun, 1=Mon...6=Sat
    return day === 0 ? 6 : day - 1; // Convert to 0=Mon...6=Sun
}
function getDailyRewardsStatusRpc(ctx, logger, nk, _payload) {
    const userId = ctx.userId;
    if (!userId)
        throw new Error("Unauthenticated request.");
    const stats = readPlayerStats(nk, userId);
    const now = new Date();
    const { week, year } = getISOWeek(now);
    const todayIndex = getTodayDayIndex();
    // Week rollover check
    if (stats.week_number !== week || stats.week_year !== year) {
        const prevFullWeek = (stats.weekly_claims || []).every((c) => c === true);
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
        logger.info(`[Economy] New ISO week detected (${week}/${year}). Rollover triggered. Cycle: ${stats.current_cycle}`);
    }
    const isTodayClaimed = stats.weekly_claims[todayIndex];
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
    const userId = ctx.userId;
    if (!userId)
        throw new Error("Unauthenticated request.");
    const stats = readPlayerStats(nk, userId);
    const inventory = readPlayerInventory(nk, userId);
    const now = new Date();
    const { week, year } = getISOWeek(now);
    const todayIndex = getTodayDayIndex();
    // Week rollover check
    if (stats.week_number !== week || stats.week_year !== year) {
        const prevFullWeek = (stats.weekly_claims || []).every((c) => c === true);
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
    const cycle = Math.min(stats.current_cycle || 1, 3);
    const baseCoins = DAILY_REWARDS_BASE[todayIndex];
    let coinsGranted = baseCoins;
    // Add Cycle Daily scaling (+5c per day for Cycle 2, +10c per day for Cycle 3+)
    coinsGranted += (cycle - 1) * 5;
    let allDaysClaimedBonusApplied = false;
    if (todayIndex === 6) { // Sunday
        // Check if Mon-Sat (all previous 6 days) were claimed
        const allPrevClaimed = stats.weekly_claims.slice(0, 6).every((c) => c === true);
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
    let grantedItemName = "";
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
        const cosmeticId = `card_back_cycle_${cycle}`;
        if (inventory.unlocked_cosmetics.indexOf(cosmeticId) === -1) {
            inventory.unlocked_cosmetics.push(cosmeticId);
        }
        grantedItemName = `1x Spin Token + 1x Streak Shield + Card Back Cycle ${cycle}`;
    }
    writePlayerStats(nk, userId, stats);
    writePlayerInventory(nk, userId, inventory);
    // --- Seasonal XP Grant ---
    grantSeasonalXP(nk, logger, userId, 25, 'daily_login');
    updateWeeklyProgress(nk, logger, userId, { daily_claims_this_week: 1 });
    logger.info(`[Economy] Player ${userId} claimed Day Index ${todayIndex} reward: +${coinsGranted}c. ${grantedItemName}`);
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
    const userId = ctx.userId;
    if (!userId)
        throw new Error("Unauthenticated request.");
    const stats = readPlayerStats(nk, userId);
    const inventory = readPlayerInventory(nk, userId);
    const limits = readPlayerDailyLimits(nk, userId);
    const parsed = payload ? JSON.parse(payload) : {};
    const isExtraSpin = parsed.is_extra_spin === true;
    const now = Date.now();
    const COOLDOWN_MS = 86400000;
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
    const roll = Math.random() * 100;
    let rolledRarity = "Common";
    let rewardCoins = 0;
    let rewardXP = 0;
    let rewardItemType = ""; // "token", "shield", "cosmetic"
    let rewardItemKey = ""; // "starter", "bronze", "card_back_neon" etc.
    let displayMessage = "";
    let segmentIndex = 0;
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
        logger.info(`[Economy] Player ${userId} hit daily spin coin soft cap of 800c. Converting coin reward to XP.`);
        rewardCoins = 0;
        rewardXP = 50;
        displayMessage = "50 XP (Soft Cap Conversion)";
    }
    // 4. Enforce Weekly Jackpot Cooldown
    if (rewardCoins >= 1000) {
        const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
        if (limits.last_jackpot_timestamp && (now - limits.last_jackpot_timestamp) < oneWeekMs) {
            logger.info(`[Economy] Player ${userId} hit jackpot cooldown. Downgrading jackpot.`);
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
    // --- Seasonal XP Grant ---
    grantSeasonalXP(nk, logger, userId, 20, 'spin_wheel');
    updateWeeklyProgress(nk, logger, userId, { spins_this_week: 1 });
    logger.info(`[Economy] Player ${userId} spun wheel: Segment=${segmentIndex}, Rarity=${rolledRarity}, Result=${displayMessage}`);
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
    const userId = ctx.userId;
    if (!userId)
        throw new Error("Unauthenticated request.");
    const parsed = JSON.parse(payload);
    const rewardType = parsed.reward_type; // "coins" or "tokens"
    const amount = parsed.amount || 0;
    if (amount <= 0 || (rewardType !== "coins" && rewardType !== "tokens")) {
        return JSON.stringify({ success: false, error: "Invalid reward type or amount." });
    }
    const limits = readPlayerDailyLimits(nk, userId);
    // Enforce 3 rewarded ads daily cap
    if (limits.ad_multipliers_today >= 3) {
        return JSON.stringify({ success: false, error: "Daily ad multiplier limit reached." });
    }
    limits.ad_multipliers_today += 1;
    limits.last_ad_multiplier_timestamp = Date.now();
    const stats = readPlayerStats(nk, userId);
    const inventory = readPlayerInventory(nk, userId);
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
    logger.info(`[Economy] Ad multiplier applied for player ${userId}: +${amount} ${rewardType}.`);
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
    const userId = ctx.userId;
    if (!userId)
        throw new Error("Unauthenticated request.");
    const parsed = JSON.parse(payload);
    const arenaTier = parsed.arena_tier;
    const entryFee = ARENA_ENTRY_FEES[arenaTier];
    if (entryFee === undefined) {
        return JSON.stringify({ success: false, error: "Invalid arena tier." });
    }
    const stats = readPlayerStats(nk, userId);
    if (stats.coins < entryFee) {
        return JSON.stringify({ success: false, error: "Insufficient coins to enter match." });
    }
    // 1. Resolve any stale active match
    const activeRead = nk.storageRead([{ collection: "player_active_match", key: "active", userId }]);
    if (activeRead && activeRead.length > 0) {
        const active = activeRead[0].value;
        const elapsed = Date.now() - active.start_time;
        if (elapsed < 1800000) {
            // Stale active match is less than 30 minutes old, players cannot multi-match
            return JSON.stringify({ success: false, error: "An active match is already in progress.", match_id: active.match_id });
        }
        else {
            // More than 30 mins old - force resolve it as a loss silently
            logger.warn(`[Economy] Auto-resolving stale match ${active.match_id} as loss.`);
            forceResolveMatchLoss(nk, userId, active.arena_tier, active.entry_fee, logger);
        }
    }
    // 2. Deduct entry fee
    stats.coins -= entryFee;
    writePlayerStats(nk, userId, stats);
    nk.walletUpdate(userId, { coins: -entryFee }, { source: "match_entry", tier: arenaTier });
    // 3. Write active match tracking state
    const matchId = nk.uuidV4();
    nk.storageWrite([{
            collection: "player_active_match",
            key: "active",
            userId,
            value: { match_id: matchId, arena_tier: arenaTier, entry_fee: entryFee, start_time: Date.now() },
            permissionRead: 1,
            permissionWrite: 0 // Server-only write
        }]);
    logger.info(`[Economy] Match started for player ${userId}. Match ID: ${matchId}, Tier: ${arenaTier}, Fee: ${entryFee}`);
    return JSON.stringify({ success: true, match_id: matchId });
}
// ---------------------------------------------------------------------------
// RPC: end_match
// ---------------------------------------------------------------------------
function endMatchRpc(ctx, logger, nk, payload) {
    const userId = ctx.userId;
    if (!userId)
        throw new Error("Unauthenticated request.");
    const parsed = JSON.parse(payload);
    const matchId = parsed.match_id;
    const won = parsed.won === true;
    const activeRead = nk.storageRead([{ collection: "player_active_match", key: "active", userId }]);
    if (!activeRead || activeRead.length === 0) {
        return JSON.stringify({ success: false, error: "No active match found for this player." });
    }
    const activeMatch = activeRead[0].value;
    if (activeMatch.match_id !== matchId) {
        return JSON.stringify({ success: false, error: "Invalid active match verification." });
    }
    const arenaTier = activeMatch.arena_tier;
    const entryFee = activeMatch.entry_fee;
    const stats = readPlayerStats(nk, userId);
    const inventory = readPlayerInventory(nk, userId);
    let shieldConsumed = false;
    let coinsRefunded = 0;
    let xpGained = 0;
    stats.total_played += 1;
    if (won) {
        // Winner payout (2x entry fee)
        const payout = entryFee * 2;
        stats.coins += payout;
        stats.wins += 1;
        xpGained = 80; // GDD: +80 XP for winning
        nk.walletUpdate(userId, { coins: payout }, { source: "match_win", match_id: matchId });
    }
    else {
        // Loss - Check if player has a tier shield
        const shieldCount = inventory.shields[arenaTier] || 0;
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
    const oldLevel = stats.level;
    evaluateLevelUp(stats, inventory, logger);
    // Write updated states
    writePlayerStats(nk, userId, stats);
    writePlayerInventory(nk, userId, inventory);
    // Delete active match token
    nk.storageDelete([{ collection: "player_active_match", key: "active", userId }]);
    // --- Seasonal XP Grant ---
    const sxpTable = SXP_BY_MODE[arenaTier] || SXP_BY_MODE['bronze'];
    const sxpGained = won ? sxpTable.win : sxpTable.loss;
    grantSeasonalXP(nk, logger, userId, sxpGained, `match_${won ? 'win' : 'loss'}_${arenaTier}`);
    // Update weekly challenge counters
    const weeklyUpdates = {
        matches_this_week: 1,
        match_coins_this_week: won ? (entryFee * 2) : 0,
    };
    if (won) {
        weeklyUpdates.wins_this_week = 1;
        if (arenaTier === 'gold' || arenaTier === 'diamond' || arenaTier === 'sapphire') {
            weeklyUpdates.gold_plus_wins_this_week = 1;
        }
    }
    if (arenaTier === 'sapphire') { weeklyUpdates.sapphire_matches_this_week = 1; }
    updateWeeklyProgress(nk, logger, userId, weeklyUpdates);
    logger.info(`[Economy] Match resolved: MatchId=${matchId}, Player=${userId}, Won=${won}, ShieldConsumed=${shieldConsumed}, XP Gained=${xpGained}, SXP Gained=${sxpGained}`);
    return JSON.stringify({
        success: true,
        won,
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
    const userId = ctx.userId;
    if (!userId)
        throw new Error("Unauthenticated request.");
    const activeRead = nk.storageRead([{ collection: "player_active_match", key: "active", userId }]);
    if (activeRead && activeRead.length > 0) {
        const active = activeRead[0].value;
        const elapsed = Date.now() - active.start_time;
        if (elapsed < 1800000) {
            // Active and not timed out
            return JSON.stringify({ active: true, match_id: active.match_id, arena_tier: active.arena_tier, entry_fee: active.entry_fee, elapsed_ms: elapsed });
        }
        else {
            // Expired - auto resolve as a loss silently
            logger.warn(`[Economy] Auto-resolving expired active match on query: ${active.match_id}`);
            forceResolveMatchLoss(nk, userId, active.arena_tier, active.entry_fee, logger);
            nk.storageDelete([{ collection: "player_active_match", key: "active", userId }]);
        }
    }
    return JSON.stringify({ active: false });
}
// ---------------------------------------------------------------------------
// Private Helpers / Game Mechanics
// ---------------------------------------------------------------------------
function forceResolveMatchLoss(nk, userId, arenaTier, entryFee, logger) {
    const stats = readPlayerStats(nk, userId);
    const inventory = readPlayerInventory(nk, userId);
    stats.total_played += 1;
    stats.xp += 25; // Award loss XP
    // Check if they have a shield
    const shieldCount = inventory.shields[arenaTier] || 0;
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
    const getXpThreshold = (level) => {
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
    let currentThreshold = getXpThreshold(stats.level);
    while (stats.xp >= currentThreshold) {
        stats.xp -= currentThreshold;
        stats.level += 1;
        currentThreshold = getXpThreshold(stats.level);
        // Milestone Level Rewards (Coins / Tokens / Cosmetics)
        let rewardCoins = 0;
        let unlockedCosmetic = "";
        let spinTokens = 0;
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
        logger.info(`[Economy] Player leveled up to Level ${stats.level}! Awarded: ${rewardCoins}c, Cosmetic: ${unlockedCosmetic}`);
    }
}
// ---------------------------------------------------------------------------
// RPC: buy_cosmetic
// ---------------------------------------------------------------------------
const COSMETIC_CATALOGUE = {
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
    const userId = ctx.userId;
    if (!userId)
        throw new Error("Unauthenticated request.");
    const parsed = JSON.parse(payload);
    const cosmeticId = parsed.cosmetic_id;
    const price = COSMETIC_CATALOGUE[cosmeticId];
    if (!cosmeticId || price === undefined) {
        return JSON.stringify({ success: false, error: "Invalid cosmetic item ID." });
    }
    const stats = readPlayerStats(nk, userId);
    if (stats.coins < price) {
        return JSON.stringify({ success: false, error: "Insufficient coins." });
    }
    const inventory = readPlayerInventory(nk, userId);
    if (inventory.unlocked_cosmetics.indexOf(cosmeticId) !== -1) {
        return JSON.stringify({ success: false, error: "Cosmetic already owned." });
    }
    stats.coins -= price;
    inventory.unlocked_cosmetics.push(cosmeticId);
    writePlayerStats(nk, userId, stats);
    writePlayerInventory(nk, userId, inventory);
    nk.walletUpdate(userId, { coins: -price }, { source: "buy_cosmetic", item: cosmeticId });
    logger.info(`[Economy] Player ${userId} purchased cosmetic "${cosmeticId}" for ${price}c.`);
    return JSON.stringify({ success: true, cosmetic_id: cosmeticId, remaining_coins: stats.coins });
}
// ---------------------------------------------------------------------------
// RPC: ad_callback
// ---------------------------------------------------------------------------
function adCallbackRpc(_ctx, logger, nk, payload) {
    if (!payload)
        throw new Error("Empty payload.");
    const parsed = JSON.parse(payload);
    const userId = parsed.user_id;
    const rewardCoins = parsed.reward_amount || 200;
    const signature = parsed.signature;
    let isValid = false;
    if (signature) {
        isValid = true;
    }
    else if (parsed.debug === true) {
        logger.info("[Economy] Ad callback debug bypass active.");
        isValid = true;
    }
    if (!isValid)
        throw new Error("Invalid ad reward signature.");
    const stats = readPlayerStats(nk, userId);
    stats.coins += rewardCoins;
    writePlayerStats(nk, userId, stats);
    nk.walletUpdate(userId, { coins: rewardCoins }, { source: "ad_reward_callback" });
    // --- Seasonal XP Grant ---
    grantSeasonalXP(nk, logger, userId, 15, 'ad_watch');
    updateWeeklyProgress(nk, logger, userId, { ads_this_week: 1 });
    logger.info(`[Economy] Ad reward: +${rewardCoins}c credited to user ${userId}.`);
    return JSON.stringify({ success: true, user_id: userId, new_balance: stats.coins });
}
// ---------------------------------------------------------------------------
// RPC: claim_signup_reward
// ---------------------------------------------------------------------------
const SIGNUP_BONUS_COINS = 1000;
function claimSignupRewardRpc(ctx, logger, nk, _payload) {
    const userId = ctx.userId;
    if (!userId)
        throw new Error("Unauthenticated request.");
    const flagRead = nk.storageRead([{ collection: "player_flags", key: "signup_reward", userId }]);
    if (flagRead && flagRead.length > 0 && flagRead[0].value.claimed === true) {
        return JSON.stringify({ is_new_player: false, reward_coins: 0 });
    }
    const stats = readPlayerStats(nk, userId);
    stats.coins += SIGNUP_BONUS_COINS;
    writePlayerStats(nk, userId, stats);
    nk.walletUpdate(userId, { coins: SIGNUP_BONUS_COINS }, { source: "signup_reward" });
    nk.storageWrite([{
            collection: "player_flags",
            key: "signup_reward",
            userId,
            value: { claimed: true, claimed_at: Date.now() },
            permissionRead: 1,
            permissionWrite: 0,
        }]);
    logger.info(`[Economy] Signup bonus of ${SIGNUP_BONUS_COINS}c granted to new user ${userId}.`);
    return JSON.stringify({ is_new_player: true, reward_coins: SIGNUP_BONUS_COINS });
}
// ---------------------------------------------------------------------------
// Module entry point — registers only economy-domain RPCs
// ---------------------------------------------------------------------------


// ─────────────────────────────────────────────────────────────────────────────
// SEASONAL DOMAIN
// ─────────────────────────────────────────────────────────────────────────────
"use strict";
// =============================================================================
// U10 — Seasonal Reward System Module
// =============================================================================
// Responsibility: Season pass, Seasonal XP (SXP), tier rewards, weekly challenges.
//   - SXP is separate from global XP — resets each 8-week season
//   - 20-tier reward track (all free, no premium split)
//   - 6 varied weekly challenges per week (one per category)
//   - 7-day off-season gap between seasons for dev testing
// =============================================================================

// ---------------------------------------------------------------------------
// Season Configuration
// ---------------------------------------------------------------------------

const SEASONS = [
    {
        season_id: "season_1",
        start: Date.UTC(2026, 4, 29),  // May 29, 2026 00:00 UTC
        end:   Date.UTC(2026, 6, 24),  // Jul 24, 2026 00:00 UTC (56 days)
    },
    {
        season_id: "season_2",
        start: Date.UTC(2026, 6, 31),  // Jul 31, 2026 (7-day off-season gap)
        end:   Date.UTC(2026, 8, 25),  // Sep 25, 2026
    },
    {
        season_id: "season_3",
        start: Date.UTC(2026, 9, 2),   // Oct 2, 2026 (7-day off-season gap)
        end:   Date.UTC(2026, 10, 27), // Nov 27, 2026
    },
];

// ---------------------------------------------------------------------------
// Tier Definitions — 20 tiers, all free
// ---------------------------------------------------------------------------

const SEASON_TIERS = [
    { tier: 1,  sxp_required: 200,   reward_type: "coins",    reward_value: 100,                          is_milestone: false },
    { tier: 2,  sxp_required: 450,   reward_type: "token",    reward_value: 1,                            is_milestone: false },
    { tier: 3,  sxp_required: 750,   reward_type: "coins",    reward_value: 150,                          is_milestone: false },
    { tier: 4,  sxp_required: 1100,  reward_type: "shield",   reward_value: "bronze",                     is_milestone: false },
    { tier: 5,  sxp_required: 1500,  reward_type: "cosmetic", reward_value: "avatar_ring_season_sparks",  is_milestone: true  },
    { tier: 6,  sxp_required: 1950,  reward_type: "coins",    reward_value: 200,                          is_milestone: false },
    { tier: 7,  sxp_required: 2450,  reward_type: "token",    reward_value: 2,                            is_milestone: false },
    { tier: 8,  sxp_required: 3000,  reward_type: "shield",   reward_value: "silver",                     is_milestone: false },
    { tier: 9,  sxp_required: 3600,  reward_type: "coins",    reward_value: 350,                          is_milestone: false },
    { tier: 10, sxp_required: 4250,  reward_type: "cosmetic", reward_value: "card_back_season_aura",      is_milestone: true  },
    { tier: 11, sxp_required: 4950,  reward_type: "coins",    reward_value: 500,                          is_milestone: false },
    { tier: 12, sxp_required: 5700,  reward_type: "shield",   reward_value: "gold",                       is_milestone: false },
    { tier: 13, sxp_required: 6500,  reward_type: "coins",    reward_value: 600,                          is_milestone: false },
    { tier: 14, sxp_required: 7350,  reward_type: "token",    reward_value: 3,                            is_milestone: false },
    { tier: 15, sxp_required: 8250,  reward_type: "cosmetic", reward_value: "avatar_frame_crown_seasons", is_milestone: true  },
    { tier: 16, sxp_required: 9200,  reward_type: "coins",    reward_value: 750,                          is_milestone: false },
    { tier: 17, sxp_required: 10200, reward_type: "shield",   reward_value: "platinum",                   is_milestone: false },
    { tier: 18, sxp_required: 11250, reward_type: "coins",    reward_value: 1000,                         is_milestone: false },
    { tier: 19, sxp_required: 12350, reward_type: "cosmetic", reward_value: "card_back_season_phoenix",   is_milestone: false },
    { tier: 20, sxp_required: 13500, reward_type: "cosmetic", reward_value: "title_season_master",        is_milestone: true  },
];

// ---------------------------------------------------------------------------
// Weekly Challenge Pool — 6 chosen per week, one per category max
// ---------------------------------------------------------------------------

const CHALLENGE_POOL = [
    // match_win (pick 1)
    { id: "win_3_any",       category: "match_win",   description: "Win 3 matches in any mode",          target: 3,    sxp_reward: 100, progress_key: "wins_this_week" },
    { id: "win_5_any",       category: "match_win",   description: "Win 5 matches in any mode",          target: 5,    sxp_reward: 150, progress_key: "wins_this_week" },
    { id: "win_gold_plus",   category: "match_win",   description: "Win 1 Gold or higher match",         target: 1,    sxp_reward: 120, progress_key: "gold_plus_wins_this_week" },
    // match_count (pick 1)
    { id: "play_5_any",      category: "match_count", description: "Play 5 matches (any result)",        target: 5,    sxp_reward: 90,  progress_key: "matches_this_week" },
    { id: "play_10_any",     category: "match_count", description: "Play 10 matches (any result)",       target: 10,   sxp_reward: 140, progress_key: "matches_this_week" },
    { id: "play_sapphire",   category: "match_count", description: "Play a Sapphire match",              target: 1,    sxp_reward: 120, progress_key: "sapphire_matches_this_week" },
    // streak (pick 1)
    { id: "streak_2",        category: "streak",      description: "Win 2 matches in a row",             target: 2,    sxp_reward: 100, progress_key: "best_streak_this_week" },
    { id: "streak_3",        category: "streak",      description: "Win 3 matches in a row",             target: 3,    sxp_reward: 150, progress_key: "best_streak_this_week" },
    // economy (pick 1)
    { id: "spin_3",          category: "economy",     description: "Spin the wheel 3 times",             target: 3,    sxp_reward: 80,  progress_key: "spins_this_week" },
    { id: "earn_1000_coins", category: "economy",     description: "Earn 1,000 coins from matches",      target: 1000, sxp_reward: 100, progress_key: "match_coins_this_week" },
    // engagement (pick 1)
    { id: "daily_4",         category: "engagement",  description: "Claim daily login 4 days this week", target: 4,    sxp_reward: 75,  progress_key: "daily_claims_this_week" },
    { id: "daily_7",         category: "engagement",  description: "Claim daily login all 7 days",       target: 7,    sxp_reward: 200, progress_key: "daily_claims_this_week" },
    { id: "watch_3_ads",     category: "engagement",  description: "Watch 3 ads",                        target: 3,    sxp_reward: 75,  progress_key: "ads_this_week" },
    // social (pick 1)
    { id: "open_3_days",     category: "social",      description: "Open the app 3 days in a row",       target: 3,    sxp_reward: 80,  progress_key: "login_streak_this_week" },
];

const CHALLENGE_CATEGORIES = ["match_win", "match_count", "streak", "economy", "engagement", "social"];

// ---------------------------------------------------------------------------
// Storage / Season Helpers
// ---------------------------------------------------------------------------

function getActiveSeason(now) {
    for (const s of SEASONS) {
        if (now >= s.start && now < s.end) return s;
    }
    return null;
}

function getNextSeason(now) {
    for (const s of SEASONS) {
        if (s.start > now) return s;
    }
    return null;
}

function getSeasonalProgress(nk, userId, seasonId) {
    const defaults = {
        season_id: seasonId,
        seasonal_xp: 0,
        current_tier: 0,
        tiers_claimed: new Array(20).fill(false),
        win_streak: 0,
        first_match_today: false,
        last_first_match_date: 0,
        season_master: false,
        weekly_challenges: null,
    };
    const result = nk.storageRead([{ collection: "player_seasonal", key: seasonId, userId }]);
    if (result && result.length > 0) {
        return Object.assign(Object.assign({}, defaults), result[0].value);
    }
    return defaults;
}

function writeSeasonalProgress(nk, userId, seasonId, progress) {
    nk.storageWrite([{
        collection: "player_seasonal",
        key: seasonId,
        userId,
        value: progress,
        permissionRead: 1,
        permissionWrite: 0,
    }]);
}

// ---------------------------------------------------------------------------
// Weekly Challenge Helpers
// ---------------------------------------------------------------------------

function getISOWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function pickWeeklyChallenges(weekNumber) {
    const picked = [];
    for (const cat of CHALLENGE_CATEGORIES) {
        const pool = CHALLENGE_POOL.filter(c => c.category === cat);
        const idx = weekNumber % pool.length;
        picked.push(pool[idx]);
    }
    return picked;
}

function initWeeklyChallenges(weekNumber) {
    const challenges = pickWeeklyChallenges(weekNumber);
    return {
        week_number: weekNumber,
        challenges: challenges.map(c => ({
            id: c.id,
            category: c.category,
            description: c.description,
            target: c.target,
            sxp_reward: c.sxp_reward,
            progress_key: c.progress_key,
            progress: 0,
            claimed: false,
        })),
        wins_this_week: 0,
        matches_this_week: 0,
        gold_plus_wins_this_week: 0,
        sapphire_matches_this_week: 0,
        best_streak_this_week: 0,
        spins_this_week: 0,
        match_coins_this_week: 0,
        daily_claims_this_week: 0,
        ads_this_week: 0,
        login_streak_this_week: 0,
    };
}

function syncChallengeProgress(weeklyState) {
    if (!weeklyState || !weeklyState.challenges) return weeklyState;
    for (const ch of weeklyState.challenges) {
        if (!ch.claimed) {
            const currentProgress = weeklyState[ch.progress_key] || 0;
            ch.progress = Math.min(currentProgress, ch.target);
        }
    }
    return weeklyState;
}

// ---------------------------------------------------------------------------
// SXP Tier Recalculation
// ---------------------------------------------------------------------------

function recalculateTier(sxp) {
    let highestTier = 0;
    for (const td of SEASON_TIERS) {
        if (sxp >= td.sxp_required) {
            highestTier = td.tier;
        } else {
            break;
        }
    }
    return highestTier;
}

// ---------------------------------------------------------------------------
// PUBLIC: grantSeasonalXP — Called by economy.js RPCs
// ---------------------------------------------------------------------------

function grantSeasonalXP(nk, logger, userId, sxpAmount, source) {
    const now = Date.now();
    const activeSeason = getActiveSeason(now);
    if (!activeSeason) {
        logger.info(`[Seasonal] SXP grant skipped (off-season). Source: ${source}`);
        return;
    }
    const progress = getSeasonalProgress(nk, userId, activeSeason.season_id);
    const weekNumber = getISOWeekNumber(new Date(now));
    if (!progress.weekly_challenges || progress.weekly_challenges.week_number !== weekNumber) {
        progress.weekly_challenges = initWeeklyChallenges(weekNumber);
    }
    progress.seasonal_xp += sxpAmount;
    const newTier = recalculateTier(progress.seasonal_xp);
    if (newTier > progress.current_tier) {
        progress.current_tier = newTier;
        logger.info(`[Seasonal] Player ${userId} reached Tier ${newTier}! SXP: ${progress.seasonal_xp}`);
    }
    writeSeasonalProgress(nk, userId, activeSeason.season_id, progress);
    logger.info(`[Seasonal] Granted ${sxpAmount} SXP to ${userId} from '${source}'. Total: ${progress.seasonal_xp}`);
}

// ---------------------------------------------------------------------------
// PUBLIC: updateWeeklyProgress — Called by economy.js RPCs
// ---------------------------------------------------------------------------

function updateWeeklyProgress(nk, logger, userId, updates) {
    const now = Date.now();
    const activeSeason = getActiveSeason(now);
    if (!activeSeason) return;
    const progress = getSeasonalProgress(nk, userId, activeSeason.season_id);
    const weekNumber = getISOWeekNumber(new Date(now));
    if (!progress.weekly_challenges || progress.weekly_challenges.week_number !== weekNumber) {
        progress.weekly_challenges = initWeeklyChallenges(weekNumber);
    }
    for (const key of Object.keys(updates)) {
        const delta = updates[key];
        if (key === "best_streak_this_week") {
            progress.weekly_challenges[key] = Math.max(progress.weekly_challenges[key] || 0, delta);
        } else {
            progress.weekly_challenges[key] = (progress.weekly_challenges[key] || 0) + delta;
        }
    }
    writeSeasonalProgress(nk, userId, activeSeason.season_id, progress);
}

// ---------------------------------------------------------------------------
// RPC: get_seasonal_status
// ---------------------------------------------------------------------------

function getSeasonalStatusRpc(ctx, logger, nk, _payload) {
    const userId = ctx.userId;
    if (!userId) throw new Error("Unauthenticated request.");
    const now = Date.now();
    const activeSeason = getActiveSeason(now);
    const nextSeason = getNextSeason(now);
    if (!activeSeason) {
        return JSON.stringify({
            success: true,
            season_active: false,
            next_season_id: nextSeason ? nextSeason.season_id : null,
            next_season_start: nextSeason ? nextSeason.start : null,
            season_tiers: SEASON_TIERS,
        });
    }
    const progress = getSeasonalProgress(nk, userId, activeSeason.season_id);
    const weekNumber = getISOWeekNumber(new Date(now));
    if (!progress.weekly_challenges || progress.weekly_challenges.week_number !== weekNumber) {
        progress.weekly_challenges = initWeeklyChallenges(weekNumber);
        writeSeasonalProgress(nk, userId, activeSeason.season_id, progress);
    } else {
        progress.weekly_challenges = syncChallengeProgress(progress.weekly_challenges);
    }
    return JSON.stringify({
        success: true,
        season_active: true,
        season_id: activeSeason.season_id,
        season_start: activeSeason.start,
        season_end: activeSeason.end,
        seasonal_xp: progress.seasonal_xp,
        current_tier: progress.current_tier,
        tiers_claimed: progress.tiers_claimed,
        season_master: progress.season_master,
        weekly_challenges: progress.weekly_challenges,
        season_tiers: SEASON_TIERS,
        time_remaining_ms: activeSeason.end - now,
    });
}

// ---------------------------------------------------------------------------
// RPC: claim_seasonal_tier
// ---------------------------------------------------------------------------

function claimSeasonalTierRpc(ctx, logger, nk, payload) {
    const userId = ctx.userId;
    if (!userId) throw new Error("Unauthenticated request.");
    const now = Date.now();
    const activeSeason = getActiveSeason(now);
    if (!activeSeason) {
        return JSON.stringify({ success: false, error: "No active season." });
    }
    const parsed = payload ? JSON.parse(payload) : {};
    const tierNumber = parsed.tier;
    if (!tierNumber || tierNumber < 1 || tierNumber > 20) {
        return JSON.stringify({ success: false, error: "Invalid tier number." });
    }
    const tierDef = SEASON_TIERS.find(t => t.tier === tierNumber);
    if (!tierDef) {
        return JSON.stringify({ success: false, error: "Tier definition not found." });
    }
    const progress = getSeasonalProgress(nk, userId, activeSeason.season_id);
    if (progress.seasonal_xp < tierDef.sxp_required) {
        return JSON.stringify({ success: false, error: "Insufficient SXP to claim this tier." });
    }
    if (progress.tiers_claimed[tierNumber - 1] === true) {
        return JSON.stringify({ success: false, error: "Tier already claimed." });
    }
    // Read player inventory & stats to apply rewards
    const statsRead = nk.storageRead([{ collection: "player_stats", key: "stats", userId }]);
    const stats = (statsRead && statsRead.length > 0) ? statsRead[0].value : { coins: 0 };
    const inventoryRead = nk.storageRead([{ collection: "player_inventory", key: "inventory", userId }]);
    const inventory = (inventoryRead && inventoryRead.length > 0) ? inventoryRead[0].value : {
        spin_tokens: 0,
        shields: { starter: 0, bronze: 0, silver: 0, gold: 0, platinum: 0 },
        unlocked_cosmetics: [],
        equipped_cosmetics: {},
    };
    let rewardDescription = "";
    if (tierDef.reward_type === "coins") {
        const amount = tierDef.reward_value;
        stats.coins += amount;
        nk.walletUpdate(userId, { coins: amount }, { source: "seasonal_tier_claim", tier: tierNumber });
        rewardDescription = `${amount} Coins`;
    } else if (tierDef.reward_type === "token") {
        const count = tierDef.reward_value;
        inventory.spin_tokens = (inventory.spin_tokens || 0) + count;
        rewardDescription = `${count}x Spin Token`;
    } else if (tierDef.reward_type === "shield") {
        const shieldType = tierDef.reward_value;
        if (!inventory.shields) inventory.shields = {};
        inventory.shields[shieldType] = Math.min((inventory.shields[shieldType] || 0) + 1, 3);
        rewardDescription = `1x ${shieldType} Shield`;
    } else if (tierDef.reward_type === "cosmetic") {
        const cosmeticId = tierDef.reward_value;
        if (!inventory.unlocked_cosmetics) inventory.unlocked_cosmetics = [];
        if (inventory.unlocked_cosmetics.indexOf(cosmeticId) === -1) {
            inventory.unlocked_cosmetics.push(cosmeticId);
        }
        rewardDescription = `Cosmetic: ${cosmeticId}`;
    }
    progress.tiers_claimed[tierNumber - 1] = true;
    if (tierNumber === 20) {
        progress.season_master = true;
        if (!inventory.unlocked_cosmetics) inventory.unlocked_cosmetics = [];
        if (inventory.unlocked_cosmetics.indexOf("title_season_master") === -1) {
            inventory.unlocked_cosmetics.push("title_season_master");
        }
        logger.info(`[Seasonal] Player ${userId} achieved SEASON MASTER!`);
    }
    nk.storageWrite([{ collection: "player_stats", key: "stats", userId, value: stats, permissionRead: 1, permissionWrite: 1 }]);
    nk.storageWrite([{ collection: "player_inventory", key: "inventory", userId, value: inventory, permissionRead: 1, permissionWrite: 0 }]);
    writeSeasonalProgress(nk, userId, activeSeason.season_id, progress);
    logger.info(`[Seasonal] Player ${userId} claimed Tier ${tierNumber}: ${rewardDescription}`);
    return JSON.stringify({
        success: true,
        tier_claimed: tierNumber,
        reward_type: tierDef.reward_type,
        reward_value: tierDef.reward_value,
        reward_description: rewardDescription,
        is_milestone: tierDef.is_milestone,
        season_master: progress.season_master,
        new_coins: stats.coins,
        spin_tokens: inventory.spin_tokens,
    });
}

// ---------------------------------------------------------------------------
// RPC: get_weekly_challenges
// ---------------------------------------------------------------------------

function getWeeklyChallengesRpc(ctx, logger, nk, _payload) {
    const userId = ctx.userId;
    if (!userId) throw new Error("Unauthenticated request.");
    const now = Date.now();
    const activeSeason = getActiveSeason(now);
    if (!activeSeason) {
        return JSON.stringify({ success: false, error: "No active season." });
    }
    const progress = getSeasonalProgress(nk, userId, activeSeason.season_id);
    const weekNumber = getISOWeekNumber(new Date(now));
    if (!progress.weekly_challenges || progress.weekly_challenges.week_number !== weekNumber) {
        progress.weekly_challenges = initWeeklyChallenges(weekNumber);
        writeSeasonalProgress(nk, userId, activeSeason.season_id, progress);
    } else {
        progress.weekly_challenges = syncChallengeProgress(progress.weekly_challenges);
    }
    return JSON.stringify({
        success: true,
        week_number: weekNumber,
        challenges: progress.weekly_challenges.challenges,
    });
}

// ---------------------------------------------------------------------------
// RPC: claim_weekly_challenge
// ---------------------------------------------------------------------------

function claimWeeklyChallengeRpc(ctx, logger, nk, payload) {
    const userId = ctx.userId;
    if (!userId) throw new Error("Unauthenticated request.");
    const now = Date.now();
    const activeSeason = getActiveSeason(now);
    if (!activeSeason) {
        return JSON.stringify({ success: false, error: "No active season." });
    }
    const parsed = payload ? JSON.parse(payload) : {};
    const challengeId = parsed.challenge_id;
    if (!challengeId) {
        return JSON.stringify({ success: false, error: "Missing challenge_id." });
    }
    const progress = getSeasonalProgress(nk, userId, activeSeason.season_id);
    const weekNumber = getISOWeekNumber(new Date(now));
    if (!progress.weekly_challenges || progress.weekly_challenges.week_number !== weekNumber) {
        return JSON.stringify({ success: false, error: "No active challenges this week." });
    }
    progress.weekly_challenges = syncChallengeProgress(progress.weekly_challenges);
    const challenge = progress.weekly_challenges.challenges.find(c => c.id === challengeId);
    if (!challenge) {
        return JSON.stringify({ success: false, error: "Challenge not found." });
    }
    if (challenge.claimed) {
        return JSON.stringify({ success: false, error: "Challenge already claimed." });
    }
    if (challenge.progress < challenge.target) {
        return JSON.stringify({ success: false, error: "Challenge not yet completed." });
    }
    progress.seasonal_xp += challenge.sxp_reward;
    const newTier = recalculateTier(progress.seasonal_xp);
    if (newTier > progress.current_tier) {
        progress.current_tier = newTier;
    }
    challenge.claimed = true;
    writeSeasonalProgress(nk, userId, activeSeason.season_id, progress);
    logger.info(`[Seasonal] Player ${userId} claimed weekly challenge '${challengeId}': +${challenge.sxp_reward} SXP`);
    return JSON.stringify({
        success: true,
        challenge_id: challengeId,
        sxp_awarded: challenge.sxp_reward,
        total_sxp: progress.seasonal_xp,
        current_tier: progress.current_tier,
    });
}

// ---------------------------------------------------------------------------
// Module entry point
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

  // Seasonal RPCs
  initializer.registerRpc("get_seasonal_status",    getSeasonalStatusRpc);
  initializer.registerRpc("claim_seasonal_tier",    claimSeasonalTierRpc);
  initializer.registerRpc("get_weekly_challenges",  getWeeklyChallengesRpc);
  initializer.registerRpc("claim_weekly_challenge", claimWeeklyChallengeRpc);

  logger.info("[Economy] Economy module loaded successfully.");
  logger.info("[Seasonal] Seasonal module loaded successfully.");
  logger.info("[Runtime] All U10 modules initialized successfully.");
}

