export const PAGE_CSS = `
.cp{max-width:var(--w-wide);margin:0 auto}
.cp-hero{padding:var(--sp-5) 0 var(--sp-3)}
.cp-hero h1{font-family:var(--font-display);font-weight:600;font-size:var(--fs-2xl);line-height:var(--lh-tight);color:var(--ink);margin:10px 0 var(--sp-3)}
.cp-hero p{margin:0;max-width:var(--w-read);font-family:var(--font-read);font-size:1.12rem;color:var(--text)}
.cp-form{margin-top:var(--sp-4);padding:var(--sp-4);display:grid;grid-template-columns:minmax(0,1fr);gap:var(--sp-3)}
.cp-form textarea{width:100%;min-height:92px;resize:vertical;font-family:var(--font-read);font-size:1.1rem;line-height:1.5;padding:14px 18px}
.cp-ex{display:flex;flex-wrap:wrap;gap:8px}
.cp-ex .chip{white-space:normal;max-width:100%;font-size:var(--fs-sm);text-align:start;height:auto;min-height:36px;padding:6px 14px;line-height:1.3}
.cp-opts{display:flex;flex-wrap:wrap;gap:var(--sp-3);align-items:end}
.cp-opts label{display:grid;gap:4px;font:500 var(--fs-xs)/1 var(--font-ui);color:var(--muted)}
.cp-opts select{min-width:0;width:100%}.cp-opts label{flex:1 1 150px;min-width:0}
.cp-go{margin-inline-start:auto}
.cp-prog{margin-top:var(--sp-4);padding:var(--sp-4) var(--sp-5)}
.cp-prog ol{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.cp-prog li{display:grid;grid-template-columns:22px 1fr auto;gap:10px;align-items:baseline;font:500 var(--fs-sm)/1.4 var(--font-ui);color:var(--muted)}
.cp-prog li.act{color:var(--ink)}
.cp-prog li .d{display:block;font-weight:400;font-size:var(--fs-xs);color:var(--muted);overflow-wrap:anywhere}
.cp-prog .dot{width:10px;height:10px;border-radius:50%;background:var(--line-strong);margin-top:5px}
.cp-prog li.act .dot{background:var(--gold);animation:cpp 1.1s var(--ease) infinite}
.cp-prog li.ok .dot{background:var(--gold-strong)}
.cp-prog .tm{font-variant-numeric:tabular-nums;font-size:var(--fs-xs)}
@keyframes cpp{0%,100%{transform:scale(.8);opacity:.6}50%{transform:scale(1.3);opacity:1}}
@media (prefers-reduced-motion:reduce){.cp-prog li.act .dot{animation:none}}
.cp-err{margin-top:var(--sp-4);padding:var(--sp-4);border:1px solid var(--danger);border-radius:var(--r-md);color:var(--danger);font:500 var(--fs-sm)/1.5 var(--font-ui)}
.cp-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:var(--sp-5) 0 0;padding:12px 16px;position:sticky;top:calc(var(--header-h) + 6px);z-index:5;background:var(--overlay);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid var(--line);border-radius:var(--r-lg)}
.cp-bar .meta{margin-inline-start:auto;font:400 var(--fs-xs)/1.4 var(--font-ui);color:var(--muted)}
.cp-hist{margin-top:var(--sp-6)}
.cp-hist h2{font:600 var(--fs-2xs)/1 var(--font-ui);letter-spacing:.16em;text-transform:uppercase;color:var(--gold-strong);margin:0 0 10px}
.cp-hist ul{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.cp-hist li{display:flex;gap:10px;align-items:baseline}
.cp-hist button.open{background:none;border:0;padding:6px 0;text-align:start;font:500 var(--fs-sm)/1.35 var(--font-ui);color:var(--ink);cursor:pointer;text-decoration:underline;text-decoration-color:var(--gold-line);text-underline-offset:3px}
.cp-hist .when{font:400 var(--fs-xs)/1 var(--font-ui);color:var(--muted);flex:none}
.cp-hist .clr{background:none;border:0;color:var(--muted);font:400 var(--fs-xs)/1 var(--font-ui);cursor:pointer;margin-top:8px;padding:4px 0;text-decoration:underline}
`;
