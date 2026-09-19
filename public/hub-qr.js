// hub-qr.js — a small, pure JavaScript QR encoder for the Hub print sheet (Colosseum roadmap DD4).
// Byte mode only, error-correction level M, versions 1-10 (fits any receipt URL this site issues,
// well under 200 characters). No network call, no third-party image service, no bundled library —
// the whole ISO/IEC 18004 pipeline (GF(256) arithmetic, the Reed-Solomon generator, bit-stream
// assembly, block interleaving, finder/timing/alignment/format/version-info placement, all 8 mask
// patterns scored by the standard four penalty rules) is written out below.
//
// Correctness was checked the way this repo checks a renderer (CLAUDE.md: "check every form, not
// one form") — structurally AND at the codeword level, for every version 1-10:
//   - a free-module-count invariant: (module count NOT reserved by a finder/separator/timing/
//     alignment/format-info/version-info/dark-module function pattern) exactly equals
//     (data+ecc codewords)*8 + the version's remainder bits, for every version. A one-module
//     placement bug (found during development: the always-dark module silently landed on the same
//     cell as an existing format-info bit because a coordinate pair was transposed) throws this
//     off by exactly one and was caught this way before it reached committed code.
//   - a full encode -> de-interleave -> corrupt each block up to its correctable byte count ->
//     Reed-Solomon decode -> reassemble -> re-parse the byte-mode bit stream -> original text,
//     for single-block and multi-block (2, 4, 5 block) versions.
// scripts/hub-print-test.cjs runs both classes of check in CI.
//
// API (available as `HubQr` in the browser, or via require() in Node for the test above):
//   HubQr.encode(text) -> { version, size, mask, modules }   modules[row][col] is 0 or 1
//   HubQr.renderSvg(url, opts) -> an inline <svg> string, role="img", aria-label naming the URL
//   HubQr.rs.encode(dataBytes, ecLen) / HubQr.rs.decode(receivedBytes, ecLen) -> the RS codec
//     alone, exposed for the CI unit test's own encode/corrupt/recover pass.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HubQr = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ── GF(256), primitive polynomial 0x11D (x^8+x^4+x^3+x^2+1), generator element 2 ──────────────
  var EXP = new Array(512).fill(0);
  var LOG = new Array(256).fill(0);
  (function buildGF() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function gmul(a, b) { if (a === 0 || b === 0) return 0; return EXP[LOG[a] + LOG[b]]; }
  function gdiv(a, b) { if (a === 0) return 0; return EXP[(LOG[a] - LOG[b] + 255) % 255]; }

  function polyMulHigh(p, q) {
    var res = new Array(p.length + q.length - 1).fill(0);
    for (var i = 0; i < p.length; i++) for (var j = 0; j < q.length; j++) res[i + j] ^= gmul(p[i], q[j]);
    return res;
  }
  // The Reed-Solomon generator polynomial g(x) = product_{i=0}^{ecLen-1} (x - alpha^i); GF(2^m)
  // subtraction is XOR, so this is (x + alpha^i) at every step.
  function genPoly(ecLen) {
    var g = [1];
    for (var i = 0; i < ecLen; i++) g = polyMulHigh(g, [1, EXP[i]]);
    return g;
  }
  // Standard LFSR-style polynomial long division: the remainder of data(x)*x^ecLen mod g(x) IS
  // the ecLen error-correction codewords.
  function rsEncode(data, ecLen) {
    var gen = genPoly(ecLen);
    var res = data.concat(new Array(ecLen).fill(0));
    for (var i = 0; i < data.length; i++) {
      var coef = res[i];
      if (coef !== 0) for (var j = 0; j < gen.length; j++) res[i + j] ^= gmul(gen[j], coef);
    }
    return res.slice(data.length);
  }
  function polyEvalMsbFirst(poly, x) { var y = 0; for (var i = 0; i < poly.length; i++) y = gmul(y, x) ^ poly[i]; return y; }
  function computeSyndromes(received, ecLen) { var S = new Array(ecLen).fill(0); for (var j = 0; j < ecLen; j++) S[j] = polyEvalMsbFirst(received, EXP[j]); return S; }
  // Berlekamp-Massey: the shortest linear recurrence (the error locator polynomial, ascending
  // powers, sigma[0]=1) that generates the syndrome sequence.
  function berlekampMassey(S) {
    var C = [1], B = [1], L = 0, m = 1, b = 1;
    var n = S.length;
    for (var i = 0; i < n; i++) {
      var delta = S[i];
      for (var j = 1; j <= L; j++) if (C[j] !== undefined) delta ^= gmul(C[j], S[i - j]);
      if (delta === 0) { m++; continue; }
      var T = C.slice();
      var coef = gdiv(delta, b);
      var shiftedB = new Array(m).fill(0).concat(B.map(function (v) { return gmul(coef, v); }));
      var newLen = Math.max(C.length, shiftedB.length);
      var newC = new Array(newLen).fill(0);
      for (var k = 0; k < C.length; k++) newC[k] ^= C[k];
      for (var k2 = 0; k2 < shiftedB.length; k2++) newC[k2] ^= shiftedB[k2];
      C = newC;
      if (2 * L <= i) { L = i + 1 - L; B = T; b = delta; m = 1; } else { m++; }
    }
    return { sigma: C, L: L };
  }
  function polyEvalAscending(poly, x) { var y = 0, xp = 1; for (var i = 0; i < poly.length; i++) { y ^= gmul(poly[i], xp); xp = gmul(xp, x); } return y; }
  // Recovers up to floor(ecLen/2) corrupted bytes in `received` (data+ecc, MSB-first) via
  // syndromes -> Berlekamp-Massey -> Chien search (roots of the locator) -> Forney (magnitudes).
  // Returns {ok:false} rather than a wrong answer when there are more errors than can be
  // corrected (root count disagrees with the locator's degree, or the corrected codeword still
  // has nonzero syndromes) — never a silently-wrong "recovered" value.
  function rsDecode(received, ecLen) {
    var n = received.length, k = n - ecLen;
    var S = computeSyndromes(received, ecLen);
    if (S.every(function (v) { return v === 0; })) return { ok: true, data: received.slice(0, k) };
    var bm = berlekampMassey(S), sigma = bm.sigma, L = bm.L;
    if (L === 0 || L > ecLen / 2) return { ok: false, reason: "too many errors" };
    var errPositions = [], errXk = [];
    for (var j = 0; j < n; j++) {
      var Z = EXP[(255 - (j % 255)) % 255];
      if (polyEvalAscending(sigma, Z) === 0) {
        var i = n - 1 - j;
        if (i >= 0 && i < n) { errPositions.push(i); errXk.push(EXP[j % 255]); }
      }
    }
    if (errPositions.length !== L) return { ok: false, reason: "root count mismatch" };
    var omegaFull = new Array(S.length + sigma.length - 1).fill(0);
    for (var a = 0; a < S.length; a++) for (var bIdx = 0; bIdx < sigma.length; bIdx++) omegaFull[a + bIdx] ^= gmul(S[a], sigma[bIdx]);
    var omega = omegaFull.slice(0, ecLen);
    var sigmaPrime = [];
    for (var kk = 1; kk < sigma.length; kk++) sigmaPrime.push(kk % 2 === 1 ? sigma[kk] : 0);
    var corrected = received.slice();
    for (var t = 0; t < errPositions.length; t++) {
      var pos = errPositions[t], Xk = errXk[t], jj = n - 1 - pos;
      var Zk = EXP[(255 - (jj % 255)) % 255];
      var omegaZ = polyEvalAscending(omega, Zk), sigmaPZ = polyEvalAscending(sigmaPrime, Zk);
      if (sigmaPZ === 0) return { ok: false, reason: "sigma' zero at root" };
      corrected[pos] ^= gmul(Xk, gdiv(omegaZ, sigmaPZ));
    }
    if (!computeSyndromes(corrected, ecLen).every(function (v) { return v === 0; })) return { ok: false, reason: "post-correction syndromes nonzero" };
    return { ok: true, data: corrected.slice(0, k) };
  }

  // ── QR version tables, ECC level M, versions 1-10, byte mode (ISO/IEC 18004 Annexes D/E) ──────
  var DATA_CODEWORDS_M = [16, 28, 44, 64, 86, 108, 124, 154, 182, 216];
  var ECC_PER_BLOCK_M = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  var BLOCKS_M = [
    [[1, 16]], [[1, 28]], [[1, 44]], [[2, 32]], [[2, 43]],
    [[4, 27]], [[4, 31]], [[2, 38], [2, 39]], [[3, 36], [2, 37]], [[4, 43], [1, 44]],
  ];
  var ALIGNMENT_COORDS = [null, [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  var REMAINDER_BITS = [0, 7, 7, 7, 7, 7, 0, 0, 0, 0];
  function sizeForVersion(v) { return 4 * v + 17; }

  function pushBits(bits, val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }

  function chooseVersion(byteLen) {
    for (var v = 1; v <= 10; v++) {
      var ccBits = v <= 9 ? 8 : 16;
      var capBits = DATA_CODEWORDS_M[v - 1] * 8;
      if (4 + ccBits + byteLen * 8 <= capBits) return v;
    }
    return null;
  }

  function buildDataCodewords(version, bytes) {
    var bits = [];
    var ccBits = version <= 9 ? 8 : 16;
    pushBits(bits, 0x4, 4); // byte mode indicator
    pushBits(bits, bytes.length, ccBits);
    for (var i = 0; i < bytes.length; i++) pushBits(bits, bytes[i], 8);
    var capBits = DATA_CODEWORDS_M[version - 1] * 8;
    var term = Math.min(4, capBits - bits.length);
    for (var t = 0; t < term; t++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);
    var codewords = [];
    for (var k = 0; k < bits.length; k += 8) {
      var v2 = 0; for (var j = 0; j < 8; j++) v2 = (v2 << 1) | bits[k + j];
      codewords.push(v2);
    }
    var PAD = [0xEC, 0x11], p = 0;
    while (codewords.length < DATA_CODEWORDS_M[version - 1]) codewords.push(PAD[p++ % 2]);
    return codewords;
  }

  function interleave(version, dataCodewords) {
    var blocks = BLOCKS_M[version - 1];
    var eccLen = ECC_PER_BLOCK_M[version - 1];
    var dataBlocks = [], eccBlocks = [];
    var off = 0;
    for (var g = 0; g < blocks.length; g++) {
      var count = blocks[g][0], len = blocks[g][1];
      for (var i = 0; i < count; i++) {
        var block = dataCodewords.slice(off, off + len);
        off += len;
        dataBlocks.push(block);
        eccBlocks.push(rsEncode(block, eccLen));
      }
    }
    var maxDataLen = Math.max.apply(null, dataBlocks.map(function (b) { return b.length; }));
    var out = [];
    for (var idx = 0; idx < maxDataLen; idx++) for (var b2 = 0; b2 < dataBlocks.length; b2++) if (idx < dataBlocks[b2].length) out.push(dataBlocks[b2][idx]);
    for (var idx2 = 0; idx2 < eccLen; idx2++) for (var b3 = 0; b3 < eccBlocks.length; b3++) out.push(eccBlocks[b3][idx2]);
    return out;
  }

  // ── matrix construction ─────────────────────────────────────────────────────────────────────
  function makeMatrix(size) {
    return { size: size, mod: Array.from({ length: size }, function () { return new Array(size).fill(0); }), fn: Array.from({ length: size }, function () { return new Array(size).fill(false); }) };
  }
  function set(m, r, c, val, isFn) { m.mod[r][c] = val ? 1 : 0; if (isFn) m.fn[r][c] = true; }

  function drawFinder(m, r0, c0) {
    var PAT = [
      [1, 1, 1, 1, 1, 1, 1], [1, 0, 0, 0, 0, 0, 1], [1, 0, 1, 1, 1, 0, 1], [1, 0, 1, 1, 1, 0, 1],
      [1, 0, 1, 1, 1, 0, 1], [1, 0, 0, 0, 0, 0, 1], [1, 1, 1, 1, 1, 1, 1],
    ];
    for (var r = -1; r <= 7; r++) {
      for (var c = -1; c <= 7; c++) {
        var rr = r0 + r, cc = c0 + c;
        if (rr < 0 || cc < 0 || rr >= m.size || cc >= m.size) continue;
        var inCore = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        set(m, rr, cc, inCore ? PAT[r][c] : 0, true); // the ring outside the 7x7 core is the white separator
      }
    }
  }
  function drawAlignment(m, r0, c0) {
    var PAT = [[1, 1, 1, 1, 1], [1, 0, 0, 0, 1], [1, 0, 1, 0, 1], [1, 0, 0, 0, 1], [1, 1, 1, 1, 1]];
    for (var r = 0; r < 5; r++) for (var c = 0; c < 5; c++) set(m, r0 - 2 + r, c0 - 2 + c, PAT[r][c], true);
  }
  function drawTiming(m) {
    var size = m.size;
    for (var i = 8; i < size - 8; i++) {
      if (!m.fn[6][i]) set(m, 6, i, i % 2 === 0 ? 1 : 0, true);
      if (!m.fn[i][6]) set(m, i, 6, i % 2 === 0 ? 1 : 0, true);
    }
  }
  function alignmentCenters(version) {
    var coords = ALIGNMENT_COORDS[version - 1];
    if (!coords) return [];
    var size = sizeForVersion(version), out = [];
    for (var i = 0; i < coords.length; i++) for (var j = 0; j < coords.length; j++) {
      var r = coords[i], c = coords[j];
      var nearFinder = (r < 9 && c < 9) || (r < 9 && c > size - 9) || (r > size - 9 && c < 9);
      if (!nearFinder) out.push([r, c]);
    }
    return out;
  }
  function getBit(x, i) { return (x >>> i) & 1; }

  // The 15-bit format-info string (2-bit EC level + 3-bit mask + 10-bit BCH ECC, XOR-masked),
  // written twice for redundancy, plus the single always-dark module. Coordinates below are
  // (row, col) — the transpose of the spec's own (x=col, y=row) convention; see the file-header
  // note on the placement bug this caught during development.
  function drawFormatBits(m, ecFormatBits, mask) {
    var size = m.size;
    var data = (ecFormatBits << 3) | mask;
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;
    for (var a = 0; a <= 5; a++) set(m, a, 8, getBit(bits, a), true);
    set(m, 7, 8, getBit(bits, 6), true);
    set(m, 8, 8, getBit(bits, 7), true);
    set(m, 8, 7, getBit(bits, 8), true);
    for (var b = 9; b <= 14; b++) set(m, 8, 14 - b, getBit(bits, b), true);
    for (var c = 0; c <= 7; c++) set(m, 8, size - 1 - c, getBit(bits, c), true);
    for (var d = 8; d <= 14; d++) set(m, size - 15 + d, 8, getBit(bits, d), true);
    set(m, size - 8, 8, 1, true); // dark module — distinct from every bit cell above
  }
  function drawVersionInfo(m, version) {
    if (version < 7) return;
    var rem = version;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    var bits = (version << 12) | rem;
    var size = m.size;
    for (var j = 0; j < 18; j++) {
      var bit = getBit(bits, j);
      var a2 = size - 11 + (j % 3), b2 = Math.floor(j / 3);
      set(m, b2, a2, bit, true);
      set(m, a2, b2, bit, true);
    }
  }

  // Standard boustrophedon placement: two-column strips from the right edge, skipping the timing
  // column, alternating scan direction per strip.
  function drawCodewords(m, codewords) {
    var size = m.size, bitIndex = 0, totalBits = codewords.length * 8, right = size - 1;
    while (right >= 1) {
      if (right === 6) right--;
      var upward = ((right + 1) & 2) === 0;
      for (var vert = 0; vert < size; vert++) {
        var y = upward ? size - 1 - vert : vert;
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          if (m.fn[y][x]) continue;
          var bit = 0;
          if (bitIndex < totalBits) { bit = getBit(codewords[bitIndex >> 3], 7 - (bitIndex & 7)); bitIndex++; }
          m.mod[y][x] = bit;
        }
      }
      right -= 2;
    }
    return { bitIndex: bitIndex };
  }

  function applyMaskFormula(mask, r, c) {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return false;
    }
  }
  function applyMask(m, mask) {
    for (var r = 0; r < m.size; r++) for (var c = 0; c < m.size; c++) if (!m.fn[r][c] && applyMaskFormula(mask, r, c)) m.mod[r][c] ^= 1;
  }

  // The four standard masking penalty rules (ISO/IEC 18004 §8.8.2) — lower is better.
  function penalty(m) {
    var size = m.size, mod = m.mod, p = 0, r, c;
    for (r = 0; r < size; r++) {
      var runColor = -1, runLen = 0;
      for (c = 0; c < size; c++) {
        if (mod[r][c] === runColor) runLen++; else { runColor = mod[r][c]; runLen = 1; }
        if (runLen === 5) p += 3; else if (runLen > 5) p += 1;
      }
    }
    for (c = 0; c < size; c++) {
      var runColor2 = -1, runLen2 = 0;
      for (r = 0; r < size; r++) {
        if (mod[r][c] === runColor2) runLen2++; else { runColor2 = mod[r][c]; runLen2 = 1; }
        if (runLen2 === 5) p += 3; else if (runLen2 > 5) p += 1;
      }
    }
    for (r = 0; r < size - 1; r++) for (c = 0; c < size - 1; c++) {
      var v = mod[r][c];
      if (v === mod[r][c + 1] && v === mod[r + 1][c] && v === mod[r + 1][c + 1]) p += 3;
    }
    var PAT_A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], PAT_B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    function matchesAt(arr, startIdx, pat) { for (var i = 0; i < pat.length; i++) if (arr[startIdx + i] !== pat[i]) return false; return true; }
    for (r = 0; r < size; r++) {
      var row = mod[r];
      for (c = 0; c + 11 <= size; c++) if (matchesAt(row, c, PAT_A) || matchesAt(row, c, PAT_B)) p += 40;
    }
    for (c = 0; c < size; c++) {
      var col = []; for (r = 0; r < size; r++) col.push(mod[r][c]);
      for (r = 0; r + 11 <= size; r++) if (matchesAt(col, r, PAT_A) || matchesAt(col, r, PAT_B)) p += 40;
    }
    var dark = 0; for (r = 0; r < size; r++) for (c = 0; c < size; c++) dark += mod[r][c];
    var pct = (dark * 100) / (size * size);
    p += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return p;
  }

  var FORMAT_BITS_M = 0; // ECC level indicator bits for level M (L=1, M=0, Q=3, H=2)

  // encode(text): byte-mode, ECC level M, smallest version 1-10 that fits. Throws only when the
  // text is too long for version 10 at this level (~213 bytes) — every URL this site issues is
  // far under that.
  function encode(text) {
    var bytes = [];
    var utf8 = unescape(encodeURIComponent(String(text))); // portable UTF-8 byte extraction, no Buffer needed in a browser
    for (var i = 0; i < utf8.length; i++) bytes.push(utf8.charCodeAt(i));
    var version = chooseVersion(bytes.length);
    if (!version) throw new Error("text too long for this QR encoder (versions 1-10, ECC M)");
    var dataCodewords = buildDataCodewords(version, bytes);
    var finalCodewords = interleave(version, dataCodewords);
    var size = sizeForVersion(version);
    var m = makeMatrix(size);
    drawFinder(m, 0, 0); drawFinder(m, size - 7, 0); drawFinder(m, 0, size - 7);
    drawTiming(m);
    var centers = alignmentCenters(version);
    for (var a = 0; a < centers.length; a++) drawAlignment(m, centers[a][0], centers[a][1]);
    drawVersionInfo(m, version);
    drawFormatBits(m, FORMAT_BITS_M, 0); // reserve the format-info cells before data placement
    drawCodewords(m, finalCodewords);
    var best = null, bestPenalty = Infinity, bestMod = null;
    for (var mask = 0; mask < 8; mask++) {
      var copy = { size: m.size, mod: m.mod.map(function (row) { return row.slice(); }), fn: m.fn };
      applyMask(copy, mask);
      drawFormatBits(copy, FORMAT_BITS_M, mask);
      var pen = penalty(copy);
      if (pen < bestPenalty) { bestPenalty = pen; best = mask; bestMod = copy.mod; }
    }
    return { version: version, size: size, mask: best, modules: bestMod, dataCodewords: dataCodewords, finalCodewords: finalCodewords };
  }

  // renderSvg(url, opts): a single <path> per contiguous horizontal run of dark modules (far
  // fewer path segments than one <rect> per module), white background rect for contrast on a
  // dark page, role="img" with an aria-label naming the URL so a screen reader gets the same
  // information a sighted reader gets from scanning the code.
  function escDefault(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function renderSvg(url, opts) {
    opts = opts || {};
    var esc = opts.esc || escDefault;
    var q = encode(url);
    var quiet = opts.quietZone != null ? opts.quietZone : 4;
    var dim = q.size + quiet * 2;
    var d = "";
    for (var r = 0; r < q.size; r++) {
      var c = 0;
      while (c < q.size) {
        if (q.modules[r][c]) {
          var c2 = c;
          while (c2 < q.size && q.modules[r][c2]) c2++;
          var runLen = c2 - c;
          d += "M" + (c + quiet) + "," + (r + quiet) + "h" + runLen + "v1h-" + runLen + "z";
          c = c2;
        } else c++;
      }
    }
    var label = esc(opts.ariaLabel || url);
    return '<svg class="hub-qr" viewBox="0 0 ' + dim + ' ' + dim + '" role="img" aria-label="' + label +
      '" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;background:#fff;border-radius:4px">' +
      '<rect width="' + dim + '" height="' + dim + '" fill="#fff"/>' +
      '<path d="' + d + '" fill="#000"/></svg>';
  }

  return {
    encode: encode,
    renderSvg: renderSvg,
    rs: { encode: rsEncode, decode: rsDecode },
    tables: { DATA_CODEWORDS_M: DATA_CODEWORDS_M, ECC_PER_BLOCK_M: ECC_PER_BLOCK_M, BLOCKS_M: BLOCKS_M, ALIGNMENT_COORDS: ALIGNMENT_COORDS, REMAINDER_BITS: REMAINDER_BITS },
    sizeForVersion: sizeForVersion,
    chooseVersion: chooseVersion,
  };
});
