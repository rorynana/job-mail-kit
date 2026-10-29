// criteria.json 점수표대로 jobs.csv 공고마다 점수와 이유를 붙여 scored.csv 로 저장한다.
// AI를 부르지 않고 점수표의 규칙으로만 매긴다. 매일 같은 기준, 비용 0.
// 실행: node score.js
const fs = require("fs");
const path = require("path");

const CRITERIA = path.join(__dirname, "criteria.json");
const IN = path.join(__dirname, "jobs.csv");
const OUT = path.join(__dirname, "scored.csv");
const COLUMNS = ["사이트", "회사", "공고 제목", "지역", "경력", "근무 형태", "마감일", "링크"];
const READABLE = ["회사", "공고 제목", "지역", "경력", "근무 형태"];

function parseCsv(text) {
  text = text.replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(v => v !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(v => v !== "")) rows.push(row);
  const header = rows.shift();
  return rows.map(r => Object.fromEntries(header.map((h, i) => [h, r[i] || ""])));
}
const csvCell = v => /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

// ---------- 점수표 검사 ----------
// 점수표가 틀리면 조용히 이상한 점수를 내지 않고, 무엇이 틀렸는지 말하고 멈춘다.
function loadCriteria() {
  if (!fs.existsSync(CRITERIA)) fail("criteria.json 이 없습니다. 인터뷰로 점수표를 먼저 만드세요.");
  let c;
  try { c = JSON.parse(fs.readFileSync(CRITERIA, "utf8")); }
  catch (e) { fail(`criteria.json 을 읽지 못했습니다: ${e.message}`); }
  const errs = [];
  const checkCols = (cols, where) => (cols || []).forEach(col => {
    if (!READABLE.includes(col)) errs.push(`${where}: 「${col}」 칸은 없습니다. 쓸 수 있는 칸은 ${READABLE.join(", ")}`);
  });
  (c["0점 조건"] || []).forEach(z => checkCols(z.칸, `0점 조건 「${z.이름}」`));
  const items = c.항목 || [];
  if (!items.length) errs.push("항목이 없습니다.");
  const sum = items.reduce((s, it) => s + (it.배점 || 0), 0);
  if (sum !== 100) errs.push(`항목 배점 합이 ${sum} 입니다. 100 이어야 합니다.`);
  items.forEach(it => {
    checkCols(it.칸, `항목 「${it.이름}」`);
    if (!it.단계 && !it.연차) errs.push(`항목 「${it.이름}」에 단계(단어로 매기기)나 연차(경력 연수로 매기기)가 없습니다.`);
    if (it.가산) checkCols(it.가산.칸, `항목 「${it.이름}」 가산`);
  });
  if (errs.length) fail("criteria.json 을 고쳐야 합니다.\n- " + errs.join("\n- "));
  return c;
}
function fail(msg) { console.error(msg); process.exit(1); }

// ---------- 채점 ----------
const textOf = (job, cols) => (cols || []).map(col => job[col] || "").join(" ");
const findWord = (text, words) => (words || []).find(w => text.toLowerCase().includes(String(w).toLowerCase()));

// 경력 칸에서 「최소 몇 년」을 꺼낸다. 신입·경력무관은 0, 숫자가 없으면 모름(null).
function minYears(s) {
  if (/신입|무관/.test(s)) return 0;
  const m = s.match(/(\d+)\s*(?:~|년)/);
  return m ? Number(m[1]) : null;
}

function scoreItem(job, it) {
  const half = Math.round(it.배점 / 2);
  const t = textOf(job, it.칸).trim();
  let pts, why;
  if (!t) { pts = half; why = "칸 비어 절반"; }
  else if (it.연차) {
    const y = minYears(t);
    if (y === null) { pts = half; why = "연차 모름, 절반"; }
    else {
      const tier = [...it.연차].sort((a, b) => a.이하 - b.이하).find(x => y <= x.이하);
      pts = tier ? tier.점수 : (it.나머지 ?? 0);
      why = y === 0 ? "신입 가능" : `${y}년 이상`;
    }
  } else {
    let hit = null, word;
    for (const tier of it.단계) { word = findWord(t, tier.단어); if (word) { hit = tier; break; } }
    if (hit) { pts = hit.점수; why = word; }
    else { pts = it.나머지 ?? half; why = "해당 단어 없음"; }
  }
  if (it.가산) {
    const w = findWord(textOf(job, it.가산.칸), it.가산.단어);
    if (w) { pts = Math.min(it.배점, pts + it.가산.점수); why += ` +${w}`; }
  }
  return { pts, text: `${it.이름} ${pts}/${it.배점}(${why})` };
}

function scoreJob(job, c) {
  for (const z of c["0점 조건"] || []) {
    const w = findWord(textOf(job, z.칸), z.단어);
    if (w) return { 점수: 0, 이유: `0점: ${z.이름}(${w})` };
  }
  const parts = c.항목.map(it => scoreItem(job, it));
  return { 점수: parts.reduce((s, p) => s + p.pts, 0), 이유: parts.map(p => p.text).join(" · ") };
}

// ---------- 실행 ----------
const c = loadCriteria();
if (!fs.existsSync(IN)) fail("jobs.csv 가 없습니다. node collect.js 를 먼저 돌리세요.");
const jobs = parseCsv(fs.readFileSync(IN, "utf8"));
const scored = jobs.map(j => ({ ...scoreJob(j, c), ...j })).sort((a, b) => b.점수 - a.점수);

const cols = ["점수", "이유", ...COLUMNS];
const lines = [cols.join(","), ...scored.map(r => cols.map(k => csvCell(String(r[k] ?? ""))).join(","))];
fs.writeFileSync(OUT, "﻿" + lines.join("\r\n") + "\r\n", "utf8");

const line = c.기준선 ?? 60;
console.log(`저장: ${OUT}`);
console.log(`채점 ${scored.length}건 · ${line}점 이상 ${scored.filter(r => r.점수 >= line).length}건 · 0점 ${scored.filter(r => r.점수 === 0).length}건`);
console.log("\n점수 높은 5개");
scored.slice(0, 5).forEach((r, i) => console.log(`${i + 1}. ${r.점수}점 ${r.회사} | ${r["공고 제목"]}\n   ${r.이유}`));
