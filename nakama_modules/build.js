const fs = require('fs');
const path = require('path');

const authJs = fs.readFileSync(path.join(__dirname, 'auth.js'), 'utf8');
const economyJs = fs.readFileSync(path.join(__dirname, 'economy.js'), 'utf8');
const seasonalJs = fs.readFileSync(path.join(__dirname, 'seasonal.js'), 'utf8');
const legalJs = fs.readFileSync(path.join(__dirname, 'legal_defaults.js'), 'utf8');
const friendsJs = fs.readFileSync(path.join(__dirname, 'friends.js'), 'utf8');
const matchmakingJs = fs.readFileSync(path.join(__dirname, 'matchmaking.js'), 'utf8');
const privateTableJs = fs.readFileSync(path.join(__dirname, 'private_table.js'), 'utf8');


function stripInitModule(content) {
  const marker = 'function InitModule(';
  const index = content.indexOf(marker);
  if (index !== -1) {
    return content.substring(0, index);
  }
  return content;
}

const cleanAuth = stripInitModule(authJs);
const cleanEconomyRaw = stripInitModule(economyJs);
const arenaDefaults = fs.readFileSync(path.join(__dirname, 'arena_defaults.json'), 'utf8').trim();
const escapedDefaults = JSON.stringify(JSON.parse(arenaDefaults));
const cleanEconomy = cleanEconomyRaw.replace('/*ARENA_DEFAULTS_PLACEHOLDER*/', escapedDefaults);
const cleanSeasonal = stripInitModule(seasonalJs);
const cleanFriends = stripInitModule(friendsJs);
const cleanMatchmaking = stripInitModule(matchmakingJs);
const cleanPrivateTable = stripInitModule(privateTableJs);

const combinedInitModule = `
// ─────────────────────────────────────────────────────────────────────────────
// RUNTIME ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

function InitModule(ctx, logger, nk, initializer) {
  // Initialize system configuration settings & achievements
  initializeSystemConfig(nk, logger);
  initializeAchievementsConfig(nk, logger);

  // Auth Module hooks
  initializer.registerBeforeAuthenticateEmail(beforeAuthenticateEmail);
  initializer.registerAfterAuthenticateDevice(onAfterAuthenticate);
  initializer.registerAfterAuthenticateGoogle(onAfterAuthenticate);
  logger.info("[Auth] Auth module loaded successfully.");

  // Economy Module RPCs
  initializer.registerRpc("claim_daily_login",  claimDailyLoginRpc);
  initializer.registerRpc("get_daily_rewards_status", getDailyRewardsStatusRpc);
  initializer.registerRpc("get_arena_config",    getArenaConfigRpc);
  initializer.registerRpc("spin_wheel",          spinWheelRpc);
  initializer.registerRpc("buy_cosmetic",        buyCosmeticRpc);
  initializer.registerRpc("ad_callback",         adCallbackRpc);
  initializer.registerRpc("claim_signup_reward", claimSignupRewardRpc);
  initializer.registerRpc("update_profile",       updateProfileRpc);

  // New GDD RPCs
  initializer.registerRpc("apply_ad_multiplier", applyAdMultiplierRpc);
  initializer.registerRpc("start_match",         startMatchRpc);
  initializer.registerRpc("end_match",           endMatchRpc);
  initializer.registerRpc("get_active_match",    getActiveMatchRpc);
  initializer.registerRpc("get_achievements_status", getAchievementsStatusRpc);
  initializer.registerRpc("get_match_history",    getMatchHistoryRpc);
  initializer.registerRpc("update_achievements_config", updateAchievementsConfigRpc);
  initializer.registerRpc("update_system_settings_config", updateSystemSettingsConfigRpc);
  initializer.registerRpc("update_arena_config",          updateArenaConfigRpc);

  // Seasonal RPCs
  initializer.registerRpc("get_seasonal_status",    getSeasonalStatusRpc);
  initializer.registerRpc("claim_seasonal_tier",    claimSeasonalTierRpc);
  initializer.registerRpc("get_weekly_challenges",  getWeeklyChallengesRpc);
  initializer.registerRpc("claim_weekly_challenge", claimWeeklyChallengeRpc);
  initializer.registerRpc("update_seasonal_config", updateSeasonalConfigRpc);

  // Friends Module RPCs
  initializer.registerRpc("search_user_by_username", searchUserByUsernameRpc);

  // Matchmaking Module RPCs
  initializer.registerRpc("join_matchmaking_queue", joinMatchmakingQueueRpc);
  initializer.registerRpc("escalate_matchmaking",   escalateMatchmakingRpc);
  initializer.registerRpc("cancel_matchmaking",     cancelMatchmakingRpc);

  // Private Table RPCs
  initializer.registerRpc("get_table_config",     getTableConfigRpc);
  initializer.registerRpc("create_private_table",  createPrivateTableRpc);
  initializer.registerRpc("join_private_table",    joinPrivateTableRpc);
  initializer.registerRpc("cancel_private_table",  cancelPrivateTableRpc);

  logger.info("[Economy] Economy module loaded successfully.");
  logger.info("[Matchmaking] Matchmaking module loaded successfully.");
  logger.info("[Seasonal] Seasonal module loaded successfully.");
  logger.info("[Friends] Friends module loaded successfully.");
  logger.info("[PrivateTable] Private table module loaded successfully.");
  logger.info("[Runtime] All U10 modules initialized successfully.");
}
`;

const result = `// =============================================================================
// U10 Nakama Server — Runtime Bundle (index.js)
// =============================================================================
// Generated dynamically by build.js
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// LEGAL DEFAULTS
// ─────────────────────────────────────────────────────────────────────────────
${legalJs}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH DOMAIN
// ─────────────────────────────────────────────────────────────────────────────
${cleanAuth}

// ─────────────────────────────────────────────────────────────────────────────
// ECONOMY DOMAIN
// ─────────────────────────────────────────────────────────────────────────────
${cleanEconomy}

// ─────────────────────────────────────────────────────────────────────────────
// SEASONAL DOMAIN
// ─────────────────────────────────────────────────────────────────────────────
${cleanSeasonal}

// ─────────────────────────────────────────────────────────────────────────────
// FRIENDS DOMAIN
// ─────────────────────────────────────────────────────────────────────────────
${cleanFriends}

// ─────────────────────────────────────────────────────────────────────────────
// MATCHMAKING DOMAIN
// ─────────────────────────────────────────────────────────────────────────────
${cleanMatchmaking}

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE TABLE DOMAIN
// ─────────────────────────────────────────────────────────────────────────────
${cleanPrivateTable}
${combinedInitModule}
`;

fs.writeFileSync(path.join(__dirname, 'index.js'), result, 'utf8');
console.log('Successfully bundled index.js!');
