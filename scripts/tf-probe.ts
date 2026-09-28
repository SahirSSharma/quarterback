// Token Factory probe: runs the four cheap calls in lib/tf/probe-cases.ts and prints their ledger entries.
//
//   QB_MODE=live QB_RECORD=1 node scripts/tf-probe.ts   — LIVE (well under $0.05) and (re)writes fixtures/tf
//   node scripts/tf-probe.ts                            — replays the recorded fixtures for $0
//
// Node 26 strips types natively, but its ESM loader needs explicit `.ts` extensions, which tsc rejects
// without allowImportingTsExtensions. The resolve hook below adds `.ts` to extensionless relative imports so
// the repo keeps tsc-style specifiers; the lib imports must be dynamic so they resolve after the hook.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      try {
        return next(`${specifier}.ts`, context);
      } catch {
        // not a TS file; fall through to normal resolution
      }
    }
    return next(specifier, context);
  },
});

const { loadEnv, mode } = await import('../lib/env');
loadEnv();
const { ledgerSink, MemoryLedger } = await import('../lib/tf/ledger');
const { probeForcedTool, probeStream, probeStructured, probeToolLoop } = await import('../lib/tf/probe-cases');

const ledger = ledgerSink() as InstanceType<typeof MemoryLedger>;
console.log(`mode=${mode()} record=${process.env.QB_RECORD === '1'}`);

const extracted = await probeStructured();
console.log('structured →', JSON.stringify(extracted));

const { args } = await probeForcedTool();
console.log('forcedTool →', JSON.stringify(args));

const loop = await probeToolLoop((e) => {
  if (e.type === 'tool_call') console.log('  tool_call', e.name, JSON.stringify(e.args));
  if (e.type === 'tool_result') console.log('  tool_result', e.name, `${e.ms} ms`, e.summary);
});
console.log('toolLoop →', `${loop.rounds} rounds,`, JSON.stringify(loop.message.content));

const streamed = await probeStream();
console.log('stream →', `${streamed.deltas} deltas,`, JSON.stringify(streamed.text));

console.log('\nledger');
let total = 0;
for (const e of ledger.entries) {
  total += e.usd;
  console.log(
    `  ${e.step.padEnd(14)} ${e.model.padEnd(40)} ${String(e.ms).padStart(6)} ms  in ${e.promptTokens}  out ${e.completionTokens}` +
      `  reasoning ${e.reasoningTokens}  cache ${e.cacheHitTokens}  $${e.usd.toFixed(6)}${e.replayed ? '  (replayed)' : ''}${e.fallback ? '  (fallback)' : ''}`,
  );
}
console.log(`  total $${total.toFixed(6)} over ${ledger.entries.length} calls`);
