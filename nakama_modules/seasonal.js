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
function InitModule(_ctx, logger, _nk, initializer) {
    initializer.registerRpc("get_seasonal_status",    getSeasonalStatusRpc);
    initializer.registerRpc("claim_seasonal_tier",    claimSeasonalTierRpc);
    initializer.registerRpc("get_weekly_challenges",  getWeeklyChallengesRpc);
    initializer.registerRpc("claim_weekly_challenge", claimWeeklyChallengeRpc);
    logger.info("[Seasonal] Seasonal module loaded successfully.");
}
