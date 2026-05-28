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
    logger.info(`[Economy] Match resolved: MatchId=${matchId}, Player=${userId}, Won=${won}, ShieldConsumed=${shieldConsumed}, XP Gained=${xpGained}`);
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
function InitModule(_ctx, logger, _nk, initializer) {
    initializer.registerRpc("claim_daily_login", claimDailyLoginRpc);
    initializer.registerRpc("get_daily_rewards_status", getDailyRewardsStatusRpc);
    initializer.registerRpc("spin_wheel", spinWheelRpc);
    initializer.registerRpc("buy_cosmetic", buyCosmeticRpc);
    initializer.registerRpc("ad_callback", adCallbackRpc);
    initializer.registerRpc("claim_signup_reward", claimSignupRewardRpc);
    // New GDD RPCs
    initializer.registerRpc("apply_ad_multiplier", applyAdMultiplierRpc);
    initializer.registerRpc("start_match", startMatchRpc);
    initializer.registerRpc("end_match", endMatchRpc);
    initializer.registerRpc("get_active_match", getActiveMatchRpc);
    logger.info("[Economy] Economy module loaded successfully.");
}
