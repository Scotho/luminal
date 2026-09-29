// Alea seeded PRNG — ported from the original standalone synthcity/js/alea.js.
// Johannes Baagoe, 2010 (http://baagoe.com/en/RandomMusings/javascript/).
// Do not "improve" this algorithm — the synthcity curated seed (4217) bakes
// specific outputs of this exact RNG into the procedural layout.

export type AleaRandom = () => number;

function mashFactory(): (data: string | number) => number {
  let n = 0xefc8249d;

  return function mash(data: string | number): number {
    const s = String(data);
    for (let i = 0; i < s.length; i++) {
      n += s.charCodeAt(i);
      let h = 0.02519603282416938 * n;
      n = h >>> 0;
      h -= n;
      h *= n;
      n = h >>> 0;
      h -= n;
      n += h * 0x100000000;
    }
    return (n >>> 0) * 2.3283064365386963e-10;
  };
}

export function createAlea(...args: (string | number)[]): AleaRandom {
  const seedArgs = args.length === 0 ? [+new Date()] : args;

  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let c = 1;

  const mash = mashFactory();
  s0 = mash(' ');
  s1 = mash(' ');
  s2 = mash(' ');

  for (const arg of seedArgs) {
    s0 -= mash(arg);
    if (s0 < 0) s0 += 1;
    s1 -= mash(arg);
    if (s1 < 0) s1 += 1;
    s2 -= mash(arg);
    if (s2 < 0) s2 += 1;
  }

  return function random(): number {
    const t = 2091639 * s0 + c * 2.3283064365386963e-10;
    s0 = s1;
    s1 = s2;
    c = t | 0;
    s2 = t - c;
    return s2;
  };
}
