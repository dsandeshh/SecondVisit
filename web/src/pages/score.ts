// The summary page: the score in big words, and run 1 against run 2 once both are done.
export type RunResult = { quizOk: number; quizTotal: number; pointDeg: number | null; bumps: number };

const pointWords = (d: number | null) => d === null ? "not tested" : d <= 15 ? `pointed within ${d} degrees` : d <= 40 ? `pointed ${d} degrees off` : `pointed ${d} degrees off, a long way`;
const bumpWords = (n: number) => n === 0 ? "no bumps" : n === 1 ? "1 bump" : `${n} bumps`;

/** One headline sentence for a run: "2 of 3 right, pointed within 12 degrees, no bumps". */
export function headline(r: RunResult): string {
  return `${r.quizTotal ? `${r.quizOk} of ${r.quizTotal} right` : "no quiz"}, ${pointWords(r.pointDeg)}, ${bumpWords(r.bumps)}`;
}

export function renderScore(host: HTMLElement, runs: Record<number, RunResult>): void {
  const d = host.ownerDocument;
  host.replaceChildren();
  const r1 = runs[1], r2 = runs[2];
  const big = d.createElement("p");
  big.className = "score__big";
  const last = r2 ?? r1;
  big.textContent = last ? `${last.quizOk} of ${last.quizTotal} right.` : "Run complete.";
  host.append(big);
  if (last) { const p = d.createElement("p"); p.className = "score__line"; p.textContent = `${last.pointDeg === null ? "Pointing not tested" : pointWords(last.pointDeg).replace(/^./, c => c.toUpperCase())}, ${bumpWords(last.bumps)}.`; host.append(p); }
  if (r1 && r2) {
    const t = d.createElement("table"); t.className = "score__table";
    t.innerHTML = "<caption class=\"sr-only\">Run 1 against run 2</caption><thead><tr><th scope=\"col\"></th><th scope=\"col\">Run 1</th><th scope=\"col\">Run 2</th></tr></thead><tbody></tbody>";
    const rows: [string, (r: RunResult) => string][] = [["Quiz", r => `${r.quizOk} of ${r.quizTotal}`], ["Pointing", r => r.pointDeg === null ? "not tested" : `${r.pointDeg} degrees off`], ["Bumps", r => String(r.bumps)]];
    const body = t.querySelector("tbody")!;
    for (const [k, f] of rows) { const tr = d.createElement("tr"); const th = d.createElement("th"); th.scope = "row"; th.textContent = k; const a = d.createElement("td"), b = d.createElement("td"); a.textContent = f(r1); b.textContent = f(r2); tr.append(th, a, b); body.append(tr); }
    host.append(t);
  } else if (r1) { const p = d.createElement("p"); p.className = "score__line score__line--soft"; p.textContent = "Run 2 comes next. Practice again and see what changes."; host.append(p); }
}
