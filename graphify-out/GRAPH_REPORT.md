# Graph Report - u10-server  (2026-06-07)

## Corpus Check
- 20 files · ~54,426 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 422 nodes · 739 edges · 24 communities (23 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9f9a1a68`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]

## God Nodes (most connected - your core abstractions)
1. `practice` - 15 edges
2. `starter` - 15 edges
3. `bronze` - 15 edges
4. `silver` - 15 edges
5. `gold` - 15 edges
6. `platinum` - 15 edges
7. `readPlayerStats()` - 12 edges
8. `writePlayerStats()` - 12 edges
9. `readPlayerStats()` - 11 edges
10. `writePlayerStats()` - 11 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Communities (24 total, 1 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.12
Nodes (30): adCallbackRpc(), applyAdMultiplierRpc(), ARENA_ENTRY_FEES, buyCosmeticRpc(), calculateTier(), claimDailyLoginRpc(), claimSignupRewardRpc(), COSMETIC_CATALOGUE (+22 more)

### Community 1 - "Community 1"
Cohesion: 0.20
Nodes (25): ChallengeDef, SeasonalConfig, TierDef, CHALLENGE_CATEGORIES, CHALLENGE_POOL, claimSeasonalTierRpc(), claimWeeklyChallengeRpc(), getActiveSeason() (+17 more)

### Community 2 - "Community 2"
Cohesion: 0.12
Nodes (31): ARENA_CONFIG, ARENA_ENTRY_FEES, adCallbackRpc(), applyAdMultiplierRpc(), ARENA_ENTRY_FEES, buyCosmeticRpc(), calculateTier(), claimDailyLoginRpc() (+23 more)

### Community 3 - "Community 3"
Cohesion: 0.24
Nodes (22): CHALLENGE_CATEGORIES, CHALLENGE_POOL, claimSeasonalTierRpc(), claimWeeklyChallengeRpc(), getActiveSeason(), getISOWeekNumber(), getNextSeason(), getSeasonalConfig() (+14 more)

### Community 4 - "Community 4"
Cohesion: 0.13
Nodes (15): bronze, badge, badge_color, desc, entry_fee, glow_color, glow_enabled, gradient (+7 more)

### Community 5 - "Community 5"
Cohesion: 0.06
Nodes (35): platinum, badge, badge_color, desc, entry_fee, glow_color, glow_enabled, gradient (+27 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (69): adCallbackRpc(), applyAdMultiplierRpc(), ARENA_ENTRY_FEES, buyCosmeticRpc(), calculateTier(), CHALLENGE_CATEGORIES, CHALLENGE_POOL, claimDailyLoginRpc() (+61 more)

### Community 7 - "Community 7"
Cohesion: 0.10
Nodes (18): arenaDefaults, authJs, cleanAuth, cleanEconomy, cleanEconomyRaw, cleanFriends, cleanMatchmaking, cleanPrivateTable (+10 more)

### Community 8 - "Community 8"
Cohesion: 0.28
Nodes (5): DEFAULT_PLAYER_INVENTORY, DEFAULT_PLAYER_STATS, generateUniqueUsername(), initializePlayerProfile(), onAfterAuthenticate()

### Community 9 - "Community 9"
Cohesion: 0.28
Nodes (5): DEFAULT_PLAYER_INVENTORY, DEFAULT_PLAYER_STATS, generateUniqueUsername(), initializePlayerProfile(), onAfterAuthenticate()

### Community 10 - "Community 10"
Cohesion: 0.33
Nodes (5): Context, Initializer, Logger, Nakama, Session

### Community 11 - "Community 11"
Cohesion: 0.13
Nodes (15): practice, badge, badge_color, desc, entry_fee, glow_color, glow_enabled, gradient (+7 more)

### Community 16 - "Community 16"
Cohesion: 0.13
Nodes (15): starter, badge, badge_color, desc, entry_fee, glow_color, glow_enabled, gradient (+7 more)

### Community 17 - "Community 17"
Cohesion: 0.07
Nodes (26): 1.10 Create systemd service (auto-start on reboot), 1.1 Connect to your VM, 1.2 Install Docker & Docker Compose, 1.3 Open Firewall Ports (Oracle Security List), 1.4 Install Caddy (Automatic HTTPS), 1.5 Configure Caddy, 1.6 Clone your Nakama repo on the VM, 1.7 Create the `.env` file (production secrets) (+18 more)

### Community 18 - "Community 18"
Cohesion: 0.13
Nodes (15): gold, badge, badge_color, desc, entry_fee, glow_color, glow_enabled, gradient (+7 more)

### Community 19 - "Community 19"
Cohesion: 0.52
Nodes (5): escalateMatchmakingRpc(), getArenaEntryFee(), getPlayerTier(), joinMatchmakingQueueRpc(), readTableConfig()

### Community 20 - "Community 20"
Cohesion: 0.52
Nodes (5): escalateMatchmakingRpc(), getArenaEntryFee(), getPlayerTier(), joinMatchmakingQueueRpc(), readTableConfig()

### Community 22 - "Community 22"
Cohesion: 0.33
Nodes (7): createPrivateTableRpc(), generateTableCode(), generateUniqueTableCode(), getTableConfigRpc(), readPlayerStats(), readTableConfig(), writePlayerStats()

### Community 23 - "Community 23"
Cohesion: 0.33
Nodes (7): createPrivateTableRpc(), generateTableCode(), generateUniqueTableCode(), getTableConfigRpc(), readPlayerStats(), readTableConfig(), writePlayerStats()

## Knowledge Gaps
- **168 isolated node(s):** `entrypoint.sh script`, `public_max_players`, `private_max_players`, `private_create_cost`, `elimination_points` (+163 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `practice` connect `Community 11` to `Community 5`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `starter` connect `Community 16` to `Community 5`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `bronze` connect `Community 4` to `Community 5`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **What connects `entrypoint.sh script`, `public_max_players`, `private_max_players` to the rest of the system?**
  _168 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.1214574898785425 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.11666666666666667 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._