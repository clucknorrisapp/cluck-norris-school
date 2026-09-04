#!/usr/bin/env node
/**
 * The instruction that makes a token's metadata IMMUTABLE — the last edit the account will ever
 * accept. Two things have to be right, and neither is checkable after the fact:
 *
 *   1. THE BYTES. lib/token-metadata.js hand-builds UpdateMetadataAccountV2 because the Metaplex
 *      SDK is ESM-only and fights this CommonJS server (same reason hatchery.js hand-builds its
 *      create instruction). CLAUDE.md's rule for that is explicit: diff the bytes against the real
 *      library in Node before shipping. This does exactly that, via the library's own serializer.
 *   2. EVERY PRESERVED FIELD. UpdateMetadataAccountV2 takes a WHOLE DataV2, not a patch. Anything
 *      omitted is written as empty/None permanently. ROSE carries a VERIFIED creator at share 100
 *      — passing creators: None would erase it forever on the one call that cannot be undone.
 *
 * Uses the REAL on-chain ROSE account as a fixture (captured, not fetched — this must run offline
 * and deterministically in CI).
 */
const path = require('path');
const { PublicKey } = require('@solana/web3.js');

let failures = 0;
const ok = (n, c, d) => { if (c) console.log('  ✓ ' + n); else { failures++; console.log('  ✗ ' + n + (d ? '\n      ' + d : '')); } };

const M = require(path.join(__dirname, '..', 'lib', 'token-metadata.js'));

// The live ROSE metadata account, decoded 2026-09-04. Kept as a fixture so the test is offline.
const ROSE = {
  key: 4,
  updateAuthority: 'RosepN6TnevxxgnL9qFXqhRz6s8tELJDP6r953AMFvX',
  mint: 'RoSeiVjW5H48ucPAJh1LJGBBzPpqvsokfDGpgHXDtdF',
  name: 'OnlyRose', symbol: 'ROSE',
  uri: 'https://ipfs.io/ipfs/QmQ4VSPt6BqBb75iqXNszwpLdakSkjbu23QqDi3ize2m1m',
  sellerFeeBasisPoints: 0,
  creators: [{ address: 'RosepN6TnevxxgnL9qFXqhRz6s8tELJDP6r953AMFvX', verified: true, share: 100 }],
  primarySaleHappened: false, isMutable: true, editionNonce: 253, tokenStandard: 2,
  collection: null, uses: null,
};
const NEW_URI = 'https://arweave.net/EjtH_HUOurkf_rLPeS6QLZprrFP_7OmDZg52JopeyIE';

(async () => {
  console.log('\nPDA + decode round-trip\n');
  // Decode the REAL account bytes (captured fixture, so this runs offline in CI) and check the
  // decoder agrees with the struct the rest of the test builds from. If the decoder drifts, every
  // "preserved field" assertion below would be checking a fiction.
  const fs = require('fs');
  const raw = Buffer.from(fs.readFileSync(path.join(__dirname, 'fixtures', 'rose-metadata-account.b64'), 'utf8'), 'base64');
  const dec = M.decodeMetadata(raw);
  ok('decodes the real on-chain account', !!dec && dec.key === 4);
  for (const k of ['updateAuthority', 'mint', 'name', 'symbol', 'uri', 'sellerFeeBasisPoints',
                   'primarySaleHappened', 'isMutable', 'editionNonce', 'tokenStandard']) {
    ok(`  decoded ${k} matches the fixture struct`, JSON.stringify(dec[k]) === JSON.stringify(ROSE[k]),
       `${JSON.stringify(dec[k])} vs ${JSON.stringify(ROSE[k])}`);
  }
  ok('  decoded creators match (verified flag and share included)',
     JSON.stringify(dec.creators) === JSON.stringify(ROSE.creators), JSON.stringify(dec.creators));
  ok('  collection and uses are both absent, as on-chain',
     dec.collection === null && dec.uses === null);
  ok('  the name has no NUL padding welded on', dec.name === dec.name.replace(/\0+$/, ''));

  ok('metadata PDA matches the account we read on-chain',
     M.metadataPda(ROSE.mint).toBase58() === 'FCecGxbc5TM3HswEZjn5ofWBhf7HzKGaD859e5kmKgmL',
     M.metadataPda(ROSE.mint).toBase58());

  console.log('\nthe irreversible edit preserves everything it must\n');
  const { ix, preserved, changes } = M.buildUpdateIx({ current: ROSE, newUri: NEW_URI, makeImmutable: true });
  ok('THE ONE THAT MATTERS: the verified creator survives',
     preserved.creators && preserved.creators.length === 1 &&
     preserved.creators[0].address === ROSE.creators[0].address &&
     preserved.creators[0].verified === true && preserved.creators[0].share === 100,
     JSON.stringify(preserved.creators));
  ok('name and symbol are unchanged', preserved.name === 'OnlyRose' && preserved.symbol === 'ROSE');
  ok('seller fee is unchanged', preserved.sellerFeeBasisPoints === 0);
  ok('update authority is NOT reassigned', preserved.updateAuthority === ROSE.updateAuthority);
  ok('the URI is the change we asked for', changes.uri.to === NEW_URI && changes.uri.changed === true);
  ok('isMutable goes true -> false', changes.isMutable.from === true && changes.isMutable.to === false);

  console.log('\naccounts + guards\n');
  ok('metadata account is writable and not a signer',
     ix.keys[0].isWritable === true && ix.keys[0].isSigner === false);
  ok('update authority signs and is not writable',
     ix.keys[1].isSigner === true && ix.keys[1].isWritable === false &&
     ix.keys[1].pubkey.toBase58() === ROSE.updateAuthority);
  ok('targets the Metaplex program', ix.programId.toBase58() === 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
  ok('discriminator is 15 (UpdateMetadataAccountV2)', ix.data[0] === 15);

  let threw = null;
  try { M.buildUpdateIx({ current: { ...ROSE, isMutable: false }, newUri: NEW_URI, makeImmutable: true }); } catch (e) { threw = e.message; }
  ok('refuses to act on already-immutable metadata', /already immutable/.test(threw || ''), String(threw));
  threw = null;
  try { M.buildUpdateIx({ current: ROSE, newUri: 'javascript:alert(1)' }); } catch (e) { threw = e.message; }
  ok('refuses a URI that is not https/ipfs/ar', /refusing a non-https/.test(threw || ''), String(threw));
  ok('omitting newUri keeps the existing URI',
     M.buildUpdateIx({ current: ROSE, makeImmutable: true }).changes.uri.changed === false);

  // ---- STEP 1 vs STEP 2 ----------------------------------------------------------------------
  // The two-step flow is the safety model: repoint the URI while STILL MUTABLE, go and look at it
  // rendering in a wallet and on the aggregators, and only then lock. A step-1 transaction must
  // therefore leave the mutable flag completely alone — not set it true, which would be a no-op
  // today but would silently RE-OPEN a locked token if this were ever aimed at one.
  console.log('\nstep 1 (update only) vs step 2 (lock)\n');
  const step1 = M.buildUpdateIx({ current: ROSE, newUri: NEW_URI, makeImmutable: false });
  ok('step 1 is not marked irreversible', step1.irreversible === false);
  ok('step 1 leaves isMutable untouched', step1.changes.isMutable.to === true && step1.changes.isMutable.changed === false,
     JSON.stringify(step1.changes.isMutable));
  ok('step 1 still repoints the URI', step1.changes.uri.to === NEW_URI && step1.changes.uri.changed === true);
  ok('step 1 preserves the verified creator too',
     JSON.stringify(step1.preserved.creators) === JSON.stringify(ROSE.creators));
  const step2 = M.buildUpdateIx({ current: ROSE, makeImmutable: true });
  ok('step 2 IS marked irreversible', step2.irreversible === true);
  ok('step 2 alone does not touch the URI', step2.changes.uri.changed === false);
  let n = null;
  try { M.buildUpdateIx({ current: ROSE }); } catch (e) { n = e.message; }
  ok('a call that would do nothing is refused', /nothing to do/.test(n || ''), String(n));
  ok('step 1 and step 2 produce DIFFERENT instruction data', !Buffer.from(step1.ix.data).equals(Buffer.from(step2.ix.data)));

  // ---- C then A: the durable-image fallback ---------------------------------------------------
  // The owner's choice (2026-09-04): try C (mirror the ORIGINAL bytes to Arweave, exact and
  // permanent), fall back to A (ipfs://<CID>, same file, gateway-agnostic). The branch that
  // matters is what happens when C FAILS — over Turbo's 100 KiB free ceiling it needs a funded
  // account — and that cannot be staged against a live account, hence the injected mirror.
  console.log('\nC then A — durable image fallback\n');
  var IPFS_IMG = 'https://ipfs.io/ipfs/QmYF2cicUj59Sy9zXPv9s1j6zrq9j6f9bb5xLFyHoy5kkh';
  {
    const r = await M.chooseDurableImage({ imageUrl: IPFS_IMG, mirror: async () => 'https://arweave.net/NEWID' });
    ok('C: a working mirror wins', r.method === 'arweave-mirror' && r.image === 'https://arweave.net/NEWID', JSON.stringify(r));
  }
  {
    const r = await M.chooseDurableImage({ imageUrl: IPFS_IMG, mirror: async () => { throw new Error('HTTP 402 payment required'); } });
    ok('A: a failed mirror falls back to ipfs://, it does not abort',
       r.method === 'ipfs-scheme' && r.image === 'ipfs://QmYF2cicUj59Sy9zXPv9s1j6zrq9j6f9bb5xLFyHoy5kkh', JSON.stringify(r));
    ok('  and the failure reason is reported, not swallowed',
       r.steps.some((x) => /402|payment/i.test(x)), JSON.stringify(r.steps));
  }
  {
    const r = await M.chooseDurableImage({ imageUrl: IPFS_IMG, mirror: async () => null });
    ok('a mirror that returns nothing counts as a failure', r.method === 'ipfs-scheme');
  }
  {
    const r = await M.chooseDurableImage({ imageUrl: IPFS_IMG, mirror: null });
    ok('mirror disabled goes straight to ipfs://', r.method === 'ipfs-scheme');
  }
  {
    const r = await M.chooseDurableImage({ imageUrl: 'ipfs://QmAlreadyFine', mirror: null });
    ok('an already-durable ipfs:// image is left alone', r.method === 'unchanged' && r.image === 'ipfs://QmAlreadyFine');
  }
  {
    const r = await M.chooseDurableImage({ imageUrl: 'https://example.com/logo.png', mirror: async () => { throw new Error('nope'); } });
    ok('a non-IPFS image with no mirror has NO durable option — reported, not guessed',
       r.image === null && r.method === null, JSON.stringify(r));
  }
  // THE MISTAKE THIS PREVENTS: an aggregator's smaller copy is never substituted. Jupiter hosts a
  // 512x512 downscale of ROSE's 1080x1080 logo; using it would have frozen the small one forever.
  {
    const r = await M.chooseDurableImage({ imageUrl: IPFS_IMG, mirror: async (u) => { 
      ok('  the mirror is handed the ORIGINAL url, never a substitute', u === IPFS_IMG, u);
      return 'https://arweave.net/X'; } });
    ok('  and returns what the mirror produced from it', r.image === 'https://arweave.net/X');
  }

  // ---- THE BYTE DIFF -------------------------------------------------------------------------
  console.log('\nbyte-for-byte against the real Metaplex serializer\n');
  let lib;
  try { lib = await import('@metaplex-foundation/mpl-token-metadata'); }
  catch (e) {
    if (process.env.METAPLEX_REQUIRE_BYTEDIFF) { failures++; console.log('  ✗ mpl-token-metadata missing but METAPLEX_REQUIRE_BYTEDIFF is set: ' + e.message); }
    else console.log('  SKIP  byte diff (@metaplex-foundation/mpl-token-metadata not installed)');
    return done();
  }
  const ser = lib.getUpdateMetadataAccountV2InstructionDataSerializer &&
              lib.getUpdateMetadataAccountV2InstructionDataSerializer();
  if (!ser) { failures++; console.log('  ✗ the library no longer exposes getUpdateMetadataAccountV2InstructionDataSerializer'); return done(); }

  const theirs = Buffer.from(ser.serialize({
    data: {
      name: ROSE.name, symbol: ROSE.symbol, uri: NEW_URI,
      sellerFeeBasisPoints: ROSE.sellerFeeBasisPoints,
      creators: ROSE.creators.map((c) => ({ address: c.address, verified: c.verified, share: c.share })),
      collection: null, uses: null,
    },
    updateAuthority: null, primarySaleHappened: null, isMutable: false,
  }));
  const ours = Buffer.from(ix.data);
  ok('our hand-built instruction data is byte-identical to the library\'s',
     ours.equals(theirs),
     'ours   (' + ours.length + '): ' + ours.toString('hex').slice(0, 160) +
     '\n      theirs (' + theirs.length + '): ' + theirs.toString('hex').slice(0, 160));

  // and a shape the library would encode differently if we got Options wrong
  const noChange = Buffer.from(M.buildUpdateIx({ current: ROSE, makeImmutable: true }).ix.data);
  const theirsNoChange = Buffer.from(ser.serialize({
    data: { name: ROSE.name, symbol: ROSE.symbol, uri: ROSE.uri, sellerFeeBasisPoints: 0,
            creators: ROSE.creators.map((c) => ({ address: c.address, verified: c.verified, share: c.share })),
            collection: null, uses: null },
    updateAuthority: null, primarySaleHappened: null, isMutable: false,
  }));
  ok('...and still identical when the URI is left alone', noChange.equals(theirsNoChange));

  // Step 1 must encode isMutable as Option::None. Getting this byte wrong is how a "just update
  // the URI" call would quietly carry a lock with it.
  const theirsStep1 = Buffer.from(ser.serialize({
    data: { name: ROSE.name, symbol: ROSE.symbol, uri: NEW_URI, sellerFeeBasisPoints: 0,
            creators: ROSE.creators.map((c) => ({ address: c.address, verified: c.verified, share: c.share })),
            collection: null, uses: null },
    updateAuthority: null, primarySaleHappened: null, isMutable: null,
  }));
  ok('step 1 encodes isMutable as None, byte-identical to the library',
     Buffer.from(step1.ix.data).equals(theirsStep1),
     'ours   : ' + Buffer.from(step1.ix.data).toString('hex').slice(-40) +
     '\n      theirs : ' + theirsStep1.toString('hex').slice(-40));

  done();
  function done() {
    console.log('\n' + (failures ? failures + ' FAILED' : 'all passed') + '\n');
    process.exit(failures ? 1 : 0);
  }
})().catch((e) => { console.error('\nharness error: ' + (e && e.stack || e)); process.exit(1); });
