const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMatchPlayerStats, emptyStats, addStats, seasonStatsFromPlayerPage, server } = require('../server');
test('finalizações e chutes no alvo separados em qualquer ordem', () => {
 const entries = [{ key: 'shots_on_target', value: 2 }, { key: 'total_shots', value: 7 }, { key: 'accurate_passes', value: 35, total: 42 }];
 for (const stats of [entries, [...entries].reverse()]) {
 const result = normalizeMatchPlayerStats({ stats });
 assert.equal(result.shots, 7); assert.equal(result.shotsOnTarget, 2); assert.equal(result.passes, 35);
 }
});
test('rótulos parecidos não contam como gols ou assistências', () => {
 const result = normalizeMatchPlayerStats({ stats: { 'Expected goals': { value: 0.7 }, 'Expected assists': { value: 0.3 }, 'Goals': { value: 1 }, 'Assists': { value: 0 } }});
 assert.equal(result.goals, 1); assert.equal(result.assists, 0);
});
test('ausência de jogador e métricas ausentes', () => {
 assert.equal(normalizeMatchPlayerStats(null), null);
 assert.deepEqual(normalizeMatchPlayerStats({ stats: [] }), emptyStats());
});
test('soma jogos sem perder zeros ou valores numéricos em texto', () => {
 const aggregate = emptyStats();
 addStats(aggregate, { goals: 1, shots: '4', minutes: 90 });
 addStats(aggregate, { goals: 0, shots: 3, minutes: '45' });
 assert.equal(aggregate.goals, 1); assert.equal(aggregate.shots, 7); assert.equal(aggregate.minutes, 135);
});
test('temporada exige confirmação da liga e do ano', () => {
 for (const mainLeague of [{}, { leagueId: 47, season: '2026' }, { leagueId: 268, season: '2025' }])
 assert.throws(() => seasonStatsFromPlayerPage({ data: { mainLeague }, text: '' }), /confirmar/);
 const parsed = seasonStatsFromPlayerPage({ data: { mainLeague: { leagueId: 268, season: '2026', stats: [{ title: 'Goals', value: 3 }] }}, text: '' });
 assert.equal(parsed.stats.goals, 3);
});
test('API valida entradas sem acessar a fonte', async () => {
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 try {
 const base = 'http://127.0.0.1:' + server.address().port;
 const health = await fetch(base + '/api/health');
 assert.equal(health.status, 200); assert.equal((await health.json()).season, '2026');
 for (const url of ['/api/squad', '/api/player-stats', '/api/player-stats?player=1&team=2&period=invalid'])
 assert.equal((await fetch(base + url)).status, 400);
 } finally { await new Promise(resolve => server.close(resolve)); }
});
